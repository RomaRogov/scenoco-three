import { describe, expect, it } from 'vitest';
import type { Object3D } from 'three';
import {
  Component,
  component,
  property,
  Engine,
  deserializeBundle,
  PrefabRef,
} from '@scenoco-three/core';
import { bundleScene, compileSceneXml, type CompileResult, type ResourceResolver } from '@scenoco-three/compiler';

/**
 * A `@property({ type: 'prefab' })` field receives a PrefabRef whose `.spawn()`
 * instantiates a build-time-embedded prefab — no bundle/instantiate machinery in
 * the component. This is the primitive behind reusable layout/spawner components.
 */
@component({ name: 'PrefabSpawner', description: 'Spawns N copies of a prefab on load' })
class PrefabSpawner extends Component {
  @property({ type: 'prefab', description: 'prefab to spawn' })
  prefab: PrefabRef | null = null;

  @property({ type: 'int', default: 3, description: 'how many to spawn' })
  count = 3;

  readonly spawned: Object3D[] = [];

  override onLoad(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.prefab) this.spawned.push(this.prefab.spawn({ parent: this.node, position: [i, 0, 0] }));
    }
  }

  override onDestroy(): void {
    for (const s of this.spawned) this.engine.destroy(s);
    this.spawned.length = 0;
  }
}

const cube = '<Prefab><Mesh><BoxGeometry /><MeshStandardMaterial color="#888" /></Mesh></Prefab>';

function resolver(files: Record<string, string>): ResourceResolver {
  return (request) => (request in files ? { path: request, contents: files[request]! } : null);
}
function compileScene(xml: string, files: Record<string, string> = { 'cube.prefab.xml': cube }): CompileResult {
  return compileSceneXml(xml, { path: '/scene.xml', resolve: resolver(files) });
}

const SCENE = `<Scene>
  <Object3D id="spawner">
    <Components><PrefabSpawner prefab="cube.prefab.xml" count="3" /></Components>
  </Object3D>
</Scene>`;

describe('prefab property kind', () => {
  it('resolves, compiles, and embeds the referenced prefab', () => {
    const r = compileScene(SCENE);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    expect(r.scene.prefabs).toHaveLength(1);
    expect(r.scene.prefabs![0]!.nodes.map((n) => n.tag)).toEqual(['Mesh']);
    const spawner = r.scene.components.find((c) => c.type === 'PrefabSpawner')!;
    expect(spawner.props.prefab).toEqual({ prefab: 0 });
  });

  it('survives the bundle encode/decode round-trip', () => {
    const r = compileScene(SCENE);
    if (!r.ok) throw new Error('compile failed');
    const round = deserializeBundle(bundleScene(r.scene));
    expect(round.prefabs).toHaveLength(1);
    expect(round.components.find((c) => c.type === 'PrefabSpawner')!.props.prefab).toEqual({ prefab: 0 });
  });

  it('a prefab-free scene keeps the 4-element asset shape (no prefabs slot)', () => {
    const r = compileScene('<Scene><Object3D id="x" /></Scene>');
    if (!r.ok) throw new Error('compile failed');
    expect(r.scene.prefabs).toBeUndefined();
    const bundle = bundleScene(r.scene);
    expect(bundle[2]).toHaveLength(4); // [nodes, attachments, components, root]
  });

  it('hands the component a PrefabRef whose spawn() builds a live subtree', () => {
    const r = compileScene(SCENE);
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine(); // headless
    engine.loadScene(deserializeBundle(bundleScene(r.scene)));

    const spawner = engine.findComponent('spawner') as PrefabSpawner;
    expect(spawner).toBeInstanceOf(PrefabSpawner);
    expect(spawner.prefab).toBeInstanceOf(PrefabRef);
    expect(spawner.spawned).toHaveLength(3);

    let meshes = 0;
    engine.scene.traverse((o) => { if (o.type === 'Mesh') meshes++; });
    expect(meshes).toBe(3);

    // Reload hygiene: disposing the scene tears the spawned instances down too.
    engine.disposeScene();
    let after = 0;
    engine.scene.traverse((o) => { if (o.type === 'Mesh') after++; });
    expect(after).toBe(0);
  });

  it('rejects a `#id` value — a prefab prop is a file path, not a reference', () => {
    const r = compileScene(`<Scene><Object3D id="s">
      <Components><PrefabSpawner prefab="#cube" /></Components>
    </Object3D></Scene>`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.some((d) => d.code === 'bad-value')).toBe(true);
  });

  it('reports a missing prefab file against the referencing element', () => {
    const r = compileScene(SCENE, {}); // no files registered
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.some((d) => d.code === 'resource-not-found')).toBe(true);
  });
});
