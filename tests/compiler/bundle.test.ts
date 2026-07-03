import { describe, expect, it } from 'vitest';
import { deserializeBundle, unregisterAttachment, type CompiledScene } from '@scenoco-three/core';
import {
  bundleScene,
  compileSceneXml,
  serializeScene,
  type CompileResult,
  type ResourceResolver,
} from '@scenoco-three/compiler';

const ok = (r: CompileResult): CompiledScene => {
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.scene;
};
const compile = (xml: string, opts?: { path: string; resolve: ResourceResolver }) => ok(compileSceneXml(xml, opts));

const EVERY_TYPE = `<Scene>
  <PointLight id="lamp" color="#ffcc66" intensity="20" position="2 3 1" />
  <Group id="rig" rotation="0 90 0" scale="2 2 2">
    <Mesh id="hero" position="0 1 0">
      <TorusGeometry radius="2" tube="0.3" />
      <MeshStandardMaterial color="#4f8ef7" metalness="0.6" transparent="true" />
      <Components><Oscillator id="bob" axis="1 0 0" amplitude="0.5" /><Rotator speed="3.14" /></Components>
    </Mesh>
    <Mesh id="chaser"><BoxGeometry /><Components><Follow source="#bob" scale="2" /><LookAt target="#hero" /></Components></Mesh>
  </Group>
</Scene>`;

describe('bundle encode/decode', () => {
  it('round-trips a scene covering every value type and reference kind (JSON-safe)', () => {
    const compiled = compile(EVERY_TYPE);
    const bundle = bundleScene(compiled);
    expect(deserializeBundle(bundle)).toEqual(compiled);
    // Survives a JSON serialize/parse (the wire form).
    expect(deserializeBundle(JSON.parse(JSON.stringify(bundle)) as typeof bundle)).toEqual(compiled);
  });

  it('interns repeated strings into a frequency-sorted pool (tags lead ids)', () => {
    const bundle = bundleScene(compile(`<Scene>
      <Mesh id="a"><BoxGeometry /></Mesh><Mesh id="b"><BoxGeometry /></Mesh><Mesh id="c"><BoxGeometry /></Mesh>
    </Scene>`));
    const strings = bundle[1];
    expect(strings).toContain('Mesh');
    expect(strings.indexOf('Mesh')).toBeLessThan(strings.indexOf('a')); // 3× tag beats 1× id
  });

  it('round-trips array-typed component props', () => {
    const compiled = compile(`<Scene>
      <Mesh id="a"><BoxGeometry /></Mesh>
      <Mesh id="b"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh>
      <Mesh id="M"><BoxGeometry /><Components>
        <ArrayProbe points="[1,2.5,-3]" waypoints="[0 1 0,1 0 0]" targets="[#a,#b]" oscillators="[#osc]" />
      </Components></Mesh>
    </Scene>`);
    const restored = deserializeBundle(bundleScene(compiled));
    expect(restored.components.find((c) => c.type === 'ArrayProbe')!.props).toEqual(
      compiled.components.find((c) => c.type === 'ArrayProbe')!.props,
    );
  });

  // A scene's DOM UI overlay HTML (its sibling *.ui.html, embedded by the
  // vite/editor build) must survive encode→decode so the runtime can mount it.
  it('carries the scene UI overlay html through the bundle', () => {
    const compiled: CompiledScene = { ...compile(`<Scene><Mesh><BoxGeometry /></Mesh></Scene>`), ui: '<div id="hud">SCORE 0</div>' };
    const restored = deserializeBundle(JSON.parse(JSON.stringify(bundleScene(compiled))) as ReturnType<typeof bundleScene>);
    expect(restored.ui).toBe('<div id="hud">SCORE 0</div>');
  });

  // A component's build-time `config` (compiled from a `src=` document, e.g. a
  // particle system) must survive encode→decode as an opaque JSON blob.
  it('carries a src= component config blob through the bundle', () => {
    const compiled = compile(`<Scene><Mesh id="a"><BoxGeometry /><Components><Oscillator /></Components></Mesh></Scene>`);
    compiled.components[0]!.config = { rateOverTime: 80, colors: ['#ff0000', '#000000'], looping: true };
    const restored = deserializeBundle(JSON.parse(JSON.stringify(bundleScene(compiled))) as ReturnType<typeof bundleScene>);
    expect(restored.components[0]!.config).toEqual({ rateOverTime: 80, colors: ['#ff0000', '#000000'], looping: true });
  });

  // CORE-IMPROVEMENTS #7: decoding a bundle whose tag isn't registered in this
  // process must fail with an actionable diagnostic, not an opaque undefined deref.
  it('names an unregistered tag on decode instead of dereferencing undefined', () => {
    const bundle = bundleScene(compile(`<Scene><Fog color="#101010" near="1" far="50" /></Scene>`));
    unregisterAttachment('Fog'); // simulate a host that never imported the <Fog> module
    expect(() => deserializeBundle(bundle)).toThrow(/attachment "Fog" is not registered/);
  });
});

describe('serializeScene (CompiledScene → XML)', () => {
  it('round-trips every value type, emitting only non-default attrs with degrees for rotation', () => {
    const scene = compile(EVERY_TYPE);
    expect(compile(serializeScene(scene))).toEqual(scene); // XML round-trip is exact

    const minimal = serializeScene(compile(`<Scene><Mesh rotation="0 90 0"><BoxGeometry /></Mesh></Scene>`));
    expect(minimal).toContain('rotation="0 90 0"'); // radians → degrees
    expect(minimal).not.toMatch(/position=|scale=|visible=/); // defaults elided
  });

  it('synthesizes stable ids for referenced-but-unnamed targets and preserves scoped prefab ids', () => {
    const named = serializeScene(compile(`<Scene>
      <Mesh id="A"><BoxGeometry /><Components><Oscillator /></Components></Mesh>
      <Mesh id="B"><BoxGeometry /><Components><Follow source="#A" /></Components></Mesh>
    </Scene>`));
    expect(named).toMatch(/<Oscillator id="oscillator"/); // unnamed target gets an id
    expect(named).toContain('source="#oscillator"');

    const prefab = `<Prefab><Group id="root"><Mesh id="body"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh></Group></Prefab>`;
    const resolve: ResourceResolver = (req) => (req === 'turbine.prefab.xml' ? { path: req, contents: prefab } : null);
    const scene = compile(
      `<Scene><PrefabInstance src="turbine.prefab.xml" id="t1" /><Mesh id="reader"><BoxGeometry /><Components><Follow source="#t1/osc" /></Components></Mesh></Scene>`,
      { path: '/scene.xml', resolve },
    );
    const serialized = serializeScene(scene);
    expect(serialized).toContain('id="t1/osc"'); // scoped id preserved
    expect(compile(serialized)).toEqual(scene); // recompiles identically, no resolver needed
  });
});
