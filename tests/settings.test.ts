import { Color, Fog, FogExp2 } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine, bundleKind, deserializeBundle } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, serializeScene } from '@scenoco-three/compiler';

function compile(xml: string) {
  const result = compileSceneXml(xml);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.scene;
}

describe('scene settings as attachments (goal 6)', () => {
  it('compiles <Scene> attachment children into the attachments pool', () => {
    const scene = compile(`<Scene>
      <Fog color="#102030" near="5" far="50" />
      <Background color="#000000" />
      <Mesh id="m"><BoxGeometry /></Mesh>
    </Scene>`);
    const sceneNode = scene.nodes[scene.root]!;
    const tags = sceneNode.attachments.map((i) => scene.attachments[i]!.tag);
    expect(tags).toEqual(['Fog', 'Background']);
    const fog = scene.attachments.find((a) => a.tag === 'Fog')!;
    expect(fog.attrs.far).toBe(50);
  });

  it('applies fog and background to the live THREE.Scene on load', () => {
    const engine = new Engine();
    engine.loadScene(compile(`<Scene><Fog color="#112233" near="1" far="20" /><Background color="#445566" /></Scene>`));
    expect(engine.scene.fog).toBeInstanceOf(Fog);
    expect((engine.scene.fog as Fog).far).toBe(20);
    expect((engine.scene.background as Color).getHex()).toBe(0x445566);
    // A scene without these clears the previous ones.
    engine.loadScene(compile(`<Scene><Mesh id="m"><BoxGeometry /></Mesh></Scene>`));
    expect(engine.scene.fog).toBeNull();
    expect(engine.scene.background).toBeNull();
    engine.dispose();
  });

  it('supports FogExp2', () => {
    const engine = new Engine();
    engine.loadScene(compile(`<Scene><FogExp2 color="#223344" density="0.05" /></Scene>`));
    expect(engine.scene.fog).toBeInstanceOf(FogExp2);
    expect((engine.scene.fog as FogExp2).density).toBe(0.05);
    engine.dispose();
  });

  it('rejects an attachment on the wrong target and duplicates in a group', () => {
    const misplaced = compileSceneXml(`<Scene><Mesh id="m"><BoxGeometry /><Fog /></Mesh></Scene>`);
    expect(misplaced.ok).toBe(false);
    if (!misplaced.ok) expect(misplaced.diagnostics.some((d) => d.code === 'attachment-wrong-target')).toBe(true);

    // <Fog> and <FogExp2> share the "fog" group → mutually exclusive.
    const dup = compileSceneXml(`<Scene><Fog /><FogExp2 /></Scene>`);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.diagnostics.some((d) => d.code === 'duplicate-attachment')).toBe(true);
  });

  it('round-trips through the bundle (v3) and back to XML', () => {
    const scene = compile(`<Scene><Fog color="#102030" near="5" far="50" /><Mesh id="m"><BoxGeometry /></Mesh></Scene>`);
    const bundle = bundleScene(scene);
    expect(bundleKind(bundle)).toBe('scene');
    expect(deserializeBundle(bundle)).toEqual(scene); // anchor invariant
    // asset is [nodes, attachments, components, root].
    expect((bundle[2] as unknown[]).length).toBe(4);

    const xml = serializeScene(scene);
    expect(xml).toContain('<Fog');
    expect(xml).toContain('far="50"');
    expect(compile(xml).attachments.some((a) => a.tag === 'Fog')).toBe(true);
  });
});
