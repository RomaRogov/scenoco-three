import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, DirectionalLight, Fog, Group, Mesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from 'three';
import { Behaviour, prefab, ref } from '@scenoco-three/core';
import { snapshot, type SnapshotNode } from '@scenoco-three/core/snapshot';

// A small game, as modules by path: what the exporter's page hands `snapshot`.
const shapes = { block: new BoxGeometry(1, 1, 1) };
const paint = { stone: new MeshStandardMaterial({ color: '#808080' }) };

class Turret extends Behaviour {
  range = 5;
  aim = new Vector3();
  head: Object3D | null = null;
  shots: (() => unknown)[] = [];
  started = false;
  override awake() {
    this.started = true;
  }
}

const Bolt = prefab(() => <Mesh geometry={shapes.block} material={paint.stone} scale={0.2} />);
/** A plain function: a component, copied in where it is used. */
const Plinth = () => <Mesh geometry={shapes.block} material={paint.stone} scale={[2, 0.2, 2]} />;
const Base = prefab(() => (
  <Group>
    <Mesh geometry={shapes.block} material={paint.stone} />
    {/* The same box, spelled again: one geometry. A material written here is this element's own. */}
    <Mesh position={[0, 1, 0]}>
      <BoxGeometry args={[1, 1, 1]} />
      <MeshStandardMaterial color="#808080" />
    </Mesh>
  </Group>
));
const Tower = prefab(() => {
  const head = ref<Group>();
  return (
    <Group>
      <Base />
      <Group ref={head} position={[0, 2, -3]} />
      <Turret range={9} aim={[0, 0, -1]} head={head} shots={[Bolt]} />
      <Plinth />
    </Group>
  );
});
const Level = () => (
  <Scene>
    <Color attach="background" args={['#112233']} />
    <Fog attach="fog" args={['#ffffff', 10, 50]} />
    <DirectionalLight position={[0, 10, 0]} />
    <Tower />
  </Scene>
);

const game = { '/src/prefabs.tsx': { Bolt, Plinth, Base, Tower, Level }, '/src/assets.ts': { shapes, paint }, '/src/Turret.ts': { Turret } };
const find = (root: SnapshotNode, test: (n: SnapshotNode) => boolean): SnapshotNode | undefined =>
  test(root) ? root : root.children.map((c) => find(c, test)).find(Boolean);

describe('snapshot', () => {
  it('writes down what the prefabs declare, sharing exactly what three.js shares', () => {
    const out = snapshot(game);
    const prefab = (name: string) => out.prefabs.find((p) => p.name === name)!;
    expect(out.warnings).toEqual([]);

    // A nested prefab is a reference to it, not a copy of what it built.
    const tower = prefab('Tower').root;
    expect(tower.children[0]).toMatchObject({ prefab: '/src/prefabs.tsx#Base', children: [] });
    expect(find(prefab('Level').root, (n) => n.prefab === '/src/prefabs.tsx#Tower')).toBeDefined();
    // A plain function is no prefab: what it built is copied in.
    expect(out.prefabs.map((p) => p.name)).not.toContain('Plinth');
    expect(tower.children[2]!.prefab).toBeUndefined();
    expect(tower.children[2]!.scale).toEqual([2, 0.2, 2]);

    // Behaviours are dormant, and only what their element wrote is written down — refs by path.
    const turret = tower.components[0]!;
    expect(turret).toMatchObject({ type: 'Turret', game: true, fields: { range: 9, aim: { v3: [0, 0, -1] }, head: { node: '1' }, shots: { array: [{ prefab: '/src/prefabs.tsx#Bolt' }] } } });
    expect(Object.keys(turret.fields)).not.toContain('started');
    expect(out.classes.Turret).toEqual({ file: '/src/Turret.ts', defaults: { range: 5, aim: { v3: [0, 0, 0] }, head: null, shots: { array: [] } } });

    // One geometry for the shared box and its respelling; the shared material once, named by its key.
    const [first, second] = prefab('Base').root.children;
    expect(first!.geometry).toBe(second!.geometry);
    expect(out.geometries[first!.geometry!]!.name).toBe('block');
    const stone = out.materials[first!.materials![0]!]!;
    const own = out.materials[second!.materials![0]!]!;
    expect(stone).toMatchObject({ name: 'stone', shared: true, color: '#808080' });
    expect(own).toMatchObject({ shared: false, color: '#808080' });
    expect(prefab('Bolt').root.materials).toEqual(first!.materials);

    // A scene keeps its settings; a light records where it points, since three aims it at a target.
    expect(prefab('Level')).toMatchObject({ scene: true, background: '#112233', fog: { type: 'linear', near: 10, far: 50 } });
    expect(find(prefab('Level').root, (n) => !!n.light)!.light).toMatchObject({ type: 'DirectionalLight', direction: [0, -1, 0] });
  });

  it('reports a declaration that changes between builds', () => {
    const Scatter = prefab(() => <Mesh geometry={shapes.block} position={[Math.random(), 0, 0]} />);
    const out = snapshot({ '/src/scatter.tsx': { Scatter } });
    expect(out.warnings).toEqual([expect.stringMatching(/scatter\.tsx#Scatter: two builds differ/)]);
  });
});
