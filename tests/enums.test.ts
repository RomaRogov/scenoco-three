import { describe, expect, it } from 'vitest';
import { Engine, deserializeBundle } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, generateXsd, patchSceneXml, serializeScene } from '@scenoco-three/compiler';
// Registering the fixture here (not in setup.ts) keeps these enums out of every
// other test file's registry — so their XSD/api snapshots stay unchanged.
import { EnumProbe } from './fixtures/components/EnumProbe.js';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map((d) => d.message).join('; ')}`);
  return r.scene;
};

const scene = (inner: string) => `<Scene>\n  <Group id="g">\n    <Components>\n      ${inner}\n    </Components>\n  </Group>\n</Scene>\n`;

describe('enums — compile + validate', () => {
  it('parses a member name to its native value (numeric + string kinds)', () => {
    const s = compile(scene(`<EnumProbe side="Double" kind="Static" />`));
    const c = s.components.find((x) => x.type === 'EnumProbe')!;
    expect(c.props.side).toBe(2); // Side.Double
    expect(c.props.kind).toBe('static'); // BodyKind.Static
  });

  it('rejects an unknown member, listing the allowed names', () => {
    const r = compileSceneXml(scene(`<EnumProbe side="Sideways" />`));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics[0]!.code).toBe('bad-value');
    expect(r.diagnostics[0]!.message).toContain('"Front"');
    expect(r.diagnostics[0]!.message).toContain('enum Side');
  });

  it('carries an enum on a node attribute', () => {
    const s = compile(`<Scene>\n  <EnumNode id="en" side="Double" />\n</Scene>\n`);
    const n = s.nodes.find((x) => x.tag === 'EnumNode')!;
    expect(n.attrs.side).toBe(2);
  });
});

describe('enums — serialize + bundle round-trip', () => {
  it('serializes the native value back to its member name', () => {
    const out = serializeScene(compile(scene(`<EnumProbe side="Double" kind="Static" />`)));
    expect(out).toContain('side="Double"');
    expect(out).toContain('kind="Static"');
  });

  it('elides a node-attr enum left at its default', () => {
    // EnumNode.side default is "Back"; omitting it should round-trip to nothing.
    const out = serializeScene(compile(`<Scene>\n  <EnumNode id="en" />\n</Scene>\n`));
    expect(out).not.toContain('side=');
  });

  it('survives a bundle round-trip for both value kinds', () => {
    const back = deserializeBundle(bundleScene(compile(scene(`<EnumProbe side="Double" kind="Static" />`))));
    const c = back.components.find((x) => x.type === 'EnumProbe')!;
    expect(c.props.side).toBe(2); // numeric — stored raw
    expect(c.props.kind).toBe('static'); // string — interned + decoded
  });
});

describe('enums — runtime instantiation', () => {
  it('sets the native value on the live component + node fields', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(compile(scene(`<EnumProbe id="probe" side="Double" kind="Static" />`))));
    const probe = engine.findComponent('probe', 'EnumProbe') as EnumProbe;
    expect(probe.side).toBe(2);
    expect(probe.kind).toBe('static');

    const nodeEngine = new Engine();
    nodeEngine.loadScene(bundleScene(compile(`<Scene>\n  <EnumNode id="en" side="Double" />\n</Scene>\n`)));
    expect(nodeEngine.findObject('en')!.userData.side).toBe(2);
  });
});

describe('enums — XSD exposure', () => {
  it('emits a named simpleType per enum, referenced by the attribute', () => {
    const xsd = generateXsd();
    expect(xsd).toContain('<xs:simpleType name="Side">');
    expect(xsd).toContain('<xs:enumeration value="Double"/>');
    expect(xsd).toContain('<xs:simpleType name="BodyKind">');
    expect(xsd).toContain('<xs:enumeration value="Kinematic"/>');
    // The component property + the node attribute both reference the enum type.
    expect(xsd).toMatch(/<xs:attribute name="side" type="Side"\/>/);
    expect(xsd).toMatch(/<xs:attribute name="kind" type="BodyKind"\/>/);
  });
});

describe('enums — surgical save', () => {
  it('patches an enum prop, writing the member name into the XML', () => {
    const src = scene(`<EnumProbe id="probe" side="Front" />`);
    const { text, changed, unresolved } = patchSceneXml(src, [
      { target: { kind: 'component', nodeId: 'g', type: 'EnumProbe', ordinal: 0 }, attr: 'side', value: 2 },
    ]);
    expect(changed).toBe(1);
    expect(unresolved).toEqual([]);
    expect(text).toContain('side="Double"');
  });
});
