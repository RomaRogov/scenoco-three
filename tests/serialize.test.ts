import { describe, expect, it } from 'vitest';
import type { CompiledScene } from '@scenoco-three/core';
import {
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

describe('serializeScene', () => {
  it('round-trips a scene with every value type, transform, nesting, and refs', () => {
    const scene = compile(`<Scene>
      <PointLight id="lamp" color="#ffcc66" intensity="20" position="2 3 1" />
      <Group id="rig" rotation="0 90 0" scale="2 2 2">
        <Mesh id="hero" position="0 1 0">
          <TorusGeometry radius="2" tube="0.3" />
          <MeshStandardMaterial color="#4f8ef7" metalness="0.6" transparent="true" />
          <Components>
            <Oscillator id="bob" axis="1 0 0" amplitude="0.5" />
            <Rotator speed="3.14" />
          </Components>
        </Mesh>
        <Mesh id="chaser"><BoxGeometry />
          <Components>
            <Follow source="#bob" scale="2" />
            <LookAt target="#hero" />
          </Components>
        </Mesh>
      </Group>
    </Scene>`);
    const restored = compile(serializeScene(scene));
    expect(restored).toEqual(scene);
  });

  it('emits only non-default attributes', () => {
    const xml = serializeScene(compile(`<Scene><Mesh><BoxGeometry /></Mesh></Scene>`));
    expect(xml).toContain('<Mesh>'); // no id/transform/attrs
    expect(xml).toContain('<BoxGeometry />'); // all-default geometry
    expect(xml).not.toMatch(/position=|width=|visible=/);
  });

  it('converts radians back to degrees', () => {
    const xml = serializeScene(compile(`<Scene><Mesh rotation="0 90 0"><BoxGeometry /></Mesh></Scene>`));
    expect(xml).toContain('rotation="0 90 0"');
  });

  it('synthesizes a stable id for a referenced-but-unnamed target', () => {
    // Follow references node "A" (whose Oscillator has no id of its own).
    const xml = `<Scene>
      <Mesh id="A"><BoxGeometry /><Components><Oscillator /></Components></Mesh>
      <Mesh id="B"><BoxGeometry /><Components><Follow source="#A" /></Components></Mesh>
    </Scene>`;
    const serialized = serializeScene(compile(xml));
    // The unnamed Oscillator gets an id so the reference survives.
    expect(serialized).toMatch(/<Oscillator id="oscillator"/);
    expect(serialized).toContain('source="#oscillator"');
    // …and it recompiles (and re-serializing is stable).
    const recompiled = compile(serialized);
    expect(serializeScene(recompiled)).toBe(serialized);
  });

  it('round-trips a prefab-expanded scene (scoped "/" ids survive)', () => {
    const prefab = `<Prefab><Group id="root"><Mesh id="body"><BoxGeometry /><Components><Oscillator id="osc" amplitude="0.5" /></Components></Mesh></Group></Prefab>`;
    const resolve: ResourceResolver = (req) =>
      req === 'turbine.prefab.xml' ? { path: req, contents: prefab } : null;
    const scene = compile(
      `<Scene>
        <PrefabInstance src="turbine.prefab.xml" id="t1" position="0 0 0" />
        <Mesh id="reader"><BoxGeometry /><Components><Follow source="#t1/osc" /></Components></Mesh>
      </Scene>`,
      { path: '/scene.xml', resolve },
    );
    const serialized = serializeScene(scene);
    expect(serialized).toContain('id="t1/osc"'); // scoped id preserved
    expect(serialized).toContain('source="#t1/osc"');
    expect(compile(serialized)).toEqual(scene); // re-compiles identically, no resolver needed
  });
});
