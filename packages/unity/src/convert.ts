/**
 * A snapshot in Unity's terms: its handedness, its units, its asset paths, and C# for every game
 * behaviour.
 *
 * three.js is right-handed and Unity left-handed, both Y up: mirroring Z maps one onto the other.
 * A position or vector negates z, a rotation negates x and y of its quaternion, a mesh negates z of
 * its vertices and normals, and reverses its triangles. A camera looks down its local -Z in three and
 * +Z in Unity, which the same mirror carries across — so every vertex lands on the same pixel, and a
 * triangle winds on screen as it did in three: counter-clockwise, which Unity culls as a back face. A light's intensity divides by π:
 * three's lights are physical, Unity folds π into its own.
 *
 * Everything here is data in and data out; the importer in Unity only creates what it is told.
 */
import type {
  Snapshot,
  SnapshotGeometry,
  SnapshotMaterial,
  SnapshotNode,
  SnapshotPrefab,
  SnapshotValue,
} from '@scenoco-three/core/snapshot';
import { existsSync, readFileSync } from 'node:fs';
import { outsideClasses, readClass, stubClass, type ClassSource } from './stub.js';

export type UnityValue =
  | null
  | number
  | boolean
  | string
  | { v2: number[] }
  | { v3: number[] }
  | { v4: number[] }
  | { quat: number[] }
  | { color: string }
  | { array: UnityValue[] }
  | { node: string }
  | { component: string; node: string }
  | { asset: string }
  /** A plain object — a physics material, a particle effect — which the importer reads as it is. */
  | { object: { type: string; fields: Record<string, UnityValue> } };

export interface UnityComponent {
  type: string;
  /** A game behaviour, as opposed to one of Unity's own (physics). */
  game: boolean;
  fields: Record<string, UnityValue>;
  source?: string;
}

export interface UnityLight {
  type: 'Directional' | 'Point' | 'Spot';
  color: string;
  intensity: number;
  shadows: boolean;
  range?: number;
  /** Full cone angle in degrees, Unity's spotAngle. */
  spotAngle?: number;
  innerSpotAngle?: number;
}

export interface UnityCamera {
  orthographic: boolean;
  near: number;
  far: number;
  fov?: number;
  size?: number;
}

export interface UnityNode {
  name: string;
  position: number[];
  rotation: number[];
  scale: number[];
  /** Hidden in three with nothing on it to keep running: an inactive GameObject. */
  active: boolean;
  /** Hidden in three while a behaviour on it still runs: its renderers off, the object active. */
  renderersEnabled: boolean;
  mesh?: string;
  materials?: string[];
  castShadows?: boolean;
  receiveShadows?: boolean;
  light?: UnityLight;
  camera?: UnityCamera;
  components: UnityComponent[];
  /** A nested prefab's asset path. */
  prefab?: string;
  /** A placed prefab given attributes: what this copy is built as, to compare with the prefab. */
  given?: boolean;
  /** Its Unity layer, from a collider's `layer`: SceNoCo's layer n is Unity's user layer n + 7. */
  layer?: number;
  /** A placed model's objects that hold a mesh, as paths of names from its root, as glTFast names them. */
  meshNodes?: string[][];
  children: UnityNode[];
  source?: string;
}

export interface UnityMesh {
  path: string;
  vertices: number[];
  normals?: number[];
  uv?: number[];
  /** Vertex colours, RGBA, linear: a material with `vertexColors` draws them. */
  colors?: number[];
  /** One triangle list per submesh, wound for Unity. */
  submeshes: number[][];
}

export interface UnityMaterial {
  path: string;
  shader: 'lit' | 'unlit';
  color: string;
  opacity: number;
  transparent: boolean;
  alphaClip?: number;
  /** Unity's CullMode: 0 off, 1 front, 2 back. */
  cull: number;
  zWrite: boolean;
  smoothness?: number;
  metallic?: number;
  emission?: string;
  emissionIntensity?: number;
  /** The texture's asset path, once the exporter copied it in. */
  texture?: string;
  emissionTexture?: string;
  /** How often the textures repeat: three's `texture.repeat`, Unity's tiling. */
  tiling?: number[];
  /** Multiplied by the mesh's vertex colours: URP's Particles shaders, which Lit and Unlit are not. */
  vertexColors?: boolean;
}

/**
 * A terrain as Unity's `TerrainData` wants it. SceNoCo's is centred on its node with heights in
 * metres; Unity's starts at its object's corner with heights 0..1 of `size.y` above it, so the
 * Terrain sits on a child at `offset`. Rows run along Unity's +z, which is three's -z.
 */
export interface UnityTerrain {
  path: string;
  /** Unity's `size`: width, the height span, length. */
  size: number[];
  /** Where the Terrain's child sits under the node: its corner and its lowest point. */
  offset: number[];
  heightmapResolution: number;
  /** 0..1 of `size.y`, row by row from Unity's z = 0: `heights[y * n + x]`. */
  heights: number[];
  /** A power of two, as Unity needs, resampled from the game's. */
  alphamapResolution: number;
  /** 0..1, `alphamaps[(y * a + x) * layers + layer]`. */
  alphamaps: number[];
  /** Each layer's colour, and its textures' asset paths once the exporter copied them in. */
  layers: { name: string; tileSize: number; color: string; texture?: string; normalMap?: string }[];
}

export interface UnityPrefab {
  path: string;
  root: UnityNode;
}

export interface UnityScene {
  path: string;
  roots: UnityNode[];
  /** Components the scene's own element carried: Unity has no scene object, so a root holds them. */
  background?: string;
  fog?: { mode: 'linear'; color: string; start: number; end: number } | { mode: 'exp2'; color: string; density: number };
  ambient?: { sky: string; equator: string; ground: string; intensity: number };
}

export interface UnityExport {
  meshes: UnityMesh[];
  terrains: UnityTerrain[];
  materials: UnityMaterial[];
  /** Ordered so a nested prefab comes before the prefabs that use it. */
  prefabs: UnityPrefab[];
  /** The first is the one to play first. */
  scenes: UnityScene[];
  /** User layers by Unity number — their names, and the pairs that pass through each other. */
  layers: { names: Record<number, string>; ignore2D: [number, number][]; ignore3D: [number, number][] };
  /** The page's UXML by the element a UIDocument names, and the panels' theme. */
  ui?: { documents: Record<string, string>; theme: string };
  /** The project-wide input actions asset. */
  input?: string;
  /**
   * A model whose copies differ from Unity's defaults (`sharedModel(url, { castShadow: false })`), as a
   * prefab variant of its file with its renderers set: what its placements and fields name instead.
   */
  modelVariants: { path: string; model: string; castShadow: boolean; receiveShadow: boolean }[];
  /** Images a behaviour's field holds — read as data, a height stamp — imported pixel for pixel. */
  dataTextures: string[];
  warnings: string[];
}

/** SceNoCo's layers are 0 to 15, Unity's own 0 to 5: layer n, past 0, is Unity's user layer n + 7. */
export const unityLayer = (n: number) => (n === 0 ? 0 : n + 7);

/** A texture's URL as the page loaded it, and where its file is in the project. */
export type TextureSource = (url: string) => { file: string; name: string } | null;

export interface Converted {
  data: UnityExport;
  /** C# for each game behaviour, by class name. */
  scripts: Map<string, string>;
  /** Files to copy into the Unity project: source → path under it. */
  copies: Map<string, string>;
}

/**
 * Names Unity already gives a component or a class every script sees. A game behaviour called one
 * of them cannot be added to an object (Unity refuses a script named `Grid`), or shadows what a port
 * writes (`Time.deltaTime`), so its C# class is `GridBehaviour`.
 */
const UNITY_NAMES = new Set(
  ('Transform RectTransform Camera Light Animator Animation AudioSource AudioListener Rigidbody Rigidbody2D Collider ' +
    'BoxCollider SphereCollider CapsuleCollider MeshCollider CharacterController Joint HingeJoint FixedJoint SpringJoint Cloth ' +
    'MeshFilter MeshRenderer SkinnedMeshRenderer Renderer LineRenderer TrailRenderer SpriteRenderer ParticleSystem Terrain Tree ' +
    'WindZone LODGroup Projector Skybox Grid Tilemap TilemapRenderer Canvas CanvasGroup CanvasRenderer Text Image RawImage Button ' +
    'Toggle Slider Scrollbar Dropdown InputField Mask Outline Shadow LayoutElement EventSystem NavMeshAgent NavMeshObstacle ' +
    'ReflectionProbe LightProbeGroup Halo LensFlare FlareLayer VideoPlayer PlayableDirector ConstantForce SortingGroup Behaviour ' +
    'MonoBehaviour Component GameObject Object Physics Physics2D Input Time Random Debug Mathf Vector2 Vector3 Vector4 Quaternion ' +
    'Color Material Mesh Texture Texture2D Shader Application Screen Cursor Gizmos Resources SceneManager Event Ray Plane Bounds')
    .split(' '),
);
/** A game behaviour's C# class name. */
export const csName = (type: string) => (UNITY_NAMES.has(type) ? `${type}Behaviour` : type);

/** Where each kind of loaded file goes in the Unity project. */
const FILE_FOLDERS: Record<string, string> = { Model: 'Assets/Models', AudioClip: 'Assets/Audio', Texture2D: 'Assets/Textures' };

const flipV = ([x, y, z]: number[]) => [x!, y!, z === 0 ? 0 : -z!];
const flipQ = ([x, y, z, w]: number[]) => [x === 0 ? 0 : -x!, y === 0 ? 0 : -y!, z!, w!];
/** A rate about each axis — degrees a second about x, y and z — mirrors as a rotation does: x and y turn the other way. */
const flipAxes = ([x, y, z]: number[]) => [x === 0 ? 0 : -x!, y === 0 ? 0 : -y!, z!];

export interface ConvertOptions {
  /** The scene `main.ts` plays: listed first in Build Settings. */
  firstScene?: string;
  textures?: TextureSource;
  /** A behaviour's TypeScript, by the module path the snapshot gives (`/src/Player.ts`): its stub then carries every member. */
  source?: (file: string) => string | null;
  /** The game's layers as SceNoCo numbers them: names, and the pairs its physics ignores. */
  layers?: { names: Record<number, string>; ignore2D: [number, number][]; ignore3D: [number, number][] };
  /** Every type alias the game declares, by name: what a stub's signature that names one means. */
  aliases?: Map<string, string>;
  /** The page's `<template>`s as UXML, by id: `chip` → `Assets/UI/chip.uxml`. */
  templates?: Record<string, string>;
  /** Files the game loads that no field may name — a table of sounds — copied in all the same. */
  files?: { url: string; type: string }[];
}

export function convert(snap: Snapshot, options: ConvertOptions = {}): Converted {
  const warnings = [...snap.warnings];
  const paths = new Paths();
  const copies = new Map<string, string>();
  const read = readSources(snap, options);

  // three draws a geometry's groups only for a mesh given a list of materials; with one material it
  // draws everything with it. A BoxGeometry has six groups, so this decides whether it is one submesh or six.
  const multi = new Set<string>();
  const scan = (n: SnapshotNode) => {
    if (n.geometry && (n.materials?.length ?? 0) > 1) multi.add(n.geometry);
    n.children.forEach(scan);
  };
  snap.prefabs.forEach((p) => scan(p.root));
  const meshPath = new Map<string, string>();
  const meshes: UnityMesh[] = Object.entries(snap.geometries).map(([id, g]) => {
    const path = paths.take('Assets/Meshes', g.name, '.asset');
    meshPath.set(id, path);
    return mesh(multi.has(id) ? g : { ...g, groups: [] }, path);
  });

  const materialPath = new Map<string, string>();
  const materials: UnityMaterial[] = Object.entries(snap.materials).map(([id, m]) => {
    const path = paths.take('Assets/Materials', m.name, '.mat');
    materialPath.set(id, path);
    return material(m, path, options.textures, copies, warnings, read.emits);
  });

  const terrains: UnityTerrain[] = [];
  const terrainPath = new Map<string, string>();
  // The world scale of the node being converted: what a terrain on it is drawn at.
  let worldScale = 1;
  const terrainOf = (fields: Record<string, SnapshotValue>): UnityValue => {
    const key = `${worldScale} ${JSON.stringify(fields)}`;
    let path = terrainPath.get(key);
    if (!path) {
      path = paths.take('Assets/Terrains', typeof fields.name === 'string' && fields.name ? fields.name : 'Terrain', '.asset');
      terrainPath.set(key, path);
      // A layer's texture files, copied in once each, under the terrain's own folder.
      const copy = (url: string) => {
        const found = options.textures?.(url);
        if (!found) return undefined;
        // Each terrain's own folder: levels name their layers alike (every map's `grass.jpg`), and one file each.
        const to = `Assets/Textures/Terrain/${path!.replace(/^.*\/|\.asset$/g, '')}/${found.name}`;
        copies.set(found.file, to);
        return to;
      };
      const t = terrain(fields, path, copy, worldScale);
      terrains.push(t.terrain);
      warnings.push(...t.warnings);
    }
    return { asset: path };
  };

  const prefabPath = new Map<string, string>();
  const sceneName = new Map<string, string>();
  for (const p of snap.prefabs) {
    if (p.scene) sceneName.set(p.id, paths.take('Assets/Scenes', p.name, '.unity').replace(/^.*\/|\.unity$/g, ''));
    else prefabPath.set(p.id, paths.take('Assets/Prefabs', p.name, '.prefab'));
  }

  /** A behaviour's field: a rate about each axis mirrors as a rotation, every other value as itself. */
  const field = (type: string, name: string, v: SnapshotValue): UnityValue => {
    if (read.axes.has(`${type}.${name}`) && v && typeof v === 'object' && 'v3' in v) return { v3: flipAxes(v.v3) };
    // A list of [x, y, z] — a path's points written as tuples — is a list of points: Vector3[], mirrored.
    if (v && typeof v === 'object' && 'array' in v && v.array.length && v.array.every((p) => p && typeof p === 'object' && 'array' in p && p.array.length === 3 && p.array.every((x) => typeof x === 'number')))
      return { array: v.array.map((p) => ({ v3: flipV((p as { array: number[] }).array) })) };
    return value(v);
  };
  // A file the game loads — a model, a sound — copied in once, by its URL: Unity imports it (a .glb with glTFast).
  const filePath = new Map<string, string | null>();
  const modelVariants: UnityExport['modelVariants'] = [];
  const dataTextures: string[] = [];
  const fileOf = (url: string, type: string): UnityValue => {
    if (!filePath.has(url)) {
      const found = options.textures?.(url);
      if (!found) {
        warnings.push(`${url}: the ${type} was not found in the project — its fields are left empty.`);
        filePath.set(url, null);
      } else {
        const ext = found.name.slice(found.name.lastIndexOf('.'));
        const path = paths.take(FILE_FOLDERS[type] ?? 'Assets/Files', found.name.slice(0, -ext.length), ext);
        copies.set(found.file, path);
        filePath.set(url, path);
      }
    }
    const path = filePath.get(url);
    if (!path) return null;
    if (type === 'Texture2D' && !dataTextures.includes(path)) dataTextures.push(path);
    const settings = type === 'Model' ? snap.modelSettings?.[url] : undefined;
    if (!settings) return { asset: path };
    let variant = modelVariants.find((v) => v.model === path);
    if (!variant) {
      variant = { path: paths.take('Assets/Models', path.replace(/^.*\/|\.[^.]*$/g, ''), '.prefab'), model: path, ...settings };
      modelVariants.push(variant);
    }
    return { asset: variant.path };
  };
  const value = (v: SnapshotValue): UnityValue => {
    if (v === null || typeof v !== 'object') return v;
    if ('file' in v) return fileOf(v.file, v.type);
    if ('v3' in v) return { v3: flipV(v.v3) };
    if ('quat' in v) return { quat: flipQ(v.quat) };
    if ('array' in v) return { array: v.array.map(value) };
    if ('prefab' in v) return sceneName.get(v.prefab) ?? (prefabPath.has(v.prefab) ? { asset: prefabPath.get(v.prefab)! } : null);
    // A game behaviour named as Unity's own is renamed; a package's component is Unity's, by its name.
    if ('component' in v) return { component: snap.classes[v.component] ? csName(v.component) : v.component, node: v.node };
    if ('material' in v) return { asset: materialPath.get(v.material)! };
    if ('geometry' in v) return { asset: meshPath.get(v.geometry)! };
    if ('object' in v && v.object.type === 'TerrainData') return terrainOf(v.object.fields);
    if ('object' in v) return { object: { type: v.object.type, fields: Object.fromEntries(Object.entries(v.object.fields).map(([k, f]) => [k, value(f)])) } };
    return v;
  };

  for (const f of options.files ?? []) fileOf(f.url, f.type);
  let ambient: UnityScene['ambient'];
  const node = (n: SnapshotNode): UnityNode => {
    const outer = worldScale;
    const [sx, sy, sz] = n.scale;
    worldScale *= sx!;
    if (n.components.some((c) => c.type === 'Terrain') && (Math.abs(sx! - sy!) > 1e-6 || Math.abs(sx! - sz!) > 1e-6)) warnings.push(`${n.source ?? n.name}: a terrain under a scale that differs by axis — Unity sizes it by x.`);
    try {
      return convertNode(n);
    } finally {
      worldScale = outer;
    }
  };
  const convertNode = (n: SnapshotNode): UnityNode => {
    const out: UnityNode = {
      name: n.name,
      position: flipV(n.position),
      rotation: flipQ(n.quaternion),
      scale: n.scale,
      active: true,
      renderersEnabled: true,
      components: n.components.map((c) => {
        const fields: Record<string, UnityValue> = {};
        for (const [k, v] of Object.entries(c.fields)) fields[k] = c.game ? field(c.type, k, v) : value(v);
        // A template the class clones is a field Unity wires: its UXML.
        if (c.game) for (const [k, path] of read.templates.get(c.type) ?? []) fields[k] ??= { asset: path };
        if (c.game) for (const [k, ref] of read.prefabs.get(c.type) ?? []) fields[k] ??= value(ref);
        const component: UnityComponent = { type: c.game ? csName(c.type) : c.type, game: c.game, fields };
        if (c.source) component.source = c.source;
        return component;
      }),
      children: siblings(n.children.map(node)),
    };
    if (n.source) out.source = n.source;
    // A collider's layer is its object's in Unity.
    const layered = n.components.find((c) => !c.game && typeof c.fields.layer === 'number' && c.fields.layer > 0);
    if (layered) out.layer = unityLayer(layered.fields.layer as number);
    if (!n.visible) {
      // three hides the subtree and keeps its behaviours running; Unity's inactive object stops them.
      if (hasComponents(n)) out.renderersEnabled = false;
      else out.active = false;
    }
    if (n.prefab) {
      const path = prefabPath.get(n.prefab);
      if (path) {
        out.prefab = path;
        if (n.given) out.given = true;
      }
      // Given attributes, it holds what it is built as: copied in.
      else if (!n.given) warnings.push(`${n.source ?? n.name}: nested ${n.prefab} is not a prefab of its own — left empty.`);
    }
    if (n.model) {
      // A placed model is the model file, placed as a prefab is. glTFast mirrors a model in x where this
      // export mirrors the world in z: half a turn about its own up puts it back as three draws it.
      const file = fileOf(n.model, 'Model');
      if (file && typeof file === 'object' && 'asset' in file) {
        out.prefab = file.asset;
        const found = options.textures?.(n.model);
        if (found && /\.glb$/i.test(found.file)) out.meshNodes = glbMeshNodes(found.file);
        const [x, y, z, w] = out.rotation as [number, number, number, number];
        out.rotation = [-z, w, x, -y].map((c) => (c === 0 ? 0 : c));
      }
    }
    if (n.geometry) out.mesh = meshPath.get(n.geometry);
    // A mesh whose geometry its code builds (a river's ribbon) still has its renderer and material.
    if (n.materials) out.materials = n.materials.map((id) => materialPath.get(id)!);
    if (n.geometry || n.materials) {
      out.castShadows = n.castShadow;
      out.receiveShadows = n.receiveShadow;
    }
    if (n.camera) {
      const c = n.camera;
      out.camera = c.fov !== undefined
        ? { orthographic: false, near: c.near, far: c.far, fov: c.fov / c.zoom }
        : { orthographic: true, near: c.near, far: c.far, size: (c.top! - c.bottom!) / 2 / c.zoom };
    }
    if (n.light) {
      const l = n.light;
      if (l.type === 'HemisphereLight' || l.type === 'AmbientLight') {
        if (ambient) warnings.push(`${n.source ?? n.name}: a second ambient light — only the first sets the scene's ambient.`);
        else ambient = { sky: l.color, equator: l.groundColor ? mix(l.color, l.groundColor) : l.color, ground: l.groundColor ?? l.color, intensity: l.intensity / Math.PI };
      } else if (l.type === 'DirectionalLight' || l.type === 'PointLight' || l.type === 'SpotLight') {
        const light: UnityLight = { type: l.type.replace('Light', '') as UnityLight['type'], color: l.color, intensity: l.intensity / Math.PI, shadows: l.castShadow };
        if (l.type !== 'DirectionalLight') light.range = l.distance || Math.sqrt(l.intensity / Math.PI) * 10;
        if (l.type === 'SpotLight') {
          light.spotAngle = ((l.angle ?? Math.PI / 3) * 2 * 180) / Math.PI;
          light.innerSpotAngle = light.spotAngle * (1 - (l.penumbra ?? 0));
        }
        if (l.direction) out.rotation = lookRotation(flipV(l.direction));
        out.light = light;
      } else warnings.push(`${n.source ?? n.name}: a ${l.type} is not exported.`);
    }
    return out;
  };

  const prefabs: UnityPrefab[] = [];
  const scenes: UnityScene[] = [];
  for (const p of order(snap.prefabs)) {
    if (!p.scene) {
      prefabs.push({ path: prefabPath.get(p.id)!, root: node(p.root) });
      continue;
    }
    ambient = undefined;
    const root = node(p.root);
    // The scene's own components, if any, need an object to live on: one that holds the whole scene, as
    // three's Scene does — so DontDestroyOnLoad on it keeps the scene, and GetComponentInParent finds it.
    // A reference into the scene, a path of child indices, starts one level down.
    const roots = root.components.length
      ? nestNodes([{ ...root, name: p.name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }])
      : root.children;
    const scene: UnityScene = { path: `Assets/Scenes/${sceneName.get(p.id)}.unity`, roots };
    if (p.background) scene.background = p.background;
    if (p.fog) scene.fog = p.fog.type === 'linear' ? { mode: 'linear', color: p.fog.color, start: p.fog.near, end: p.fog.far } : { mode: 'exp2', color: p.fog.color, density: p.fog.density };
    if (ambient) scene.ambient = ambient;
    scenes.push(scene);
  }
  if (options.firstScene) {
    const first = scenes.findIndex((s) => s.path.endsWith(`/${options.firstScene}.unity`));
    if (first > 0) scenes.unshift(...scenes.splice(first, 1));
  }

  const given = options.layers ?? { names: {}, ignore2D: [], ignore3D: [] };
  const used = new Set([...given.ignore2D.flat(), ...given.ignore3D.flat(), ...Object.keys(given.names).map(Number)].filter((n) => n > 0));
  const layers = {
    names: Object.fromEntries([...used].map((n) => [unityLayer(n), given.names[n] ?? `Layer ${n}`])),
    ignore2D: given.ignore2D.map(([a, b]) => [unityLayer(a), unityLayer(b)] as [number, number]),
    ignore3D: given.ignore3D.map(([a, b]) => [unityLayer(a), unityLayer(b)] as [number, number]),
  };
  return { data: { meshes, terrains, materials, prefabs, scenes, layers, modelVariants, dataTextures, warnings }, scripts: scripts(snap, field, read, options, warnings), copies };
}

/** What the game's TypeScript says beyond the snapshot, read once for the whole export. */
interface Sources {
  /** Each behaviour's class, parsed. */
  classes: Map<string, ClassSource>;
  /** `Type.field` of each Vector3 field a rotation is set from: a rate about each axis. */
  axes: Set<string>;
  /** The templates each class clones, by field: `Progress` → `chip` → `Assets/UI/chip.uxml`. */
  templates: Map<string, Map<string, string>>;
  /** Whether any behaviour sets a material's emissive: then every lit material can glow. */
  emits: boolean;
  /** The prefabs each class names in its code (`instantiate(Goblin)`), by field: `Game` → `goblin` → the prefab. */
  prefabs: Map<string, Map<string, SnapshotValue>>;
}

function readSources(snap: Snapshot, options: ConvertOptions): Sources {
  const out: Sources = { classes: new Map(), axes: new Set(), templates: new Map(), emits: false, prefabs: new Map() };
  const prefabNames: (readonly [string, SnapshotValue])[] = [
    ...snap.prefabs.filter((p) => !p.scene).map((p) => [p.name, { prefab: p.id }] as const),
    // A model's prefab is the model file, as Unity's model prefab is.
    ...Object.entries(snap.models ?? {}).map(([id, url]) => [id.split('#')[1]!, { file: url, type: 'Model' }] as const),
  ];
  const templates = options.templates ?? {};
  for (const [type, info] of Object.entries(snap.classes)) {
    const code = options.source?.(info.file);
    if (!code) continue;
    if (/\.emissive(Intensity)?\b/.test(code)) out.emits = true;
    const cls = readClass(code, info.file, type);
    if (!cls) continue;
    out.classes.set(type, cls);
    const fields = new Set(cls.members.filter((m) => m.kind === 'field').map((m) => m.name));
    for (const m of cls.members) {
      for (const line of m.body ?? []) {
        // `rotation.x += this.speed.x * k`: the field is a rate about the axes.
        const set = /(?:\.rotation|\.eulerAngles|\.rotate\w*\()(?:[.\w]*\s*[-+*/]?=)?(.*)$/.exec(line);
        if (set) for (const [, name] of set[1]!.matchAll(/this\.(\w+)/g)) if (fields.has(name!)) out.axes.add(`${type}.${name}`);
        // `this.chip = element('chip')`, where `chip` is a template's id.
        const clone = /this\.(\w+)\s*=\s*[^;]*?\(\s*['"`]#?([\w-]+)['"`]/.exec(line);
        if (clone && fields.has(clone[1]!) && templates[clone[2]!]) {
          const own = out.templates.get(type) ?? new Map<string, string>();
          own.set(clone[1]!, templates[clone[2]!]!);
          out.templates.set(type, own);
        }
      }
    }
    // A template named anywhere else in the class — `clone('who')` through a helper — is a field of its
    // own: the id's name, or `<id>Template` where the class has a member called that already.
    const own = out.templates.get(type) ?? new Map<string, string>();
    const taken = new Set(cls.members.map((m) => m.name));
    const wired = new Set(own.values());
    const text = cls.members.map((m) => m.text).join('\n');
    for (const [id, path] of Object.entries(templates)) {
      if (wired.has(path) || !new RegExp(`['"\`]#?${id}['"\`]`).test(text)) continue;
      const name = id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
      own.set(taken.has(name) ? `${name}Template` : name, path);
    }
    if (own.size) out.templates.set(type, own);
    // A prefab the class names in its code — it imports and instantiates it — is a field Unity wires: the
    // prefab's name in camelCase (`Goblin` → `goblin`), or `<name>Prefab` where that name is a member already.
    const spawns = new Map<string, SnapshotValue>();
    const written = new Set(Object.keys(info.defaults ?? {}));
    for (const [name, ref] of prefabNames) {
      if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
      const camel = name.charAt(0).toLowerCase() + name.slice(1);
      const field = taken.has(camel) || written.has(camel) ? `${camel}Prefab` : camel;
      spawns.set(field, ref);
    }
    if (spawns.size) out.prefabs.set(type, spawns);
  }
  return out;
}

/** Every node reference in `roots` under the one root that now holds them; the scene itself (`''`) is that root. */
function nestNodes(roots: UnityNode[]): UnityNode[] {
  const shift = (v: UnityValue): UnityValue => {
    if (!v || typeof v !== 'object') return v;
    if ('array' in v) return { array: v.array.map(shift) };
    if ('node' in v) return { ...v, node: v.node === '' ? '0' : `0/${v.node}` };
    return v;
  };
  const visit = (n: UnityNode): UnityNode => ({
    ...n,
    components: n.components.map((c) => ({ ...c, fields: Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [k, shift(v)])) })),
    children: n.children.map(visit),
  });
  return roots.map(visit);
}

/**
 * Siblings of one name made apart as Unity's Duplicate names them — `Mesh`, `Mesh (1)` — so a placed
 * prefab's override can say which child it changes (three names an unnamed mesh after its type).
 */
function siblings(children: UnityNode[]): UnityNode[] {
  const seen = new Map<string, number>();
  for (const c of children) {
    const k = seen.get(c.name) ?? 0;
    seen.set(c.name, k + 1);
    if (k > 0) c.name = `${c.name} (${k})`;
  }
  return children;
}

function hasComponents(n: SnapshotNode): boolean {
  return n.components.length > 0 || n.children.some(hasComponents);
}

/** Asset paths, one per name per folder, made safe for a file system and for Unity. */
class Paths {
  private readonly taken = new Set<string>();
  take(folder: string, name: string, ext: string): string {
    const base = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'Unnamed';
    let path = `${folder}/${base}${ext}`;
    for (let i = 2; this.taken.has(path.toLowerCase()); i++) path = `${folder}/${base}_${i}${ext}`;
    this.taken.add(path.toLowerCase());
    return path;
  }
}

const numbers = (v: SnapshotValue | undefined): number[] =>
  v && typeof v === 'object' && 'array' in v ? v.array.map((x) => (typeof x === 'number' ? x : 0)) : [];

/** A terrain's metres as Unity's TerrainData: mirrored in z, anchored at its corner, heights 0..1 of their span. */
/**
 * `scale` is the node's own scale in the world: Unity draws a Terrain at its data's size whatever its
 * transform's scale, so a terrain under a scaled node takes the scale into its size and its tiling.
 */
function terrain(f: Record<string, SnapshotValue>, path: string, copy: (url: string) => string | undefined = () => undefined, scale = 1): { terrain: UnityTerrain; warnings: string[] } {
  const warnings: string[] = [];
  const width = f.width as number;
  const depth = f.depth as number;
  const n = f.heightmapResolution as number;
  const metres = numbers(f.heights);
  let low = Infinity;
  let high = -Infinity;
  for (const h of metres) {
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  if (!Number.isFinite(low)) low = high = 0;
  // Unity's terrain needs some height to span; a flat one gets a metre.
  const span = high - low || 1;
  const heights = new Array<number>(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) heights[(n - 1 - r) * n + c] = Math.round(((metres[r * n + c]! - low) / span) * 1e5) / 1e5;
  }

  const layerValues = f.terrainLayers && typeof f.terrainLayers === 'object' && 'array' in f.terrainLayers ? f.terrainLayers.array : [];
  const layers = layerValues.map((l) => {
    const fields = l && typeof l === 'object' && 'object' in l ? l.object.fields : {};
    const color = fields.color && typeof fields.color === 'object' && 'color' in fields.color ? fields.color.color : '#808080';
    const texture = typeof fields.texture === 'string' ? copy(fields.texture) : undefined;
    const normalMap = typeof fields.normalMap === 'string' ? copy(fields.normalMap) : undefined;
    if (fields.textured && !texture) warnings.push(`${path}: layer "${fields.name || 'unnamed'}" has a texture made in code, which is not exported — it is its colour in Unity.`);
    return { name: String(fields.name ?? ''), tileSize: Number(fields.tileSize ?? 10) * scale, color, ...(texture ? { texture } : {}), ...(normalMap ? { normalMap } : {}) };
  });
  const a = f.alphamapResolution as number;
  const bytes = numbers(f.alphamaps);
  const unityA = Math.min(Math.max(2 ** Math.ceil(Math.log2(Math.max(a, 1))), 16), 2048);
  const alphamaps: number[] = [];
  if (layers.length > 0) {
    for (let y = 0; y < unityA; y++) {
      const r = Math.min(a - 1, Math.floor((1 - (y + 0.5) / unityA) * a));
      for (let x = 0; x < unityA; x++) {
        const c = Math.min(a - 1, Math.floor(((x + 0.5) / unityA) * a));
        for (let l = 0; l < layers.length; l++) {
          const byte = bytes.length ? bytes[l * a * a + r * a + c]! : l === 0 ? 255 : 0;
          alphamaps.push(Math.round((byte / 255) * 1000) / 1000);
        }
      }
    }
  }
  return {
    terrain: {
      path,
      size: [width * scale, span * scale, depth * scale],
      offset: [-width / 2, low, -depth / 2],
      heightmapResolution: n,
      heights,
      alphamapResolution: unityA,
      alphamaps,
      layers,
    },
    warnings,
  };
}

function mesh(g: SnapshotGeometry, path: string): UnityMesh {
  const vertices = g.position.map((v, i) => (i % 3 === 2 && v !== 0 ? -v : v));
  const out: UnityMesh = { path, vertices, submeshes: [] };
  if (g.normal) out.normals = g.normal.map((v, i) => (i % 3 === 2 && v !== 0 ? -v : v));
  if (g.uv) out.uv = g.uv;
  if (g.color) out.colors = g.colorSize === 4 ? g.color : g.color.flatMap((v, i) => (i % 3 === 2 ? [v, 1] : [v]));
  // Mirrored with its camera, a triangle still winds counter-clockwise on screen — three's front, Unity's back.
  const wind = (from: number, count: number) => {
    const out: number[] = [];
    for (let i = from; i + 2 < from + count; i += 3) out.push(g.index[i]!, g.index[i + 2]!, g.index[i + 1]!);
    return out;
  };
  if (!g.groups.length) out.submeshes.push(wind(0, g.index.length));
  else {
    const count = Math.max(...g.groups.map((gr) => gr.materialIndex)) + 1;
    out.submeshes = Array.from({ length: count }, () => []);
    for (const gr of g.groups) out.submeshes[gr.materialIndex]!.push(...wind(gr.start, Math.min(gr.count, g.index.length - gr.start)));
  }
  return out;
}

function material(m: SnapshotMaterial, path: string, textures: TextureSource | undefined, copies: Map<string, string>, warnings: string[], emits = false): UnityMaterial {
  const lit = !/Basic/.test(m.type);
  const out: UnityMaterial = {
    path,
    shader: lit ? 'lit' : 'unlit',
    color: m.color ?? '#ffffff',
    opacity: m.opacity,
    transparent: m.transparent,
    cull: m.side === 2 ? 0 : m.side === 1 ? 1 : 2,
    zWrite: m.depthWrite,
  };
  if (m.alphaTest > 0) out.alphaClip = m.alphaTest;
  if (lit) {
    out.smoothness = m.roughness !== undefined ? 1 - m.roughness : m.shininess !== undefined ? Math.min(1, m.shininess / 100) : 0.5;
    out.metallic = m.metalness ?? 0;
  }
  // URP draws emission only with its keyword on: a material whose code may light it later — black now,
  // a colour set from a behaviour — keeps it on, or setting _EmissionColor at runtime draws nothing.
  if ((m.emissiveIntensity ?? 1) > 0 && ((m.emissive && m.emissive !== '#000000') || (emits && lit))) {
    out.emission = m.emissive ?? '#000000';
    out.emissionIntensity = m.emissiveIntensity ?? 1;
  }
  for (const [slot, key] of [['map', 'texture'], ['emissiveMap', 'emissionTexture']] as const) {
    const url = m[slot];
    if (!url) continue;
    const found = textures?.(url);
    if (found) {
      out[key] = `Assets/Textures/${found.name}`;
      copies.set(found.file, out[key]!);
    } else warnings.push(`${m.source ?? m.name}: ${slot} ${url.startsWith('data:') ? '(drawn in code)' : url} was not found in the project — left off.`);
  }
  if (m.repeat) out.tiling = m.repeat;
  if (m.vertexColors) out.vertexColors = true;
  if (m.flatShading) warnings.push(`${m.source ?? m.name}: flat shading is not exported — the mesh keeps its normals.`);
  return out;
}

/** Prefabs before the prefabs and scenes that nest them, so each exists when it is placed. */
function order(prefabs: SnapshotPrefab[]): SnapshotPrefab[] {
  const byId = new Map(prefabs.map((p) => [p.id, p]));
  const done = new Set<string>();
  const out: SnapshotPrefab[] = [];
  const visit = (p: SnapshotPrefab, path: Set<string>) => {
    if (done.has(p.id) || path.has(p.id)) return;
    path.add(p.id);
    const deps = (n: SnapshotNode): string[] => [...(n.prefab ? [n.prefab] : []), ...n.children.flatMap(deps)];
    for (const dep of deps(p.root)) {
      const d = byId.get(dep);
      if (d) visit(d, path);
    }
    done.add(p.id);
    out.push(p);
  };
  for (const p of prefabs) visit(p, new Set());
  return out;
}

/** Unity's Quaternion.LookRotation(forward, up = Y). */
function lookRotation([fx, fy, fz]: number[]): number[] {
  let f = [fx!, fy!, fz!];
  const len = Math.hypot(...f) || 1;
  f = f.map((v) => v / len);
  let up = [0, 1, 0];
  if (Math.abs(f[1]!) > 0.999) up = [0, 0, 1];
  const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  let r = cross(up, f);
  const rl = Math.hypot(...r) || 1;
  r = r.map((v) => v / rl);
  const u = cross(f, r);
  // Columns r, u, f are the rotated axes; turn the matrix into a quaternion.
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [r[0]!, u[0]!, f[0]!, r[1]!, u[1]!, f[1]!, r[2]!, u[2]!, f[2]!];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
  }
  return [x, y, z, w].map((v) => Math.round(v * 1e6) / 1e6);
}

function mix(a: string, b: string): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round((v + y[i]!) / 2).toString(16).padStart(2, '0')).join('')}`;
}

// --- C# for game behaviours ----------------------------------------------------------------------

/**
 * One MonoBehaviour per game behaviour: the fields its elements write — typed from the values
 * written, started from the defaults a fresh instance holds — and, from its TypeScript, every other
 * member with that member's code inside it as comments, for a port to write in place.
 */
function scripts(snap: Snapshot, value: (type: string, field: string, v: SnapshotValue) => UnityValue, read: Sources, options: ConvertOptions, warnings: string[]): Map<string, string> {
  const source = options.source;
  const seen = new Map<string, Map<string, UnityValue[]>>();
  const visit = (n: SnapshotNode) => {
    for (const c of n.components) {
      if (!c.game) continue;
      const fields = seen.get(c.type) ?? new Map<string, UnityValue[]>();
      seen.set(c.type, fields);
      for (const [k, v] of Object.entries(c.fields)) fields.set(k, [...(fields.get(k) ?? []), value(c.type, k, v)]);
      for (const [k, path] of read.templates.get(c.type) ?? []) if (!(k in c.fields)) fields.set(k, [...(fields.get(k) ?? []), { asset: path }]);
      for (const [k, ref] of read.prefabs.get(c.type) ?? []) if (!(k in c.fields)) fields.set(k, [...(fields.get(k) ?? []), value(c.type, k, ref)]);
    }
    n.children.forEach(visit);
  };
  snap.prefabs.forEach((p) => visit(p.root));

  const classes = new Map(Object.keys(snap.classes).map((type) => [type, csName(type)]));
  const out = new Map<string, string>();
  // A file's code outside its behaviours goes with the first of them, once.
  const outsideGiven = new Set<string>();
  for (const type of new Set([...seen.keys(), ...Object.keys(snap.classes)])) {
    const info = snap.classes[type];
    const wired = new Map<string, string>();
    const usings = new Set<string>();
    for (const [name, values] of seen.get(type) ?? []) {
      const cs = csType(values);
      // A stub that does not compile stops the Editor at Safe Mode before anything can be ported: a type
      // only goes into C# when it is known to be there — the game's own, or Unity's with its namespace.
      const known = cs === undefined ? undefined : knownType(cs, classes);
      if (cs && known === undefined) {
        warnings.push(`${type}.${name} holds a ${cs}, which has no C# type here — the stub leaves it as a comment: declare it when porting.`);
        wired.set(name, `    // ${name}: a ${cs} in TypeScript, which has no C# type here — declare it when porting`);
        continue;
      }
      if (known) usings.add(known);
      const fallback = info?.defaults[name];
      const init = fallback === undefined ? '' : csValue(value(type, name, fallback), cs);
      wired.set(name, cs ? `    public ${cs} ${name}${init ? ` = ${init}` : ''};` : `    // ${name}: always empty where it is written, so its type is unknown`);
    }
    const using = (text: string) => {
      const missing = [...usings].filter((u) => !text.includes(`using ${u};`)).map((u) => `using ${u};\n`).join('');
      return missing + text;
    };
    const name = csName(type);
    const code = info && source?.(info.file);
    const cls = read.classes.get(type);
    if (cls) {
      const file = info!.file;
      const outside = outsideGiven.has(file) ? [] : outsideClasses(code!, file, Object.keys(snap.classes).filter((t) => snap.classes[t]!.file === file));
      outsideGiven.add(file);
      out.set(name, using(stubClass(name, file, cls, wired, classes, outside, options.aliases).replace(/^(public class)/m, `${name !== type ? `// Named ${name}: Unity has its own ${type}.\n` : ''}$1`)));
      continue;
    }
    out.set(name, using([
      'using UnityEngine;',
      '',
      `// The fields ${info?.file ?? 'the game'} sets on ${type} in its scenes and prefabs. Port its logic here;`,
      '// keep the field names, the prefabs are wired by them. Written by scenoco-unity once, never overwritten.',
      ...(name !== type ? [`// Named ${name}: Unity has its own ${type}.`] : []),
      `public class ${name} : MonoBehaviour`,
      '{',
      ...wired.values(),
      '}',
      '',
    ].join('\n')));
  }
  return out;
}

/**
 * The C# types a stub may name, by the namespace each needs: Unity's own that a SceNoCo package's
 * component or an asset becomes. Anything else stays a comment, so a stub always compiles.
 */
const NAMESPACES: Record<string, string> = {
  ...Object.fromEntries(
    ('float int bool string Vector2 Vector3 Vector4 Quaternion Color GameObject Transform Material Mesh Texture Texture2D AudioClip ' +
      'AudioSource AudioListener Camera Light Rigidbody Rigidbody2D Collider Collider2D BoxCollider SphereCollider CapsuleCollider ' +
      'MeshCollider BoxCollider2D CircleCollider2D CapsuleCollider2D PolygonCollider2D EdgeCollider2D Joint2D HingeJoint2D ' +
      'FixedJoint2D SpringJoint2D DistanceJoint2D WheelJoint2D SliderJoint2D HingeJoint FixedJoint SpringJoint ConfigurableJoint ' +
      'CharacterJoint Terrain TerrainData TerrainCollider TerrainLayer ParticleSystem Animator MeshFilter MeshRenderer Renderer ' +
      'PhysicsMaterial PhysicsMaterial2D MonoBehaviour Behaviour Component Sprite')
      .split(' ')
      .map((t) => [t, 'UnityEngine']),
  ),
  ...Object.fromEntries('SplineContainer SplineAnimate SplineInstantiate SplineExtrude'.split(' ').map((t) => [t, 'UnityEngine.Splines'])),
  ...Object.fromEntries('UIDocument VisualTreeAsset VisualElement PanelSettings'.split(' ').map((t) => [t, 'UnityEngine.UIElements'])),
  Volume: 'UnityEngine.Rendering',
  VolumeProfile: 'UnityEngine.Rendering',
  SplineMesh: 'SceNoCo',
};

/** The namespace a stub needs for `cs` (an array of it too); '' for a class of the game; undefined when unknown. */
function knownType(cs: string, classes: Map<string, string>): string | undefined {
  const base = cs.replace(/(\[\])+$/, '');
  if ([...classes.values()].includes(base)) return '';
  return NAMESPACES[base];
}

function csType(values: UnityValue[]): string | undefined {
  const known = values.find((v) => v !== null && !(typeof v === 'object' && 'array' in v && v.array.length === 0)) ?? values[0];
  if (known === undefined || known === null) return undefined;
  if (typeof known === 'number') return 'float';
  if (typeof known === 'boolean') return 'bool';
  if (typeof known === 'string') return 'string';
  if ('v2' in known) return 'Vector2';
  if ('v3' in known) return 'Vector3';
  if ('v4' in known) return 'Vector4';
  if ('quat' in known) return 'Quaternion';
  if ('color' in known) return 'Color';
  if ('component' in known) return (known as { component: string }).component;
  if ('node' in known) return 'Transform';
  if ('asset' in known) return assetType(known.asset);
  if ('array' in known) {
    const inner = csType(values.flatMap((v) => (v && typeof v === 'object' && 'array' in v ? v.array : [])));
    return inner ? `${inner}[]` : undefined;
  }
  return undefined;
}

/** The C# type of an asset, by its file: a model imports as a GameObject, as a prefab does. */
export function assetType(path: string): string {
  if (/\.(prefab|glb|gltf)$/i.test(path)) return 'GameObject';
  if (path.endsWith('.mat')) return 'Material';
  if (path.endsWith('.uxml')) return 'VisualTreeAsset';
  if (/\.(wav|mp3|ogg|m4a|aiff?|flac)$/i.test(path)) return 'AudioClip';
  if (/\.(png|jpe?g|webp|tga)$/i.test(path)) return 'Texture2D';
  if (path.startsWith('Assets/Terrains/')) return 'TerrainData';
  if (path.startsWith('Assets/Materials/Physics/')) return 'PhysicsMaterial';
  return 'Mesh';
}

function csValue(v: UnityValue, type: string | undefined): string {
  const f = (n: number) => `${Number.isInteger(n) ? n : n}f`;
  if (v === null || type === undefined) return '';
  if (typeof v === 'number') return type === 'float' ? f(v) : '';
  if (typeof v === 'boolean') return type === 'bool' ? String(v) : '';
  if (typeof v === 'string') return type === 'string' ? JSON.stringify(v) : '';
  if ('v2' in v && type === 'Vector2') return `new Vector2(${v.v2.map(f).join(', ')})`;
  if ('v3' in v && type === 'Vector3') return `new Vector3(${v.v3.map(f).join(', ')})`;
  if ('color' in v && type === 'Color') {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.color.slice(i, i + 2), 16) / 255);
    return `new Color(${[r!, g!, b!].map((n) => f(Math.round(n * 1000) / 1000)).join(', ')})`;
  }
  if ('array' in v && type.endsWith('[]')) {
    const inner = type.slice(0, -2);
    const items = v.array.map((i) => csValue(i, inner));
    return items.length && items.every(Boolean) ? `{ ${items.join(', ')} }` : '';
  }
  return '';
}

/**
 * The objects of a .glb that hold a mesh, as glTFast builds them under the model's root: one per node
 * of its scene, named as the node is, or `Node-<index>` when it has no name.
 */
export function glbMeshNodes(file: string): string[][] {
  if (!existsSync(file)) return [];
  const bytes = readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) return [];
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as {
    scene?: number;
    scenes?: { nodes?: number[] }[];
    nodes?: { name?: string; mesh?: number; children?: number[] }[];
  };
  const nodes = json.nodes ?? [];
  const out: string[][] = [];
  const walk = (index: number, path: string[]) => {
    const node = nodes[index];
    if (!node) return;
    const here = [...path, node.name || `Node-${index}`];
    if (node.mesh !== undefined) out.push(here);
    for (const child of node.children ?? []) walk(child, here);
  };
  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? []) walk(root, []);
  return out;
}
