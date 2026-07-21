import { Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine, PrefabAsset, PrefabInstance, bundleKind, type CompiledScene } from '@scenoco-three/core';
import {
  bundlePrefab,
  compilePrefabXml,
  compileSceneXml,
  type CompileResult,
  type ResourceResolver,
} from '@scenoco-three/compiler';

function resolver(files: Record<string, string>): ResourceResolver {
  return (request) => (request in files ? { path: request, contents: files[request]! } : null);
}
const steel = '<MeshStandardMaterial color="#8a8f99" roughness="0.3" />';
const turbine = `<Prefab>
  <Group id="root"><Mesh id="body">
    <Attachments>
      <CylinderGeometry height="2" /><MeshStandardMaterial src="steel.material.xml" />
    </Attachments>
    <Components><Rotator speed="2" /><Oscillator id="osc" amplitude="0.5" /></Components>
  </Mesh></Group>
</Prefab>`;
const files = { 'turbine.prefab.xml': turbine, 'steel.material.xml': steel };
function compileScene(xml: string, extra: Record<string, string> = {}): CompileResult {
  return compileSceneXml(xml, { path: '/scene.xml', resolve: resolver({ ...files, ...extra }) });
}
const ok = (r: CompileResult): CompiledScene => {
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.scene;
};
const err = (r: CompileResult): string => (r.ok ? '(no error)' : r.diagnostics[0]!.code);

function bySceneId(root: import('three').Object3D, id: string): import('three').Object3D | undefined {
  let found: import('three').Object3D | undefined;
  root.traverse((o) => { if (!found && o.sceneId === id) found = o; });
  return found;
}

describe('prefab static expansion', () => {
  it('expands instances to ordinary nodes, namespaces internal ids, applies transform + per-instance <Override>', () => {
    const scene = ok(
      compileScene(`<Scene>
        <PrefabInstance src="turbine.prefab.xml" id="t1" />
        <PrefabInstance src="turbine.prefab.xml" id="t2" position="5 0 0">
          <Override target="#osc" amplitude="1.5" /><Override target="#body" eulerAngles="0 0 90" />
        </PrefabInstance>
      </Scene>`),
    );
    expect(scene.nodes.some((n) => n.tag === 'PrefabInstance')).toBe(false); // fully expanded
    expect(scene.nodes.find((n) => n.id === 't1/body')?.tag).toBe('Mesh'); // scoped ids
    expect(scene.components.some((c) => c.id === 't2/osc')).toBe(true);
    expect(scene.nodes.find((n) => n.id === 't2')?.transform.position).toEqual([5, 0, 0]);
    expect(scene.components.find((c) => c.id === 't1/osc')!.props.amplitude).toBe(0.5); // prefab value kept
    expect(scene.components.find((c) => c.id === 't2/osc')!.props.amplitude).toBe(1.5); // overridden
    expect(scene.nodes.find((n) => n.id === 't2/body')!.transform.eulerAngles[2]).toBe(90); // degrees
  });

  it('reports prefab diagnostics: missing src/id, not-found, unknown override target, and cycles', () => {
    expect(err(compileScene(`<Scene><PrefabInstance src="turbine.prefab.xml" /></Scene>`))).toBe('prefab-missing-id');
    expect(err(compileScene(`<Scene><PrefabInstance id="x" /></Scene>`))).toBe('prefab-missing-src');
    expect(err(compileScene(`<Scene><PrefabInstance src="ghost.prefab.xml" id="x" /></Scene>`))).toBe('prefab-not-found');
    expect(
      err(compileScene(`<Scene><PrefabInstance src="turbine.prefab.xml" id="x"><Override target="#ghost" amplitude="1" /></PrefabInstance></Scene>`)),
    ).toBe('override-unknown-target');
    const a = `<Prefab><Group id="g"><PrefabInstance src="b.prefab.xml" id="inner" /></Group></Prefab>`;
    const b = `<Prefab><Group id="g"><PrefabInstance src="a.prefab.xml" id="inner" /></Group></Prefab>`;
    expect(err(compileScene(`<Scene><PrefabInstance src="a.prefab.xml" id="x" /></Scene>`, { 'a.prefab.xml': a, 'b.prefab.xml': b }))).toBe('prefab-cycle');
  });

  it('composes scoped ids across nested prefabs, referenceable by the composed id', () => {
    const inner = `<Prefab><Mesh id="bulb"><Attachments><SphereGeometry /></Attachments><Components><Oscillator id="osc" amplitude="0.2" /></Components></Mesh></Prefab>`;
    const outer = `<Prefab><Group id="rig"><PrefabInstance src="inner.prefab.xml" id="lamp" /></Group></Prefab>`;
    const nested = { 'inner.prefab.xml': inner, 'outer.prefab.xml': outer };
    const r = compileScene(
      `<Scene><PrefabInstance src="outer.prefab.xml" id="t1" /><Mesh id="reader"><Attachments><BoxGeometry /></Attachments><Components><Follow source="#t1/lamp/osc" /></Components></Mesh></Scene>`,
      nested,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.components.some((c) => c.id === 't1/lamp/osc')).toBe(true);
    const oscIndex = r.scene.components.findIndex((c) => c.id === 't1/lamp/osc');
    expect(r.scene.components.find((c) => c.type === 'Follow')!.props.source).toEqual({ component: oscIndex });
  });

});

describe('prefab dynamic instantiation', () => {
  const prefabBundle = bundlePrefab(ok(compilePrefabXml(turbine, { path: '/p', resolve: resolver(files) })));

  it('marks the bundle a prefab, spawns independent live instances, and rejects loadScene', () => {
    expect(bundleKind(prefabBundle)).toBe('prefab');
    const engine = new Engine();
    const a = engine.instantiate(prefabBundle);
    const b = engine.instantiate(prefabBundle);
    expect(a).not.toBe(b);
    engine.tick(0.5);
    expect((bySceneId(a, 'body') as Mesh).rotation.y).toBeCloseTo(1); // Rotator speed 2 × 0.5s

    engine.destroy(a);
    engine.tick(0); // deferred destruction flushes at end of tick
    expect(engine.scene.children).not.toContain(a);
    expect(engine.scene.children).toContain(b); // sibling instance untouched
    expect(() => engine.loadScene(prefabBundle)).toThrow(/prefab bundle/);
    engine.dispose();
  });

  it('spawns a PrefabInstance root that holds its PrefabAsset and exposes internals by slash-scoped id', () => {
    const engine = new Engine();
    const inst = engine.instantiate(prefabBundle);
    expect(inst).toBeInstanceOf(PrefabInstance);
    expect(inst.prefabAsset).toBeInstanceOf(PrefabAsset); // re-instantiation handle, set automatically

    // Name the instance, then reach its internals via `instanceId/innerId`.
    inst.sceneId = 'turbineA';
    expect(engine.findObject('turbineA/body')).toBe(bySceneId(inst, 'body'));
    expect(engine.findObject('turbineA/nope')).toBeUndefined();

    // Re-instantiate straight off the existing instance (no original ref needed).
    const clone = inst.prefabAsset!.spawn();
    expect(clone).toBeInstanceOf(PrefabInstance);
    expect(clone).not.toBe(inst);
    engine.dispose();
  });

  it('PrefabAsset.describe() labels a prefab by its root id, for readable telemetry', () => {
    const ref = new PrefabAsset(ok(compilePrefabXml(turbine, { path: '/p', resolve: resolver(files) })), () => new Object3D());
    expect(ref.describe()).toBe('root'); // the turbine's <Group id="root"> — not "[object Object]"
  });
});

describe('compiler provenance', () => {
  it('classifies node origins (prefab root/internal, scene) and records the src a material came from', () => {
    const prefab = `<Prefab><Group id="root"><Mesh id="inner"><Attachments><BoxGeometry /><MeshStandardMaterial color="#ff0000" /></Attachments></Mesh></Group></Prefab>`;
    const r = compileScene(
      `<Scene>
        <PrefabInstance src="thing.prefab.xml" id="t1" position="1 0 0" />
        <Mesh id="solo"><Attachments><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Attachments></Mesh>
      </Scene>`,
      { 'thing.prefab.xml': prefab },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const originOf = (id: string) => r.provenance.nodes[r.scene.nodes.findIndex((n) => n.id === id)];
    expect(originOf('t1')).toEqual({ kind: 'prefab-root', src: 'thing.prefab.xml' });
    expect(originOf('t1/inner')).toEqual({ kind: 'prefab-internal' });
    expect(originOf('solo')).toEqual({ kind: 'scene' });
    expect(r.provenance.attachments).toContain('steel.material.xml');
  });
});
