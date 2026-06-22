import { Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine, deserializeBundle, bundleKind, type CompiledScene } from '@scenoco-three/core';
import {
  bundlePrefab,
  bundleScene,
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
  <Group id="root">
    <Mesh id="body">
      <CylinderGeometry height="2" />
      <MeshStandardMaterial src="steel.material.xml" />
      <Components>
        <Rotator speed="2" />
        <Oscillator id="osc" amplitude="0.5" />
      </Components>
    </Mesh>
  </Group>
</Prefab>`;
const files = { 'turbine.prefab.xml': turbine, 'steel.material.xml': steel };

function compileScene(xml: string, extra: Record<string, string> = {}): CompileResult {
  return compileSceneXml(xml, { path: '/scene.xml', resolve: resolver({ ...files, ...extra }) });
}
const ok = (r: CompileResult): CompiledScene => {
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.scene;
};

describe('prefab static expansion', () => {
  const scene = ok(
    compileScene(`<Scene>
      <PrefabInstance src="turbine.prefab.xml" id="t1" position="0 0 0" />
      <PrefabInstance src="turbine.prefab.xml" id="t2" position="5 0 0">
        <Override target="#osc" amplitude="1.5" />
        <Override target="#body" rotation="0 0 90" />
      </PrefabInstance>
      <Mesh id="reader"><BoxGeometry /><Components>
        <Follow source="#t2/osc" /><LookAt target="#t1" />
      </Components></Mesh>
    </Scene>`),
  );

  it('expands an instance to ordinary nodes (no <PrefabInstance> survives)', () => {
    expect(scene.nodes.some((n) => n.tag === 'PrefabInstance')).toBe(false);
    expect(scene.nodes.find((n) => n.id === 't1')?.tag).toBe('Group');
    expect(scene.nodes.find((n) => n.id === 't1/body')?.tag).toBe('Mesh');
  });

  it('namespaces internal ids into each instance scope', () => {
    expect(scene.components.some((c) => c.id === 't1/osc')).toBe(true);
    expect(scene.components.some((c) => c.id === 't2/osc')).toBe(true);
  });

  it('applies the instance transform', () => {
    expect(scene.nodes.find((n) => n.id === 't2')?.transform.position).toEqual([5, 0, 0]);
  });

  it('applies <Override> to the right instance only', () => {
    const t1 = scene.components.find((c) => c.id === 't1/osc')!;
    const t2 = scene.components.find((c) => c.id === 't2/osc')!;
    expect(t1.props.amplitude).toBe(0.5); // prefab value kept
    expect(t2.props.amplitude).toBe(1.5); // overridden
    const body2 = scene.nodes.find((n) => n.id === 't2/body')!;
    expect(body2.transform.rotation[2]).toBeCloseTo(Math.PI / 2); // 90° override
  });

  it('shares the material resource across both instances', () => {
    const bodies = scene.nodes.filter((n) => n.id?.endsWith('/body'));
    expect(bodies).toHaveLength(2);
    const matOf = (n: (typeof bodies)[number]) =>
      n.attachments.find((i) => scene.attachments[i]!.tag === 'MeshStandardMaterial');
    expect(matOf(bodies[0]!)).toBe(matOf(bodies[1]!)); // deduped → same pool index
  });

  it('lets the scene reference an instance internal by scoped id', () => {
    const follow = scene.components.find((c) => c.type === 'Follow')!;
    const t2osc = scene.components.findIndex((c) => c.id === 't2/osc');
    expect(follow.props.source).toEqual({ component: t2osc });
  });
});

describe('prefab diagnostics', () => {
  const err = (r: CompileResult): string => (r.ok ? '(no error)' : r.diagnostics[0]!.code);

  it('requires a self-contained prefab (dangling ref fails against the prefab file)', () => {
    const r = compileScene(`<Scene><PrefabInstance src="bad.prefab.xml" id="x" /></Scene>`, {
      'bad.prefab.xml': `<Prefab><Mesh id="b"><BoxGeometry /><Components><LookAt target="#nope" /></Components></Mesh></Prefab>`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostics[0]!.code).toBe('unresolved-ref');
      expect(r.diagnostics[0]!.file).toBe('bad.prefab.xml');
    }
  });

  it('requires an id on the instance', () => {
    expect(err(compileScene(`<Scene><PrefabInstance src="turbine.prefab.xml" /></Scene>`))).toBe('prefab-missing-id');
  });

  it('requires src on a <PrefabInstance>', () => {
    expect(err(compileScene(`<Scene><PrefabInstance id="x" /></Scene>`))).toBe('prefab-missing-src');
  });

  it('reports a missing prefab file', () => {
    expect(err(compileScene(`<Scene><PrefabInstance src="ghost.prefab.xml" id="x" /></Scene>`))).toBe('prefab-not-found');
  });

  it('rejects an <Override> targeting a nonexistent internal id', () => {
    expect(
      err(compileScene(`<Scene><PrefabInstance src="turbine.prefab.xml" id="x"><Override target="#ghost" amplitude="1" /></PrefabInstance></Scene>`)),
    ).toBe('override-unknown-target');
  });

  it('validates <Override> values against the target schema', () => {
    expect(
      err(compileScene(`<Scene><PrefabInstance src="turbine.prefab.xml" id="x"><Override target="#osc" amplitude="huge" /></PrefabInstance></Scene>`)),
    ).toBe('bad-value');
  });

  it('detects a prefab cycle', () => {
    const a = `<Prefab><Group id="g"><PrefabInstance src="b.prefab.xml" id="inner" /></Group></Prefab>`;
    const b = `<Prefab><Group id="g"><PrefabInstance src="a.prefab.xml" id="inner" /></Group></Prefab>`;
    expect(
      err(compileScene(`<Scene><PrefabInstance src="a.prefab.xml" id="x" /></Scene>`, { 'a.prefab.xml': a, 'b.prefab.xml': b })),
    ).toBe('prefab-cycle');
  });

  it('rejects a prefab file with more than one root node', () => {
    const r = compilePrefabXml(`<Prefab><Mesh id="a"><BoxGeometry /></Mesh><Mesh id="b"><BoxGeometry /></Mesh></Prefab>`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]!.code).toBe('bad-prefab-root');
  });
});

describe('nested prefabs (goal 3)', () => {
  // An outer prefab whose body contains a <PrefabInstance> of an inner prefab.
  const inner = `<Prefab><Mesh id="bulb"><SphereGeometry /><Components><Oscillator id="osc" amplitude="0.2" /></Components></Mesh></Prefab>`;
  const outer = `<Prefab><Group id="rig"><PrefabInstance src="inner.prefab.xml" id="lamp" /></Group></Prefab>`;
  const nestedFiles = { 'inner.prefab.xml': inner, 'outer.prefab.xml': outer };

  const scene = ok(
    compileScene(`<Scene><PrefabInstance src="outer.prefab.xml" id="t1" /></Scene>`, nestedFiles),
  );

  it('composes scoped ids across both nesting levels (t1/lamp/osc)', () => {
    expect(scene.nodes.find((n) => n.id === 't1')?.tag).toBe('Group');
    expect(scene.nodes.find((n) => n.id === 't1/lamp')?.tag).toBe('Mesh');
    expect(scene.components.some((c) => c.id === 't1/lamp/osc')).toBe(true);
  });

  it('leaves no <PrefabInstance> in the compiled output', () => {
    expect(scene.nodes.some((n) => n.tag === 'PrefabInstance')).toBe(false);
  });

  it('the scene can reference a deeply-nested internal by its composed id', () => {
    const r = compileScene(
      `<Scene>
        <PrefabInstance src="outer.prefab.xml" id="t1" />
        <Mesh id="reader"><BoxGeometry /><Components><Follow source="#t1/lamp/osc" /></Components></Mesh>
      </Scene>`,
      nestedFiles,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const oscIndex = r.scene.components.findIndex((c) => c.id === 't1/lamp/osc');
    const follow = r.scene.components.find((c) => c.type === 'Follow')!;
    expect(follow.props.source).toEqual({ component: oscIndex });
  });
});

describe('prefab dynamic instantiation', () => {
  const prefabBundle = bundlePrefab(ok(compilePrefabXml(turbine, { path: '/p', resolve: resolver(files) })));

  it('marks the bundle as a prefab', () => {
    expect(bundleKind(prefabBundle)).toBe('prefab');
    expect(deserializeBundle(prefabBundle)).toBeDefined();
  });

  it('spawns independent instances and ticks them', () => {
    const engine = new Engine();
    const a = engine.instantiate(prefabBundle);
    const b = engine.instantiate(prefabBundle);
    a.position.set(-3, 0, 0);
    b.position.set(3, 0, 0);
    expect(engine.scene.children).toContain(a);
    expect(a).not.toBe(b);

    const bodyA = a.getObjectByName('body') as Mesh;
    engine.tick(0.5);
    expect(bodyA.rotation.y).toBeCloseTo(1); // Rotator speed 2 × 0.5s
  });

  it('destroy() removes just that subtree', () => {
    const engine = new Engine();
    const a = engine.instantiate(prefabBundle);
    const b = engine.instantiate(prefabBundle);
    engine.destroy(a);
    expect(engine.scene.children).not.toContain(a);
    expect(engine.scene.children).toContain(b);
    // Destroyed instance's components no longer tick.
    expect(() => engine.tick(0.1)).not.toThrow();
  });

  it('rejects a prefab bundle passed to loadScene', () => {
    const engine = new Engine();
    expect(() => engine.loadScene(prefabBundle)).toThrow(/prefab bundle/);
  });
});

describe('prefab round-trips through the bundle', () => {
  it('an expanded scene bundles and decodes exactly', () => {
    const compiled = ok(
      compileScene(`<Scene>
        <PrefabInstance src="turbine.prefab.xml" id="t1" position="1 2 3" />
      </Scene>`),
    );
    expect(deserializeBundle(bundleScene(compiled))).toEqual(compiled);
  });
});
