import { describe, expect, it } from 'vitest';
import { parseScene, validateScene, type SceDiagnostic } from '@scenoco-three/compiler';

/** Parse + validate, returning diagnostics (parse errors included). */
function check(xml: string): SceDiagnostic[] {
  const parsed = parseScene(xml);
  if (!parsed.ok) return parsed.diagnostics;
  return validateScene(parsed.root);
}

const codes = (xml: string) => check(xml).map((d) => d.code);

describe('Validator', () => {
  it('accepts a valid scene with no diagnostics', () => {
    expect(
      check(`<Scene>
        <Mesh id="A"><BoxGeometry /><MeshStandardMaterial color="#ff0000" /></Mesh>
      </Scene>`),
    ).toEqual([]);
  });

  it('reports a non-Scene root', () => {
    expect(codes('<Group></Group>')).toContain('bad-root');
  });

  it('flags unknown tags with a suggestion and line number', () => {
    const diags = check(`<Scene>
      <Mesh id="A"><BocGeometry /><MeshStandardMaterial /></Mesh>
    </Scene>`);
    const d = diags.find((x) => x.code === 'unknown-tag');
    expect(d).toBeDefined();
    expect(d!.message).toContain('BoxGeometry');
    expect(d!.line).toBe(2);
  });

  it('flags an unknown attribute with a suggestion', () => {
    const d = check(`<Scene><Mesh id="A" positon="0 0 0"><BoxGeometry /></Mesh></Scene>`).find(
      (x) => x.code === 'unknown-attr',
    );
    expect(d).toBeDefined();
    expect(d!.message).toContain('position');
  });

  it('flags malformed attribute values with the expected format', () => {
    const d = check(`<Scene><Mesh id="A" position="0 0"><BoxGeometry /></Mesh></Scene>`).find(
      (x) => x.code === 'bad-value',
    );
    expect(d).toBeDefined();
    expect(d!.message).toContain('3 space-separated numbers');
  });

  it('requires a geometry inside a Mesh', () => {
    expect(codes(`<Scene><Mesh id="A" /></Scene>`)).toContain('missing-required-attachment');
  });

  it('rejects two geometries in one Mesh (same group)', () => {
    expect(
      codes(`<Scene><Mesh id="A"><BoxGeometry /><SphereGeometry /></Mesh></Scene>`),
    ).toContain('duplicate-attachment');
  });

  it('rejects geometry outside a mesh-like node', () => {
    expect(codes(`<Scene><Group><BoxGeometry /></Group></Scene>`)).toContain('attachment-wrong-target');
  });

  it('rejects a component placed outside a Components block', () => {
    expect(
      codes(`<Scene><Mesh id="A"><BoxGeometry /><Rotator speed="1" /></Mesh></Scene>`),
    ).toContain('component-outside-block');
  });

  it('flags unknown components inside a Components block', () => {
    const d = check(`<Scene><Mesh id="A"><BoxGeometry /><Components><Rotor speed="1" /></Components></Mesh></Scene>`).find(
      (x) => x.code === 'unknown-component',
    );
    expect(d).toBeDefined();
    expect(d!.message).toContain('Rotator');
  });

  it('rejects duplicate ids (shared node/component namespace)', () => {
    expect(
      codes(`<Scene><Mesh id="A"><BoxGeometry /></Mesh><Mesh id="A"><BoxGeometry /></Mesh></Scene>`),
    ).toContain('duplicate-id');
  });

  it('allows "/" in an id (references are literal #id lookups)', () => {
    expect(check(`<Scene><Mesh id="a/b"><BoxGeometry /></Mesh></Scene>`)).toEqual([]);
  });

  it('resolves a #id component reference to a component', () => {
    expect(
      check(`<Scene>
        <Mesh id="A"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh>
        <Mesh id="B"><BoxGeometry /><Components><Follow source="#osc" /></Components></Mesh>
      </Scene>`),
    ).toEqual([]);
  });

  it('resolves a #id component reference via a node id', () => {
    expect(
      check(`<Scene>
        <Mesh id="A"><BoxGeometry /><Components><Oscillator /></Components></Mesh>
        <Mesh id="B"><BoxGeometry /><Components><Follow source="#A" /></Components></Mesh>
      </Scene>`),
    ).toEqual([]);
  });

  it('requires references to start with #', () => {
    const d = check(`<Scene>
      <Mesh id="A"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh>
      <Mesh id="B"><BoxGeometry /><Components><Follow source="osc" /></Components></Mesh>
    </Scene>`).find((x) => x.code === 'ref-missing-hash');
    expect(d).toBeDefined();
    expect(d!.message).toContain('#');
  });

  it('reports an unresolved reference', () => {
    const d = check(`<Scene>
      <Mesh id="B"><BoxGeometry /><Components><Follow source="#ghost" /></Components></Mesh>
    </Scene>`).find((x) => x.code === 'unresolved-ref');
    expect(d).toBeDefined();
    expect(d!.message).toContain('ghost');
  });

  it('reports a node reference to a missing node', () => {
    expect(
      codes(`<Scene><Mesh id="B"><BoxGeometry /><Components><LookAt target="#ghost" /></Components></Mesh></Scene>`),
    ).toContain('unresolved-ref');
  });

  it('reports a reference type mismatch', () => {
    expect(
      codes(`<Scene>
        <Mesh id="A"><BoxGeometry /><Components><Rotator id="rot" /></Components></Mesh>
        <Mesh id="B"><BoxGeometry /><Components><Follow source="#rot" /></Components></Mesh>
      </Scene>`),
    ).toContain('ref-type-mismatch');
  });

  it('reports a node reference pointing at a component id', () => {
    expect(
      codes(`<Scene>
        <Mesh id="A"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh>
        <Mesh id="B"><BoxGeometry /><Components><LookAt target="#osc" /></Components></Mesh>
      </Scene>`),
    ).toContain('ref-type-mismatch');
  });

  it('collects multiple errors at once (no fail-fast)', () => {
    const diags = check(`<Scene>
      <Mesh id="A" position="bad"><Wrong /></Mesh>
    </Scene>`);
    expect(diags.length).toBeGreaterThanOrEqual(2);
  });

  it('reports malformed XML with a position', () => {
    const diags = check(`<Scene><Mesh></Scene>`);
    expect(diags[0]!.code).toBe('xml-syntax');
  });

  it('ignores xmlns/xsi schema-location attributes (IDE wiring)', () => {
    expect(
      check(
        `<Scene xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="scene.xsd">` +
          `<Mesh id="A"><BoxGeometry /></Mesh></Scene>`,
      ),
    ).toEqual([]);
  });
});

describe('Validator — array properties', () => {
  const arrayScene = (attrs: string) => `<Scene>
    <Mesh id="M"><BoxGeometry />
      <Components><ArrayProbe ${attrs} /></Components>
    </Mesh>
  </Scene>`;

  it('accepts valid float array', () => {
    expect(check(arrayScene('points="[1,2,3]"'))).toEqual([]);
  });

  it('accepts empty array []', () => {
    expect(check(arrayScene('points="[]"'))).toEqual([]);
  });

  it('accepts valid vec3 array (space-separated elements)', () => {
    expect(check(arrayScene('waypoints="[0 1 0,1 0 0]"'))).toEqual([]);
  });

  it('rejects non-bracketed value for an array prop', () => {
    expect(codes(arrayScene('points="1,2,3"'))).toContain('bad-value');
  });

  it('reports a per-element parse error in an array', () => {
    const diags = check(arrayScene('points="[1,bad,3]"'));
    expect(diags.some((d) => d.code === 'bad-value')).toBe(true);
  });

  it('accepts valid node-ref array', () => {
    expect(
      check(`<Scene>
        <Mesh id="a"><BoxGeometry /></Mesh>
        <Mesh id="b"><BoxGeometry /></Mesh>
        <Mesh id="M"><BoxGeometry />
          <Components><ArrayProbe targets="[#a,#b]" /></Components>
        </Mesh>
      </Scene>`),
    ).toEqual([]);
  });

  it('reports an unresolved ref inside an array', () => {
    expect(
      codes(`<Scene>
        <Mesh id="M"><BoxGeometry />
          <Components><ArrayProbe targets="[#ghost]" /></Components>
        </Mesh>
      </Scene>`),
    ).toContain('unresolved-ref');
  });

  it('reports a missing hash inside an array element', () => {
    expect(
      codes(`<Scene>
        <Mesh id="a"><BoxGeometry /></Mesh>
        <Mesh id="M"><BoxGeometry />
          <Components><ArrayProbe targets="[a]" /></Components>
        </Mesh>
      </Scene>`),
    ).toContain('ref-missing-hash');
  });

  it('accepts typed component-ref array', () => {
    expect(
      check(`<Scene>
        <Mesh id="a"><BoxGeometry /><Components><Oscillator id="o1" /></Components></Mesh>
        <Mesh id="b"><BoxGeometry /><Components><Oscillator id="o2" /></Components></Mesh>
        <Mesh id="M"><BoxGeometry />
          <Components><ArrayProbe oscillators="[#o1,#o2]" /></Components>
        </Mesh>
      </Scene>`),
    ).toEqual([]);
  });
});
