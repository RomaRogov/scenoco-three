import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import { Behaviour, prefab, ref } from '@scenoco-three/core';
import { snapshot, type SnapshotNode } from '@scenoco-three/core/snapshot';
import { convert } from '../../packages/unity/src/convert.js';
import { snapshotProject } from '../../packages/unity/src/export.js';

const box = new BoxGeometry(1, 1, 1);
const paint = { stone: new MeshStandardMaterial({ color: '#808080', emissive: '#ff0000', emissiveIntensity: 2 }) };

class Grid extends Behaviour {
  size = 4;
}
class Spawner extends Behaviour {
  wave: (() => unknown)[] = [];
  grid: Grid | null = null;
  area: Group | null = null;
}

const Crate = prefab(() => <Mesh geometry={box} material={paint.stone} position={[1, 2, 3]} rotation={[0.5, 0.25, 0]} />);
const Main = () => {
  const grid = ref<Group>();
  return (
    <Scene>
      <PerspectiveCamera args={[40, 1.5, 0.1, 100]} position={[0, 10, 10]} />
      <DirectionalLight position={[0, 10, 0]} />
      <Group ref={grid}>
        <Grid size={6} />
      </Group>
      <Crate />
      <Spawner wave={[Crate]} area={grid} />
    </Scene>
  );
};

describe('unity export', () => {
  it('mirrors three.js into Unity: positions, rotations, meshes, lights, names and references', () => {
    const { data, scripts } = convert(snapshot({ '/src/scenes.tsx': { Crate, Main }, '/src/assets.ts': { box, paint }, '/src/Grid.ts': { Grid }, '/src/Spawner.ts': { Spawner } }), { firstScene: 'Main' });

    // Z mirrored: a position negates z, a rotation x and y of its quaternion.
    const crate = data.prefabs.find((p) => p.path === 'Assets/Prefabs/Crate.prefab')!.root;
    expect(crate.position).toEqual([1, 2, -3]);
    const q = new Mesh().rotation.set(0.5, 0.25, 0).clone();
    const three = new Mesh();
    three.rotation.copy(q);
    expect(crate.rotation.map((v) => Math.round(v * 1e4))).toEqual([-three.quaternion.x, -three.quaternion.y, three.quaternion.z, three.quaternion.w].map((v) => Math.round(v * 1e4)));

    // A box with one material is one submesh, its vertices mirrored and its triangles reversed.
    const mesh = data.meshes.find((m) => m.path === crate.mesh)!;
    expect(mesh.submeshes).toHaveLength(1);
    expect(mesh.vertices.slice(0, 3)).toEqual([0.5, 0.5, -0.5]);
    const [a, b, c] = box.index!.array as Uint16Array;
    expect(mesh.submeshes[0]!.slice(0, 3)).toEqual([a, c, b]);

    // The shared material is one asset; its emission and colour come across.
    expect(data.materials).toEqual([expect.objectContaining({ path: 'Assets/Materials/stone.mat', color: '#808080', emission: '#ff0000', emissionIntensity: 2 })]);

    const scene = data.scenes[0]!;
    expect(scene.path).toBe('Assets/Scenes/Main.unity');
    // A directional light points down at its target: Unity's rotation for straight down.
    const light = scene.roots.find((r) => r.light)!;
    expect(light.light).toMatchObject({ type: 'Directional', intensity: 1 / Math.PI });
    expect(light.rotation.map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0.7071, 0, 0, 0.7071]);
    // A nested prefab is placed by its asset; a field holding a prefab holds the asset.
    expect(scene.roots.find((r) => r.prefab)!.prefab).toBe('Assets/Prefabs/Crate.prefab');
    const spawner = scene.roots[0]!.components.find((c) => c.type === 'Spawner')!;
    expect(spawner.fields.wave).toEqual({ array: [{ asset: 'Assets/Prefabs/Crate.prefab' }] });
    // The scene's own behaviours sit on a first root of their own: a reference into the scene counts it.
    const area = (spawner.fields.area as { node: string }).node.split('/').map(Number);
    expect(scene.roots[area[0]!]!.components.some((c) => c.type === 'GridBehaviour')).toBe(true);

    // A behaviour named like one of Unity's own gets a C# name Unity accepts.
    expect(scene.roots.find((r) => r.components.some((c) => c.type === 'GridBehaviour'))).toBeDefined();
    expect(scripts.get('GridBehaviour')).toContain('public class GridBehaviour : MonoBehaviour');
    expect(scripts.get('GridBehaviour')).toContain('public float size = 4f;');
    expect(scripts.get('Spawner')).toContain('public GameObject[] wave;');
  });

  it("writes each behaviour's TypeScript into its C# stub, member by member", () => {
    const source = `/** Spawns crates. */
export class Spawner extends Behaviour {
  wave: (() => unknown)[] = [];
  private spawned = 0;
  override update(): void {
    if (this.spawned < 3) this.spawned++;
  }
  /** One crate, a frame apart. */
  private *drop(count: number): Generator<Yieldable> {
    yield null;
  }
  get left(): number {
    return 3 - this.spawned;
  }
}`;
    const { scripts } = convert(snapshot({ '/src/scenes.tsx': { Crate, Main }, '/src/Grid.ts': { Grid }, '/src/Spawner.ts': { Spawner } }), {
      source: (file) => (file === '/src/Spawner.ts' ? source : null),
    });
    const stub = scripts.get('Spawner')!;
    // The field the scene wires is real; the others are their TypeScript, for the port to write.
    expect(stub).toContain('public GameObject[] wave;');
    expect(stub).toContain('// private spawned = 0;');
    // A hook is Unity's message, a generator a coroutine, a getter a property — each with its code inside.
    expect(stub).toContain('    void Update()\n    {\n        // override update(): void {\n        //   if (this.spawned < 3) this.spawned++;');
    expect(stub).toContain('    // One crate, a frame apart.\n    private IEnumerator Drop(float count)');
    expect(stub).toContain('yield break;');
    expect(stub).toContain('public float Left');
    // A behaviour whose TypeScript cannot be read keeps the stub of its wired fields.
    expect(scripts.get('GridBehaviour')).toContain('public float size = 4f;');
  });

  it("builds the project's prefabs in its own page", async () => {
    // breakout, through its own Vite and a headless Chrome: what `scenoco-unity` reads.
    const snap = await snapshotProject(fileURLToPath(new URL('../../examples/breakout', import.meta.url)));
    // A particle effect is three.quarks data with no Unity counterpart in the exporter yet: said, and skipped.
    expect(snap.warnings.filter((w) => !w.includes('<ParticleSystem effect>'))).toEqual([]);
    expect(snap.prefabs.map((p) => p.name).sort()).toEqual([
      'BallPrefab', 'BoltPrefab', 'BrickPrefab', 'FirmBurst', 'HardBurst', 'LaserPickup', 'Level1', 'Level2', 'Level3',
      'MultiPickup', 'Run', 'SlimPickup', 'SoftBurst', 'Spark', 'WallPrefab', 'WidePickup',
    ]);
    // Geometry and materials written inside a prefab come across too; two walls of one shape are one mesh asset.
    const all = (n: SnapshotNode): SnapshotNode[] => [n, ...n.children.flatMap(all)];
    const walls = all(snap.prefabs.find((p) => p.name === 'Level1')!.root).filter((n) => /^wall(Left|Right)$/.test(n.name));
    expect(walls).toHaveLength(2);
    const body = (wall: SnapshotNode) => all(wall).find((n) => n.geometry !== undefined && n.materials?.length)!;
    expect(body(walls[0]!).geometry).toBe(body(walls[1]!).geometry);
    expect(snap.materials[body(walls[0]!).materials![0]!]).toMatchObject({ color: '#1b2540', shared: false });
  }, 60_000);
});
