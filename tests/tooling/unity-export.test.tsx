import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { BoxGeometry, DirectionalLight, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { Behaviour, loadAssets, prefab, ref, sharedModel } from '@scenoco-three/core';
import { SplineAnimate, SplineContainer, SplineExtrude, SplineInstantiate, SplineMesh } from '@scenoco-three/splines';
import { AudioSource } from '@scenoco-three/audio';
import { MeshCollider } from '@scenoco-three/rapier';
import { Tonemapping, Volume } from '@scenoco-three/postprocessing';
import { snapshot, type SnapshotNode } from '@scenoco-three/core/snapshot';
import { Terrain, TerrainData, TerrainLayer } from '@scenoco-three/terrain';
import { convert } from '../../packages/unity/src/convert.js';
import { serializedFields, snapshotProject, usesTweens } from '../../packages/unity/src/export.js';
import { eulerAngles, twins } from '../../packages/unity/src/twin.js';

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
    // The scene's own behaviours are on one object that holds the whole scene, as three's Scene does:
    // DontDestroyOnLoad on it keeps the scene.
    expect(scene.roots).toHaveLength(1);
    const holder = scene.roots[0]!;
    expect(holder.name).toBe('Main');
    const inside = holder.children;
    // A directional light points down at its target: Unity's rotation for straight down.
    const light = inside.find((r) => r.light)!;
    expect(light.light).toMatchObject({ type: 'Directional', intensity: 1 / Math.PI });
    expect(light.rotation.map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0.7071, 0, 0, 0.7071]);
    // A nested prefab is placed by its asset; a field holding a prefab holds the asset.
    expect(inside.find((r) => r.prefab)!.prefab).toBe('Assets/Prefabs/Crate.prefab');
    const spawner = holder.components.find((c) => c.type === 'Spawner')!;
    expect(spawner.fields.wave).toEqual({ array: [{ asset: 'Assets/Prefabs/Crate.prefab' }] });
    // A reference into the scene starts at the object that holds it.
    const [first, at] = (spawner.fields.area as { node: string }).node.split('/').map(Number);
    expect(first).toBe(0);
    expect(inside[at!]!.components.some((c) => c.type === 'GridBehaviour')).toBe(true);

    // A behaviour named like one of Unity's own gets a C# name Unity accepts.
    expect(scripts.get('GridBehaviour')).toContain('public class GridBehaviour : MonoBehaviour');
    expect(scripts.get('GridBehaviour')).toContain('public float size = 4f;');
    expect(scripts.get('Spawner')).toContain('public GameObject[] wave;');
  });

  it("writes prefabs and scenes as Scenoco's text, wiring only the fields a class declares", () => {
    const { data } = convert(snapshot({ '/src/scenes.tsx': { Crate, Main }, '/src/assets.ts': { box, paint }, '/src/Grid.ts': { Grid }, '/src/Spawner.ts': { Spawner } }), { firstScene: 'Main' });
    const declared: Record<string, string> = { GridBehaviour: 'public float size = 4f;', Spawner: 'public GameObject[] wave;\n    public Transform area;' };
    const { files, warnings } = twins(data, { declares: (type, field) => serializedFields(declared[type] ?? '').has(field), eventSystem: true });

    // A prefab's root is named after its asset; what three wrote is Unity's, mirrored.
    const crate = files.get('Assets/Prefabs/Crate.uprefab')!;
    expect(crate).toContain('<Prefab name="Crate">');
    expect(crate).toContain('<MeshFilter sharedMesh="Assets/Meshes/box.asset" />');
    // localEulerAngles are Unity's: Quaternion.Euler(x, y, z) is y·x·z, and it is the exported rotation.
    const rotation = data.prefabs[0]!.root.rotation;
    const [x, y, z] = eulerAngles(rotation).map((d) => (d * Math.PI) / 180);
    const axis = (v: Vector3, a: number) => new Quaternion().setFromAxisAngle(v, a);
    const unity = axis(new Vector3(0, 1, 0), y!).multiply(axis(new Vector3(1, 0, 0), x!)).multiply(axis(new Vector3(0, 0, 1), z!));
    expect(unity.angleTo(new Quaternion(...(rotation as [number, number, number, number])))).toBeLessThan(1e-4);
    expect(crate).toContain(`localEulerAngles="${eulerAngles(rotation).join(' ')}"`);

    const scene = files.get('Assets/Scenes/Main.uscene')!;
    // A placed prefab, a reference by name, a prefab by its asset; the first camera is the main one.
    expect(scene).toContain('<PrefabInstance prefab="Assets/Prefabs/Crate.prefab"');
    expect(scene).toContain('<Spawner wave="Assets/Prefabs/Crate.prefab" area="#Group" />');
    expect(scene).toMatch(/<GameObject name="PerspectiveCamera" tag="MainCamera">/);
    // The main camera hears the game, as a new Unity scene's does: the page needed no listener.
    expect(scene.match(/<AudioListener \/>/g)).toHaveLength(1);
    expect(scene).toContain('<GridBehaviour size="6" />');
    expect(scene).toContain('<EventSystem />');
    expect(warnings).toEqual([]);

    // A field the project's class doesn't declare would make Scenoco refuse the file: left out, and said.
    const strict = twins(data, { declares: (type, field) => type === 'GridBehaviour' && field === 'size' });
    expect(strict.files.get('Assets/Scenes/Main.uscene')).toContain('<Spawner />');
    expect(strict.warnings.some((w) => w.includes('Spawner has no serialized field wave'))).toBe(true);
  });

  it("writes a prefab tag's children as what the placement adds, never as overrides of the prefab's own", () => {
    const Post = prefab(() => (
      <Group>
        <Mesh geometry={box} material={paint.stone} />
      </Group>
    ));
    const Yard = () => (
      <Scene>
        <Post position={[1, 0, 0]}>
          <Grid size={2} />
          <Mesh geometry={box} material={paint.stone} position={[0, 2, 0]} />
        </Post>
      </Scene>
    );
    const { data } = convert(snapshot({ '/src/yard.tsx': { Post, Yard }, '/src/assets.ts': { box, paint }, '/src/Grid.ts': { Grid } }));
    const yard = twins(data, { declares: () => true }).files.get('Assets/Scenes/Yard.uscene')!;
    const placement = yard.slice(yard.indexOf('<PrefabInstance prefab="Assets/Prefabs/Post.prefab"'), yard.indexOf('</PrefabInstance>'));
    // The component and the mesh are the scene's, added to the copy; the prefab's own Mesh is untouched, and
    // the added one, a sibling of the same name, is told apart as Unity's Duplicate names it.
    expect(placement).toContain('<GridBehaviour size="2" />');
    expect(placement).toMatch(/<GameObject name="Mesh \(1\)">\s*<Transform localPosition="0 2 0" \/>\s*<MeshFilter/);
    expect(placement).not.toContain('removedGameObjects');
  });

  it('exports a model declared in the scene file as one declared anywhere, and what its tag adds to the placement', async () => {
    const pine = sharedModel('/models/pine.glb');
    const Pine = prefab(pine);
    await loadAssets(Pine);
    const Forest = () => (
      <Scene>
        <Pine position={[2, 0, 0]}>
          <Grid size={3} />
        </Pine>
      </Scene>
    );
    const textures = (url: string) => (url === '/models/pine.glb' ? { name: 'pine.glb', file: '/game/models/pine.glb' } : null);
    // Declared in the scene's own module, only the prefab exported: the export finds the model through it.
    const { data } = convert(snapshot({ '/src/scenes/forest.tsx': { Pine, Forest }, '/src/Grid.ts': { Grid } }), { textures });
    expect(data.warnings).toEqual([]);
    const forest = twins(data, { declares: () => true }).files.get('Assets/Scenes/Forest.uscene')!;
    expect(forest).toMatch(/<PrefabInstance prefab="Assets\/Models\/pine.glb" name="pine">\s*<Transform localPosition="2 0 0" localEulerAngles="0 180 0" \/>\s*<GridBehaviour size="3" \/>/);
  });

  it('places a prefab given props as the prefab, writing only how this copy differs', () => {
    const Tile = prefab(({ size = 1, rim = 0.1 }: { size?: number; rim?: number }) => (
      <Group>
        <Grid size={size} />
        <Mesh geometry={box} material={paint.stone} />
        <Mesh geometry={box} material={paint.stone} position={[0, rim, 0]} />
      </Group>
    ));
    const Board = () => (
      <Scene>
        <Tile position={[2, 0, 0]} size={3} />
        <Tile position={[4, 0, 0]} rim={0.5} />
      </Scene>
    );
    const { data } = convert(snapshot({ '/src/board.tsx': { Tile, Board }, '/src/assets.ts': { box, paint }, '/src/Grid.ts': { Grid } }));
    const { files, warnings } = twins(data, { declares: () => true });
    const board = files.get('Assets/Scenes/Board.uscene')!;
    // A placement, named after its prefab, with the props' effect as Unity's overrides — nothing it shares.
    expect(board).toContain('<PrefabInstance prefab="Assets/Prefabs/Tile.prefab" name="Tile">\n    <Transform localPosition="2 0 0" />\n    <GridBehaviour size="3" />\n  </PrefabInstance>');
    // Siblings of one name are told apart as Unity's Duplicate names them, so an override can reach the second.
    expect(files.get('Assets/Prefabs/Tile.uprefab')).toContain('<GameObject name="Mesh (1)">');
    expect(board).toContain('<GameObject name="Mesh (1)">\n      <Transform localPosition="0 0.5 0" />\n    </GameObject>');
    expect(board).not.toContain('MeshFilter');
    expect(warnings).toEqual(['Assets/Scenes/Board.unity: no camera in the scene.']);
  });

  it("places a model as Unity's model prefab: the .glb itself, half a turn about its up for glTFast's mirror; with settings, its variant", async () => {
    const Goblin = prefab(sharedModel('/models/goblin.glb'));
    await loadAssets(Goblin);
    const Camp = () => (
      <Scene>
        <Goblin position={[1, 0, 2]} scale={1.5} />
      </Scene>
    );
    class Spawner extends Behaviour {}
    const { data } = convert(snapshot({ '/src/camp.tsx': { Camp }, '/src/assets.ts': { Goblin }, '/src/Spawner.ts': { Spawner } }), {
      textures: (url) => (url === '/models/goblin.glb' ? { name: 'goblin.glb', file: '/game/models/goblin.glb' } : null),
    });
    expect(data.warnings).toEqual([]);
    const placed = data.scenes[0]!.roots[0]!;
    expect(placed.prefab).toBe('Assets/Models/goblin.glb');
    expect(placed.position).toEqual([1, 0, -2]);
    expect(eulerAngles(placed.rotation)).toEqual([0, 180, 0]);
    const scene = twins(data, { declares: () => true }).files.get('Assets/Scenes/Camp.uscene')!;
    expect(scene).toContain('<PrefabInstance prefab="Assets/Models/goblin.glb" name="goblin">\n    <Transform localPosition="1 0 -2" localEulerAngles="0 180 0" localScale="1.5 1.5 1.5" />');

    // A model whose copies cast no shadow is placed as a variant of its file, which the importer makes.
    sharedModel('/models/goblin.glb', { castShadow: false });
    const shaded = convert(snapshot({ '/src/camp.tsx': { Camp }, '/src/assets.ts': { Goblin } }), {
      textures: (url) => (url === '/models/goblin.glb' ? { name: 'goblin.glb', file: '/game/models/goblin.glb' } : null),
    }).data;
    expect(shaded.modelVariants).toEqual([{ path: 'Assets/Models/goblin.prefab', model: 'Assets/Models/goblin.glb', castShadow: false, receiveShadow: true }]);
    expect(shaded.scenes[0]!.roots[0]!.prefab).toBe('Assets/Models/goblin.prefab');
  });

  it('writes knots that are nodes as the spline they make now, and SplineKnotNodes to follow them; a roll as the knot\'s Rotation', () => {
    const Track = () => {
      const points = ref<Group>();
      const path = ref<SplineContainer>();
      return (
        <Scene>
          <Group position={[0, 0, 5]}>
            <SplineContainer ref={path} knots={points} />
          </Group>
          <Group ref={points}>
            <Group position={[0, 0, 5]} />
            <Group position={[10, 0, 5]} />
            <Group position={[10, 0, 15]} />
          </Group>
          <SplineContainer knots={[[0, 0, 0], { position: [10, 0, 0], roll: Math.PI / 2 }, [20, 0, 0]]} />
          <SplineInstantiate container={path} itemsToInstantiate={[Crate]} spacing={4} />
        </Scene>
      );
    };
    const { data } = convert(snapshot({ '/src/track.tsx': { Track, Crate }, '/src/assets.ts': { box, paint } }));
    const { files, warnings } = twins(data, { declares: () => true });
    const scene = files.get('Assets/Scenes/Track.uscene')!;
    // In the container's space, mirrored: the first knot node is where the container stands.
    expect(scene).toContain('<SplineKnotNodes knots=');
    expect(scene).toMatch(/<BezierKnot>\s*<BezierKnot.Position>\s*<float3 x="0" y="0" z="0" \/>[\s\S]*?<float3 x="10" y="0" z="0" \/>[\s\S]*?<float3 x="10" y="0" z="-10" \/>/);
    // Banked a quarter turn about the curve, which runs along x: the knot's up is Unity's -z or +z, not y.
    const rotation = [...scene.matchAll(/<BezierKnot.Rotation>[\s\S]*?<float4 x="([-\d.e]+)" y="([-\d.e]+)" z="([-\d.e]+)" w="([-\d.e]+)"/g)][1]!;
    const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...rotation.slice(1, 5).map(Number)));
    expect(Math.abs(up.y)).toBeLessThan(1e-6);
    expect(warnings.filter((w) => w.includes('Spline') && !w.includes('takes turns'))).toEqual([]);
    // The item by Unity Splines' current field names: the lowercase ones are obsolete, and instantiate nothing.
    expect(scene).toContain('<InstantiableItem Prefab="Assets/Prefabs/Crate.prefab" Probability="100" />');
  });

  it("writes SplineExtrude and SplineAnimate as Unity's own, and SplineMesh as SceNoCo's port of it, its piece by the model's file", async () => {
    const road = sharedModel('/models/road.glb');
    await loadAssets(road);
    const Track = () => {
      const path = ref<Group>();
      return (
        <Scene>
          <Group ref={path}>
            <SplineContainer knots={[[0, 0, 0], [10, 0, 0], [20, 0, 5]]} />
          </Group>
          <Mesh name="road">
            <SplineMesh container={path} mesh={road} />
          </Mesh>
          <Mesh name="rail">
            <SplineExtrude container={path} shape="square" radius={0.2} range={[0.2, 0.8]} />
          </Mesh>
          <Group name="drone">
            <SplineAnimate container={path} animationMethod="speed" maxSpeed={18} startOffset={0.5} />
          </Group>
        </Scene>
      );
    };
    const { data } = convert(snapshot({ '/src/track.tsx': { Track }, '/src/assets.ts': { road } }), {
      textures: (url) => (url === '/models/road.glb' ? { name: 'road.glb', file: '/game/models/road.glb' } : null),
    });
    const { files, warnings } = twins(data, { declares: () => true });
    const scene = files.get('Assets/Scenes/Track.uscene')!;
    expect(warnings.filter((w) => w.includes('Spline'))).toEqual([]);
    expect(scene).toMatch(/<SplineMesh container="#[^"]+" mesh="Assets\/Models\/road.glb" \/>/);
    expect(scene).toMatch(/<SplineExtrude m_Container="#[^"]+" m_Radius="0.2" m_Range="0.2 0.8">\s*<SplineExtrude.m_Shape>\s*<Square \/>/);
    expect(scene).toMatch(/<SplineAnimate m_Target="#[^"]+" m_Method="Speed" m_MaxSpeed="18" m_StartOffset="0.5" \/>/);
  });

  it('gives a mesh its code builds its renderer, and a material with vertex colours the Particles shader that draws them', () => {
    const water = new MeshStandardMaterial({ vertexColors: true, transparent: true });
    const strip = new BoxGeometry(1, 1, 1);
    strip.setAttribute('color', new Float32BufferAttribute(Array.from({ length: strip.getAttribute('position').count * 3 }, (_, i) => (i % 3) / 2), 3));
    const Pond = () => (
      <Scene>
        <Mesh name="river" material={water} />
        <Mesh name="tiles" geometry={strip} material={water} />
      </Scene>
    );
    const { data } = convert(snapshot({ '/src/pond.tsx': { Pond }, '/src/assets.ts': { water, strip } }));
    expect(data.materials[0]).toMatchObject({ vertexColors: true, transparent: true });
    const [river, tiles] = data.scenes[0]!.roots;
    expect(river!.materials).toEqual([data.materials[0]!.path]);
    expect(river!.mesh).toBeUndefined();
    // A mesh's own colours come across, RGBA: three's RGB with an alpha of 1.
    expect(data.meshes.find((m) => m.path === tiles!.mesh)!.colors!.slice(0, 8)).toEqual([0, 0.5, 1, 1, 0, 0.5, 1, 1]);
    const scene = twins(data, { declares: () => true }).files.get('Assets/Scenes/Pond.uscene')!;
    expect(scene).toMatch(/<GameObject name="river">\s*<MeshFilter \/>\s*<MeshRenderer sharedMaterial=/);
  });

  it("writes a terrain's metres as Unity's TerrainData: from its corner, heights 0..1 of their span, mirrored in z", () => {
    const ground = new TerrainData();
    ground.width = 40;
    ground.depth = 20;
    ground.heightmapResolution = 33;
    // 2 m at three's -z edge, 6 m at +z: Unity's row 0 is three's +z.
    ground.setHeights((_, z) => 4 + z / 5);
    ground.terrainLayers = [new TerrainLayer({ name: 'grass' }), new TerrainLayer({ name: 'rock' })];
    ground.setAlphamaps((x) => (x < 0 ? [1, 0] : [0, 1]));
    const World = () => (
      <Scene>
        <Group position={[0, 1, 0]}>
          <Terrain terrainData={ground} />
        </Group>
      </Scene>
    );
    const { data } = convert(snapshot({ '/src/World.tsx': { World }, '/src/ground.ts': { ground } }));
    const [t] = data.terrains;
    expect(t!.size).toEqual([40, 4, 20]);
    expect(t!.offset).toEqual([-20, 2, -10]);
    expect(t!.heights[0]).toBe(1);
    expect(t!.heights[32 * 33]).toBe(0);
    // Two layers split down x, at a power-of-two resolution.
    expect(t!.alphamapResolution).toBe(32);
    expect(t!.alphamaps.slice(0, 2)).toEqual([1, 0]);
    expect(t!.alphamaps.slice(31 * 2, 31 * 2 + 2)).toEqual([0, 1]);
    const terrain = data.scenes[0]!.roots[0]!.components.find((c) => c.type === 'Terrain')!;
    expect(terrain.fields.terrainData).toEqual({ asset: t!.path });

    // Two maps whose layers' files share a name each keep their own: every level's grass.jpg.
    const map = (level: string) => {
      const d = new TerrainData(undefined, { [`./levels/${level}/layers/grass.jpg`]: `/levels/${level}/grass.jpg` });
      d.terrainLayers = [new TerrainLayer({ name: 'grass' })];
      return d;
    };
    const [meadow, frost] = [map('meadow'), map('frost')];
    const Two = () => (
      <Scene>
        <Terrain terrainData={meadow} />
        <Terrain terrainData={frost} />
      </Scene>
    );
    const two = convert(snapshot({ '/src/Two.tsx': { Two }, '/src/maps.ts': { meadow, frost } }), {
      textures: (url) => ({ name: 'grass.jpg', file: `/game${url}` }),
    });
    const textures = two.data.terrains.map((x) => x.layers[0]!.texture);
    expect(new Set(textures).size).toBe(2);
    expect(new Set(two.copies.values()).size).toBe(2);
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

  it("puts a MeshCollider on each mesh under it, as Unity's takes its own object's mesh: a placed model's by its glTF node path", async () => {
    const rock = sharedModel('/models/stone1.glb');
    await loadAssets(rock);
    const RockModel = prefab(rock);
    const Rock = prefab(() => (
      <Group>
        <RockModel />
        <MeshCollider convex layer={2} />
      </Group>
    ));
    const glb = fileURLToPath(new URL('../../examples/eggy/src/models/stone1.glb', import.meta.url));
    const { data } = convert(snapshot({ '/src/rock.tsx': { Rock }, '/src/assets.ts': { RockModel } }), {
      textures: (url) => (url === '/models/stone1.glb' ? { name: 'stone1.glb', file: glb } : null),
    });
    const text = twins(data, { declares: () => true }).files.get('Assets/Prefabs/Rock.uprefab')!;
    expect(text).toMatch(/<PrefabInstance prefab="Assets\/Models\/stone1.glb" name="stone1">[\s\S]*<GameObject name="root">\s*<GameObject name="stone" layer="9">\s*<MeshCollider convex="true" \/>/);
  });

  it("writes stubs that compile: a package's component and an asset as Unity's types, with their namespace; anything else a comment", () => {
    class Jukebox extends Behaviour {
      music: AudioSource | null = null;
      ground: TerrainData | null = null;
      track: SplineContainer | null = null;
      look: Tonemapping | null = null;
      grid: Grid | null = null;
    }
    const ground = new TerrainData();
    const Room = () => {
      const music = ref<AudioSource>();
      const path = ref<SplineContainer>();
      const look = ref<Tonemapping>();
      const grid = ref<Grid>();
      return (
        <Scene>
          <Group name="music"><AudioSource ref={music} /></Group>
          <Group name="path"><SplineContainer ref={path} knots={[[0, 0, 0], [4, 0, 0]]} /></Group>
          <Group name="look"><Volume /><Tonemapping ref={look} /></Group>
          <Group name="grid"><Grid ref={grid} /></Group>
          <Jukebox music={music} ground={ground} track={path} look={look} grid={grid} />
        </Scene>
      );
    };
    const { scripts, data } = convert(snapshot({ '/src/room.tsx': { Room }, '/src/Grid.ts': { Grid }, '/src/Jukebox.ts': { Jukebox }, '/src/assets.ts': { ground } }));
    const stub = scripts.get('Jukebox')!;
    // A component a package gives is Unity's own, by its own name: not renamed as a game class named after one is.
    expect(stub).toContain('public AudioSource music;');
    expect(stub).toContain('public TerrainData ground;');
    expect(stub).toContain('public SplineContainer track;');
    expect(stub).toContain('public GridBehaviour grid;');
    expect(stub).toMatch(/^using UnityEngine\.Splines;$/m);
    // What has no C# type is a comment and a warning: a stub that names a missing type stops the Editor at Safe Mode.
    expect(stub).toContain('// look: a Tonemapping in TypeScript');
    expect(data.warnings.some((w) => w.includes('Jukebox.look holds a Tonemapping'))).toBe(true);
    const types = [...stub.matchAll(/^ +public (\w+)(?:\[\])* \w+( = .*)?;$/gm)].map((m) => m[1]);
    expect(types.sort()).toEqual(['AudioSource', 'GridBehaviour', 'SplineContainer', 'TerrainData']);
  });

  it("reads the game's code for what a value cannot say: rates, templates, aliases, a glow, a prefab's own copy", () => {
    class Spin extends Behaviour {
      speed = new Vector3(0, 90, 10);
      drift = new Vector3(1, 2, 3);
    }
    class Hud extends Behaviour {
      chip: unknown = null;
    }
    class Copier extends Behaviour {
      copy: unknown = null;
    }
    const dark = new MeshStandardMaterial({ color: '#202020' });
    const Orb = prefab((): unknown => (
      <Mesh geometry={box} material={dark}>
        <Spin speed={new Vector3(10, 20, 30)} />
        <Copier copy={Orb} />
      </Mesh>
    ));
    const Field = () => (
      <Scene>
        <PerspectiveCamera />
        <Group>
          <Hud />
        </Group>
        <Orb />
      </Scene>
    );
    const code: Record<string, string> = {
      '/src/Spin.ts': `export class Spin extends Behaviour {
  speed = new Vector3(0, 90, 10);
  drift = new Vector3(1, 2, 3);
  update(dt: number): void {
    this.node.position.addScaledVector(this.drift, dt);
    this.node.rotation.z += this.speed.z * dt;
  }
}`,
      '/src/Hud.ts': `type Bonus = 'none' | 'laser' | 'multi';
export class Hud extends Behaviour {
  private chip!: HTMLTemplateElement;
  awake(): void {
    this.chip = element('chip') as HTMLTemplateElement;
    this.material.emissive.set('#ff0000');
  }
  show(bonus: Exclude<Bonus, 'none'>, step = 0): void {}
}`,
    };
    const aliases = new Map([['Bonus', "'none' | 'laser' | 'multi'"]]);
    const { data, scripts } = convert(snapshot({ '/src/field.tsx': { Orb, Field }, '/src/assets.ts': { box, dark }, '/src/Spin.ts': { Spin }, '/src/Hud.ts': { Hud }, '/src/Copier.ts': { Copier } }), {
      source: (file) => code[file] ?? null,
      aliases,
      templates: { chip: 'Assets/UI/chip.uxml' },
    });
    // A Vector3 a rotation is set from is a rate about each axis, mirrored as a rotation: x and y turn the
    // other way, z keeps its sign. One only moved by is a vector: z negated.
    const spin = data.prefabs.find((p) => p.path === 'Assets/Prefabs/Orb.prefab')!.root.components.find((c) => c.type === 'Spin')!;
    expect(spin.fields.speed).toEqual({ v3: [-10, -20, 30] });
    expect(scripts.get('Spin')).toContain('public Vector3 speed = new Vector3(0f, -90f, 10f);');
    // A field the class takes from a template's id is that template's UXML, wired.
    const hud = data.scenes[0]!.roots.flatMap((r) => [r, ...r.children]).flatMap((n) => n.components).find((c) => c.type === 'Hud')!;
    expect(hud.fields.chip).toEqual({ asset: 'Assets/UI/chip.uxml' });
    expect(scripts.get('Hud')).toContain('public VisualTreeAsset chip;');
    expect(scripts.get('Hud')).toContain('using UnityEngine.UIElements;');
    // A parameter typed by a union's alias, narrowed or not, is its C# type; an untyped one, its default's.
    expect(scripts.get('Hud')).toContain('public void Show(string bonus, float step)');
    // Code that sets an emissive: a lit material with none keeps URP's emission on, black, to be lit later.
    expect(data.materials.find((m) => m.path === 'Assets/Materials/dark.mat')).toMatchObject({ emission: '#000000' });
    // A prefab's reference to itself is its root, as Unity keeps it.
    const { files } = twins(data, { declares: () => true });
    expect(files.get('Assets/Prefabs/Orb.uprefab')).toContain('<Copier copy="#Orb" />');
  });

  it("reads the fields a port's C# declares, several to a line and with any initializer", () => {
    const declared = serializedFields(`
      public GameObject goblin, wolf, orc, troll;
      public Vector2 extent = new(30, 30);
      [SerializeField] float hidden = 2f;
      public Dictionary<string, int> map;
      public float a = 1, b, c = Mathf.Max(1, 2);
      public string name = "a, b";
      public void Foo() { }
      public int X => 3;
      public static int S;
    `);
    expect([...declared].sort()).toEqual(['a', 'b', 'c', 'extent', 'goblin', 'hidden', 'map', 'name', 'orc', 'troll', 'wolf']);
  });

  it('tells a game that tweens from one that does not: its port needs DOTween', () => {
    expect(usesTweens('Tween.delayedCall(1, () => destroy(this.node)).setLink(this);')).toBe(true);
    expect(usesTweens('this.node.doMove(new Vector3(0, 1, 0), 0.5).setEase(Ease.OutBack);')).toBe(true);
    expect(usesTweens('import { Tween } from "@scenoco-three/core";\nthis.node.position.y += dt;')).toBe(false);
  });

  it("builds the project's prefabs in its own page", async () => {
    // breakout, through its own Vite and a headless Chrome: what `scenoco-unity` reads.
    const snap = await snapshotProject(fileURLToPath(new URL('../../examples/breakout', import.meta.url)));
    expect(snap.warnings).toEqual([]);
    expect(snap.prefabs.map((p) => p.name).sort()).toEqual([
      'Arena', 'BallPrefab', 'BoltPrefab', 'BrickPrefab', 'FirmBurst', 'HardBurst', 'LaserPickup', 'Level1', 'Level2', 'Level3',
      'MultiPickup', 'PaddlePrefab', 'PickupPrefab', 'Run', 'SlimPickup', 'SoftBurst', 'Spark', 'WallPrefab', 'WidePickup',
    ]);
    // Geometry and materials written inside a prefab come across too; two walls of one shape are one mesh asset.
    const all = (n: SnapshotNode): SnapshotNode[] => [n, ...n.children.flatMap(all)];
    const walls = all(snap.prefabs.find((p) => p.name === 'Arena')!.root).filter((n) => /^wall(Left|Right)$/.test(n.name));
    expect(walls).toHaveLength(2);
    const body = (wall: SnapshotNode) => all(wall).find((n) => n.geometry !== undefined && n.materials?.length)!;
    expect(body(walls[0]!).geometry).toBe(body(walls[1]!).geometry);
    expect(snap.materials[body(walls[0]!).materials![0]!]).toMatchObject({ color: '#1b2540', shared: false });
  }, 60_000);
});
