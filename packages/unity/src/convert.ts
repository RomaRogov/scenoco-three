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
import { outsideClasses, readClass, stubClass } from './stub.js';

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
  /** Its Unity layer, from a collider's `layer`: SceNoCo's layer n is Unity's user layer n + 7. */
  layer?: number;
  children: UnityNode[];
  source?: string;
}

export interface UnityMesh {
  path: string;
  vertices: number[];
  normals?: number[];
  uv?: number[];
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

const flipV = ([x, y, z]: number[]) => [x!, y!, z === 0 ? 0 : -z!];
const flipQ = ([x, y, z, w]: number[]) => [x === 0 ? 0 : -x!, y === 0 ? 0 : -y!, z!, w!];

export interface ConvertOptions {
  /** The scene `main.ts` plays: listed first in Build Settings. */
  firstScene?: string;
  textures?: TextureSource;
  /** A behaviour's TypeScript, by the module path the snapshot gives (`/src/Player.ts`): its stub then carries every member. */
  source?: (file: string) => string | null;
  /** The game's layers as SceNoCo numbers them: names, and the pairs its physics ignores. */
  layers?: { names: Record<number, string>; ignore2D: [number, number][]; ignore3D: [number, number][] };
}

export function convert(snap: Snapshot, options: ConvertOptions = {}): Converted {
  const warnings = [...snap.warnings];
  const paths = new Paths();
  const copies = new Map<string, string>();

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
    return material(m, path, options.textures, copies, warnings);
  });

  const prefabPath = new Map<string, string>();
  const sceneName = new Map<string, string>();
  for (const p of snap.prefabs) {
    if (p.scene) sceneName.set(p.id, paths.take('Assets/Scenes', p.name, '.unity').replace(/^.*\/|\.unity$/g, ''));
    else prefabPath.set(p.id, paths.take('Assets/Prefabs', p.name, '.prefab'));
  }

  const value = (v: SnapshotValue): UnityValue => {
    if (v === null || typeof v !== 'object') return v;
    if ('v3' in v) return { v3: flipV(v.v3) };
    if ('quat' in v) return { quat: flipQ(v.quat) };
    if ('array' in v) return { array: v.array.map(value) };
    if ('prefab' in v) return sceneName.get(v.prefab) ?? (prefabPath.has(v.prefab) ? { asset: prefabPath.get(v.prefab)! } : null);
    if ('component' in v) return { component: csName(v.component), node: v.node };
    if ('material' in v) return { asset: materialPath.get(v.material)! };
    if ('geometry' in v) return { asset: meshPath.get(v.geometry)! };
    if ('object' in v) return { object: { type: v.object.type, fields: Object.fromEntries(Object.entries(v.object.fields).map(([k, f]) => [k, value(f)])) } };
    return v;
  };

  let ambient: UnityScene['ambient'];
  const node = (n: SnapshotNode): UnityNode => {
    const out: UnityNode = {
      name: n.name,
      position: flipV(n.position),
      rotation: flipQ(n.quaternion),
      scale: n.scale,
      active: true,
      renderersEnabled: true,
      components: n.components.map((c) => {
        const fields: Record<string, UnityValue> = {};
        for (const [k, v] of Object.entries(c.fields)) fields[k] = value(v);
        const component: UnityComponent = { type: c.game ? csName(c.type) : c.type, game: c.game, fields };
        if (c.source) component.source = c.source;
        return component;
      }),
      children: n.children.map(node),
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
      if (path) out.prefab = path;
      else warnings.push(`${n.source ?? n.name}: nested ${n.prefab} is not a prefab of its own — left empty.`);
    }
    if (n.geometry) out.mesh = meshPath.get(n.geometry);
    if (n.materials && n.geometry) out.materials = n.materials.map((id) => materialPath.get(id)!);
    if (n.geometry) {
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
    // The scene's own components, if any, need an object to live on: the first root, before the
    // scene's children — so a reference into the scene, a path of child indices, moves one along.
    const roots = root.components.length
      ? shiftNodes([{ ...root, name: p.name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], children: [] }, ...root.children])
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
  return { data: { meshes, materials, prefabs, scenes, layers, warnings }, scripts: scripts(snap, value, options.source), copies };
}

/** Every node reference in `roots` one root further along; the scene itself (`''`) is now the first root. */
function shiftNodes(roots: UnityNode[]): UnityNode[] {
  const shift = (v: UnityValue): UnityValue => {
    if (!v || typeof v !== 'object') return v;
    if ('array' in v) return { array: v.array.map(shift) };
    if ('node' in v) {
      const [first, ...rest] = v.node === '' ? ['-1'] : v.node.split('/');
      return { ...v, node: [String(Number(first) + 1), ...rest].join('/') };
    }
    return v;
  };
  const visit = (n: UnityNode): UnityNode => ({
    ...n,
    components: n.components.map((c) => ({ ...c, fields: Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [k, shift(v)])) })),
    children: n.children.map(visit),
  });
  return roots.map(visit);
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

function mesh(g: SnapshotGeometry, path: string): UnityMesh {
  const vertices = g.position.map((v, i) => (i % 3 === 2 && v !== 0 ? -v : v));
  const out: UnityMesh = { path, vertices, submeshes: [] };
  if (g.normal) out.normals = g.normal.map((v, i) => (i % 3 === 2 && v !== 0 ? -v : v));
  if (g.uv) out.uv = g.uv;
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

function material(m: SnapshotMaterial, path: string, textures: TextureSource | undefined, copies: Map<string, string>, warnings: string[]): UnityMaterial {
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
  if (m.emissive && m.emissive !== '#000000' && (m.emissiveIntensity ?? 1) > 0) {
    out.emission = m.emissive;
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
  if (m.vertexColors) warnings.push(`${m.source ?? m.name}: vertex colours are not exported.`);
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
function scripts(snap: Snapshot, value: (v: SnapshotValue) => UnityValue, source?: (file: string) => string | null): Map<string, string> {
  const seen = new Map<string, Map<string, UnityValue[]>>();
  const visit = (n: SnapshotNode) => {
    for (const c of n.components) {
      if (!c.game) continue;
      const fields = seen.get(c.type) ?? new Map<string, UnityValue[]>();
      seen.set(c.type, fields);
      for (const [k, v] of Object.entries(c.fields)) fields.set(k, [...(fields.get(k) ?? []), value(v)]);
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
    for (const [name, values] of seen.get(type) ?? []) {
      const cs = csType(values);
      const fallback = info?.defaults[name];
      const init = fallback === undefined ? '' : csValue(value(fallback), cs);
      wired.set(name, cs ? `    public ${cs} ${name}${init ? ` = ${init}` : ''};` : `    // ${name}: always empty where it is written, so its type is unknown`);
    }
    const name = csName(type);
    const code = info && source?.(info.file);
    const cls = code ? readClass(code, info.file, type) : undefined;
    if (cls) {
      const file = info!.file;
      const outside = outsideGiven.has(file) ? [] : outsideClasses(code!, file, Object.keys(snap.classes).filter((t) => snap.classes[t]!.file === file));
      outsideGiven.add(file);
      out.set(name, stubClass(name, file, cls, wired, classes, outside).replace(/^(public class)/m, `${name !== type ? `// Named ${name}: Unity has its own ${type}.\n` : ''}$1`));
      continue;
    }
    out.set(name, [
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
    ].join('\n'));
  }
  return out;
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
  if ('asset' in known) return known.asset.endsWith('.prefab') ? 'GameObject' : known.asset.endsWith('.mat') ? 'Material' : 'Mesh';
  if ('array' in known) {
    const inner = csType(values.flatMap((v) => (v && typeof v === 'object' && 'array' in v ? v.array : [])));
    return inner ? `${inner}[]` : undefined;
  }
  return undefined;
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
