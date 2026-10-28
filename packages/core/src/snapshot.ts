/**
 * Every prefab and scene a project declares, built once and written down as plain data: what an
 * exporter turns into another engine's files.
 *
 * Building runs nothing but the declarations. A prefab's elements construct their three.js objects,
 * a behaviour element constructs its behaviour dormant — no `awake`, no `start` — so what is written
 * down is what the TSX declares, never what code made of it at runtime. A value that differs between
 * two builds (a `Math.random()` in an attribute) is reported, not silently baked.
 *
 * Sharing follows three.js exactly: one geometry or material object is one entry, used by every node
 * that holds it. A material written inside an element is that element's own, and stays apart from an
 * identical one written elsewhere — a behaviour may recolour one and not the other. Geometry is data:
 * two with the same vertices are one entry, however they were spelled.
 */
import {
  Color,
  Quaternion,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Camera,
  type Fog,
  type FogExp2,
  type Light,
  type Material,
  type Object3D,
  type Scene,
  type Texture,
} from 'three';
import { Behaviour, behavioursOn } from './kernel/index.js';
import { isPrefab, prefabOf, sourceOf } from './jsx.js';
import { writtenOf } from './kernel/index.js';

/** A value a behaviour's field holds, as data. Vectors are three.js's, untouched: right-handed, Y up. */
export type SnapshotValue =
  | null
  | number
  | boolean
  | string
  | { v2: number[] }
  | { v3: number[] }
  | { v4: number[] }
  | { quat: number[] }
  | { color: string }
  | { array: SnapshotValue[] }
  /** A node of the same prefab, by its path of child indices from the root ('' is the root). */
  | { node: string }
  /** A behaviour on a node of the same prefab. */
  | { component: string; node: string }
  | { prefab: string }
  | { material: string }
  /** A plain settings object — a physics material — as its class and its own values. */
  | { object: { type: string; fields: Record<string, number | boolean | string> } }
  | { geometry: string };

export interface SnapshotComponent {
  /** The class's name: a game's own when `game`, else a package's (`Rigidbody`, `BoxCollider2D`). */
  type: string;
  game: boolean;
  /** The fields its element wrote, nothing else. */
  fields: Record<string, SnapshotValue>;
  source?: string;
}

export interface SnapshotLight {
  type: string;
  color: string;
  intensity: number;
  castShadow: boolean;
  /** Directional and spot: where the light points, in its parent's space — three aims a light at a target, not by its rotation. */
  direction?: number[];
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  groundColor?: string;
}

export interface SnapshotCamera {
  type: string;
  near: number;
  far: number;
  zoom: number;
  fov?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface SnapshotNode {
  name: string;
  /** three's `type`: Mesh, Group, PerspectiveCamera, DirectionalLight… */
  kind: string;
  position: number[];
  quaternion: number[];
  scale: number[];
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Where its element was written, `file:line:column`. */
  source?: string;
  geometry?: string;
  /** One id, or one per geometry group. */
  materials?: string[];
  light?: SnapshotLight;
  camera?: SnapshotCamera;
  components: SnapshotComponent[];
  /** A nested prefab: `<ArrowBase />` written with no attributes. Its contents are that prefab's, so there are no children here. */
  prefab?: string;
  children: SnapshotNode[];
}

export interface SnapshotPrefab {
  /** `file#export` */
  id: string;
  file: string;
  name: string;
  /** Its root is a `Scene`: a level, not something to instantiate. */
  scene: boolean;
  root: SnapshotNode;
  background?: string;
  fog?: { type: 'linear'; color: string; near: number; far: number } | { type: 'exp2'; color: string; density: number };
}

export interface SnapshotGeometry {
  /** The export it was named by (`shapes.tile` → `tile`), else its type and parameters. */
  name: string;
  type: string;
  position: number[];
  normal?: number[];
  uv?: number[];
  index: number[];
  groups: { start: number; count: number; materialIndex: number }[];
}

export interface SnapshotMaterial {
  name: string;
  type: string;
  /** Made once in a module and shared, or written inside one element. */
  shared: boolean;
  source?: string;
  color?: string;
  opacity: number;
  transparent: boolean;
  alphaTest: number;
  /** 0 front, 1 back, 2 double — three's `Side`. */
  side: number;
  depthWrite: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  shininess?: number;
  flatShading?: boolean;
  vertexColors: boolean;
  /** The image's URL, as the page loaded it. */
  map?: string;
}

export interface SnapshotClass {
  file: string;
  /** What a fresh instance holds for each field any element wrote, where it can be written down. */
  defaults: Record<string, SnapshotValue>;
}

export interface Snapshot {
  prefabs: SnapshotPrefab[];
  geometries: Record<string, SnapshotGeometry>;
  materials: Record<string, SnapshotMaterial>;
  classes: Record<string, SnapshotClass>;
  /** What could not be written down, each with where it was declared. */
  warnings: string[];
}

type Module = Record<string, unknown>;

const isClass = (fn: Function) => /^class[\s{]/.test(Function.prototype.toString.call(fn));
const isBehaviourClass = (v: unknown): v is new () => Behaviour => typeof v === 'function' && v.prototype instanceof Behaviour;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const list = (v: { toArray(): number[] }) => v.toArray().map(round);
const hex = (c: Color) => `#${c.getHexString()}`;
const at = (made: object) => {
  const s = sourceOf(made);
  return s ? `${s.fileName}:${s.lineNumber}:${s.columnNumber}` : undefined;
};

/**
 * Build every exported function of every `.tsx` module, and describe what each built. `modules` is
 * the project's modules by path, the game's entry left out: importing it would start the game.
 */
export function snapshot(modules: Record<string, Module>): Snapshot {
  const warnings: string[] = [];
  const prefabIds = new Map<Function, string>();
  const classes: Record<string, SnapshotClass> = {};
  const gameClasses = new Map<Function, string>();
  const names = new Map<object, string>();

  // What the modules export: prefabs and scenes (functions in .tsx), behaviour classes, and the names shared
  // materials and geometries go by.
  for (const [file, mod] of Object.entries(modules)) {
    for (const [name, value] of Object.entries(mod)) {
      if (isBehaviourClass(value)) {
        if (!gameClasses.has(value)) gameClasses.set(value, file);
        classes[value.name] ??= { file, defaults: {} };
      } else if (typeof value === 'function' && file.endsWith('.tsx') && !isClass(value)) {
        // A prefab, or a scene; any other function is a component, copied in where it is used.
        if (isPrefab(value) || (build(value, '', []) as Scene | null)?.isScene) prefabIds.set(value, `${file}#${name}`);
      } else if (value && typeof value === 'object') {
        if (isNamed(value)) names.has(value) || names.set(value, name);
        else if (Object.getPrototypeOf(value) === Object.prototype) {
          for (const [key, inner] of Object.entries(value)) if (isNamed(inner) && !names.has(inner)) names.set(inner, key);
        }
      }
    }
  }

  const geometries: Record<string, SnapshotGeometry> = {};
  const geometryIds = new Map<BufferGeometry, string>();
  const byContent = new Map<string, string>();
  const materials: Record<string, SnapshotMaterial> = {};
  const materialIds = new Map<Material, string>();
  const bySite = new Map<string, string>();

  const geometryId = (g: BufferGeometry): string => {
    const known = geometryIds.get(g);
    if (known) return known;
    const data = describeGeometry(g, names.get(g));
    const key = JSON.stringify([data.position, data.normal, data.uv, data.index, data.groups]);
    let id = byContent.get(key);
    if (!id) {
      id = `g${byContent.size}`;
      byContent.set(key, id);
      geometries[id] = data;
    }
    geometryIds.set(g, id);
    return id;
  };

  const materialId = (m: Material, hint: string): string => {
    const known = materialIds.get(m);
    if (known) return known;
    const source = at(m);
    const data = describeMaterial(m, names.get(m) ?? m.name ?? '', source, warnings);
    if (!data.name) data.name = hint;
    // One element, built twice (a prefab with attributes, inlined twice), is still one declaration.
    const site = source ? `${source}|${JSON.stringify({ ...data, name: '' })}` : undefined;
    let id = site ? bySite.get(site) : undefined;
    if (!id) {
      id = `m${Object.keys(materials).length}`;
      materials[id] = data;
      if (site) bySite.set(site, id);
    }
    materialIds.set(m, id);
    return id;
  };

  const prefabs: SnapshotPrefab[] = [];
  for (const [fn, id] of prefabIds) {
    const [file, name] = id.split('#') as [string, string];
    const built = build(fn, id, warnings);
    if (!built) continue;
    const again = build(fn, id, []);
    if (again && fingerprint(built) !== fingerprint(again)) {
      warnings.push(`${id}: two builds differ — a value in its TSX changes each time (Math.random, a clock). Exported the first; make it a constant, or set it from a behaviour.`);
    }
    const walk = new Walk(built, id, { prefabIds, gameClasses, geometryId, materialId, warnings });
    const prefab: SnapshotPrefab = { id, file, name, scene: (built as Scene).isScene === true, root: walk.root };
    if ((built as Scene).isScene) Object.assign(prefab, sceneSettings(built as Scene, id, warnings));
    prefabs.push(prefab);
  }

  for (const [type, file] of gameClasses) classes[type.name] = { file, defaults: defaultsOf(type as new () => Behaviour, prefabs) };
  return { prefabs, geometries, materials, classes, warnings };
}

function isNamed(value: unknown): value is Material | BufferGeometry {
  return !!value && typeof value === 'object' && ((value as Material).isMaterial === true || (value as BufferGeometry).isBufferGeometry === true);
}

function build(fn: Function, id: string, warnings: string[]): Object3D | null {
  try {
    const made = (fn as (props: object) => unknown)({});
    if (made && typeof made === 'object' && (made as Object3D).isObject3D) return made as Object3D;
    warnings.push(`${id}: returns ${Array.isArray(made) ? 'several elements' : String(made)}, not one node — wrap it in a <Group>.`);
  } catch (error) {
    warnings.push(`${id}: could not be built without attributes — ${(error instanceof Error ? error.message : String(error)).replace(/\.$/, '')}. Where it is used with them, it is copied in.`);
  }
  return null;
}

/** Enough of a build to tell two builds apart: structure, transforms and written values. */
function fingerprint(root: Object3D): string {
  const parts: unknown[] = [];
  root.traverse((n) => {
    parts.push(n.type, n.name, list(n.position), list(n.quaternion), list(n.scale));
    for (const b of behavioursOn(n)) {
      for (const key of writtenOf(b)) {
        const v = (b as unknown as Record<string, unknown>)[key];
        parts.push(key, typeof v === 'object' && v && 'toArray' in v ? list(v as { toArray(): number[] }) : typeof v === 'object' ? null : v);
      }
    }
  });
  return JSON.stringify(parts);
}

interface WalkContext {
  prefabIds: Map<Function, string>;
  gameClasses: Map<Function, string>;
  geometryId: (g: BufferGeometry) => string;
  materialId: (m: Material, hint: string) => string;
  warnings: string[];
}

class Walk {
  readonly root: SnapshotNode;
  private readonly paths = new Map<Object3D, string>();
  private readonly links: { holder: Record<string, SnapshotValue>; key: string; node: Object3D; component?: string; where: string }[] = [];
  private readonly id: string;
  private readonly ctx: WalkContext;
  private readonly warnings: string[];

  constructor(built: Object3D, id: string, ctx: WalkContext) {
    this.id = id;
    this.ctx = ctx;
    this.warnings = ctx.warnings;
    built.updateMatrixWorld(true);
    this.root = this.node(built, '', true);
    for (const link of this.links) {
      const path = this.paths.get(link.node);
      if (path === undefined) {
        this.warnings.push(`${link.where}: ${link.key} points outside ${this.id} — left empty.`);
        link.holder[link.key] = null;
      } else {
        link.holder[link.key] = link.component ? { component: link.component, node: path } : { node: path };
      }
    }
  }

  private node(n: Object3D, path: string, isRoot = false): SnapshotNode {
    this.paths.set(n, path);
    const out: SnapshotNode = {
      name: n.name || n.type,
      kind: n.type,
      position: list(n.position),
      quaternion: list(n.quaternion),
      scale: list(n.scale),
      visible: n.visible,
      castShadow: n.castShadow,
      receiveShadow: n.receiveShadow,
      components: [],
      children: [],
    };
    const source = at(n);
    if (source) out.source = source;

    const made = prefabOf(n);
    const nested = made && !made.given ? this.ctx.prefabIds.get(made.prefab) : undefined;
    if (nested && (!isRoot || nested !== this.id)) {
      // `<ArrowBase />` with nothing written on it is ArrowBase itself: a reference, not a copy.
      out.prefab = nested;
      if (isRoot) out.name = this.id.split('#')[1]!;
      return out;
    }

    this.content(n, out, path || this.id);
    // A path counts the children written down, so it finds the same node in what is built from them.
    for (const child of n.children) {
      if ((n as Light & { target?: Object3D }).target === child) continue;
      const i = out.children.length;
      out.children.push(this.node(child, path ? `${path}/${i}` : `${i}`));
    }
    return out;
  }

  private content(n: Object3D, out: SnapshotNode, where: string): void {
    const any = n as unknown as Record<string, unknown>;
    if (any.isInstancedMesh || any.isSkinnedMesh || any.isPoints || any.isLine || any.isSprite) {
      this.warnings.push(`${out.source ?? where}: a ${n.type} is not exported — only Mesh, lights, cameras and groups are. Kept as an empty node.`);
    } else if (any.isMesh) {
      const mesh = n as Object3D & { geometry: BufferGeometry; material: Material | Material[] };
      if (mesh.geometry.getAttribute('position')?.count) out.geometry = this.ctx.geometryId(mesh.geometry);
      const hint = `${this.id.split('#')[1]}_${out.name}`;
      out.materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => this.ctx.materialId(m, hint));
    }
    if (any.isLight) out.light = this.light(n as Light);
    if (any.isCamera) out.camera = camera(n as Camera);

    for (const b of behavioursOn(n)) {
      const fields: Record<string, SnapshotValue> = {};
      const refs = b._refs;
      for (const key of writtenOf(b)) {
        const ref = refs?.get(key);
        const value = ref ? ref.current : (b as unknown as Record<string, unknown>)[key];
        const encoded = this.value(value, fields, key, `${at(b) ?? where} <${b.constructor.name} ${key}>`);
        if (encoded !== undefined) fields[key] = encoded;
      }
      const component: SnapshotComponent = { type: b.constructor.name, game: this.ctx.gameClasses.has(b.constructor), fields };
      const source = at(b);
      if (source) component.source = source;
      out.components.push(component);
    }
  }

  /** One field's value as data; `undefined` when it cannot be, with a warning that says so. */
  private value(v: unknown, holder: Record<string, SnapshotValue>, key: string, where: string): SnapshotValue | undefined {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'function') {
      const id = this.ctx.prefabIds.get(v);
      if (id) return { prefab: id };
      this.warnings.push(`${where}: a function that is not an exported prefab — not exported.`);
      return undefined;
    }
    if (Array.isArray(v)) {
      // Items are their own holders: a node in a list is resolved into its slot once the walk is done.
      const array: SnapshotValue[] = [];
      v.forEach((item, i) => {
        const encoded = this.value(item, array as unknown as Record<string, SnapshotValue>, String(array.length), `${where}[${i}]`);
        if (encoded !== undefined) array.push(encoded);
      });
      return { array };
    }
    const o = v as Record<string, unknown>;
    if (o.isVector2) return { v2: list(v as Vector3) };
    if (o.isVector3) return { v3: list(v as Vector3) };
    if (o.isVector4) return { v4: list(v as Vector3) };
    if (o.isQuaternion) return { quat: list(v as Quaternion) };
    if (o.isEuler) return { quat: list(new Quaternion().setFromEuler(v as never)) };
    if (o.isColor) return { color: hex(v as Color) };
    if (o.isMaterial) return { material: this.ctx.materialId(v as Material, key) };
    if (o.isBufferGeometry) return { geometry: this.ctx.geometryId(v as BufferGeometry) };
    if (o.isObject3D) {
      this.links.push({ holder, key, node: v as Object3D, where });
      return null;
    }
    if (v instanceof Behaviour) {
      this.links.push({ holder, key, node: v.node, component: v.constructor.name, where });
      return null;
    }
    const plain = plainFields(o);
    if (plain) return { object: { type: (o.constructor as Function).name, fields: plain } };
    this.warnings.push(`${where}: a ${(o.constructor as Function | undefined)?.name ?? 'value'} is not exported — numbers, strings, vectors, colours, nodes, prefabs, materials, settings objects and lists of them are.`);
    return undefined;
  }

  private light(l: Light): SnapshotLight {
    const any = l as unknown as Record<string, unknown>;
    const out: SnapshotLight = { type: l.type, color: hex(l.color), intensity: l.intensity, castShadow: l.castShadow };
    const target = any.target as Object3D | undefined;
    if (target && (any.isDirectionalLight || any.isSpotLight)) {
      target.updateMatrixWorld();
      const from = l.getWorldPosition(new Vector3());
      const to = target.getWorldPosition(new Vector3());
      const direction = to.sub(from).normalize();
      if (l.parent) direction.applyQuaternion(l.parent.getWorldQuaternion(new Quaternion()).invert());
      out.direction = list(direction);
    }
    for (const key of ['distance', 'decay', 'angle', 'penumbra'] as const) if (typeof any[key] === 'number') out[key] = any[key] as number;
    if ((any.groundColor as Color | undefined)?.isColor) out.groundColor = hex(any.groundColor as Color);
    if (any.isRectAreaLight) this.warnings.push(`${at(l) ?? this.id}: a RectAreaLight is exported as its type only.`);
    return out;
  }
}

function camera(c: Camera): SnapshotCamera {
  const any = c as unknown as Record<string, number>;
  const out: SnapshotCamera = { type: c.type, near: any.near!, far: any.far!, zoom: any.zoom ?? 1 };
  for (const key of ['fov', 'left', 'right', 'top', 'bottom'] as const) if (typeof any[key] === 'number') out[key] = any[key];
  return out;
}

function sceneSettings(scene: Scene, id: string, warnings: string[]): Pick<SnapshotPrefab, 'background' | 'fog'> {
  const out: Pick<SnapshotPrefab, 'background' | 'fog'> = {};
  if ((scene.background as Color | null)?.isColor) out.background = hex(scene.background as Color);
  else if (scene.background) warnings.push(`${id}: a background that is not a colour is not exported.`);
  const fog = scene.fog as (Fog & FogExp2) | null;
  if (fog) {
    out.fog = (fog as unknown as { isFogExp2?: boolean }).isFogExp2
      ? { type: 'exp2', color: hex(fog.color), density: fog.density }
      : { type: 'linear', color: hex(fog.color), near: fog.near, far: fog.far };
  }
  if (scene.environment) warnings.push(`${id}: an environment map is not exported.`);
  return out;
}

function attribute(a: BufferAttribute | undefined): number[] | undefined {
  if (!a) return undefined;
  const out: number[] = [];
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out.push(round(get[c]!.call(a, i)));
  return out;
}

function describeGeometry(g: BufferGeometry, name: string | undefined): SnapshotGeometry {
  const position = attribute(g.getAttribute('position') as BufferAttribute)!;
  const index = g.index ? Array.from({ length: g.index.count }, (_, i) => g.index!.getX(i)) : Array.from({ length: position.length / 3 }, (_, i) => i);
  const params = (g as BufferGeometry & { parameters?: Record<string, unknown> }).parameters;
  const spelled = params ? Object.values(params).filter((v) => typeof v === 'number').map((v) => round(v as number)).join('x') : '';
  const out: SnapshotGeometry = {
    name: name ?? `${g.type.replace(/Geometry$/, '')}${spelled ? `_${spelled}` : ''}`,
    type: g.type,
    position,
    index,
    groups: g.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex: materialIndex ?? 0 })),
  };
  const normal = attribute(g.getAttribute('normal') as BufferAttribute);
  const uv = attribute(g.getAttribute('uv') as BufferAttribute);
  if (normal) out.normal = normal;
  if (uv) out.uv = uv;
  return out;
}

function describeMaterial(m: Material, name: string, source: string | undefined, warnings: string[]): SnapshotMaterial {
  const any = m as unknown as Record<string, unknown>;
  const out: SnapshotMaterial = {
    name,
    type: m.type,
    shared: !source,
    opacity: m.opacity,
    transparent: m.transparent,
    alphaTest: m.alphaTest,
    side: m.side,
    depthWrite: m.depthWrite,
    vertexColors: m.vertexColors,
  };
  if (source) out.source = source;
  if ((any.color as Color | undefined)?.isColor) out.color = hex(any.color as Color);
  if ((any.emissive as Color | undefined)?.isColor) {
    out.emissive = hex(any.emissive as Color);
    out.emissiveIntensity = any.emissiveIntensity as number;
  }
  for (const key of ['roughness', 'metalness', 'shininess', 'flatShading'] as const) if (any[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = any[key];
  const map = any.map as Texture | null | undefined;
  if (map) {
    const image = map.image as { src?: string; currentSrc?: string } | undefined;
    const src = image?.currentSrc || image?.src;
    if (src) out.map = src;
    else warnings.push(`${source ?? name}: a texture with no image URL (made in code) is not exported.`);
  }
  if (any.isShaderMaterial) warnings.push(`${source ?? name}: a ${m.type} is exported as a plain lit material — its shader is not.`);
  return out;
}

/** A fresh instance's value for every field some element wrote, so a port starts from the same defaults. */
function defaultsOf(type: new () => Behaviour, prefabs: SnapshotPrefab[]): Record<string, SnapshotValue> {
  const written = new Set<string>();
  const visit = (n: SnapshotNode) => {
    for (const c of n.components) if (c.type === type.name) Object.keys(c.fields).forEach((k) => written.add(k));
    n.children.forEach(visit);
  };
  prefabs.forEach((p) => visit(p.root));
  const out: Record<string, SnapshotValue> = {};
  let fresh: Record<string, unknown>;
  try {
    fresh = new type() as unknown as Record<string, unknown>;
  } catch {
    return out;
  }
  for (const key of written) {
    const v = plain(fresh[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** A default as data: what needs no prefab around it — numbers, strings, vectors, colours and lists of them. */
function plain(v: unknown): SnapshotValue | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const items = v.map(plain);
    return items.includes(undefined) ? undefined : { array: items as SnapshotValue[] };
  }
  const o = v as Record<string, unknown>;
  if (o.isVector2) return { v2: list(v as Vector3) };
  if (o.isVector3) return { v3: list(v as Vector3) };
  if (o.isColor) return { color: hex(v as Color) };
  return undefined;
}

/** An object's own values, when every one is a number, a boolean or a string — a settings object; else null. */
function plainFields(o: Record<string, unknown>): Record<string, number | boolean | string> | null {
  const entries = Object.entries(o).filter(([key]) => !key.startsWith('_'));
  if (entries.length === 0 || !entries.every(([, v]) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) return null;
  return Object.fromEntries(entries) as Record<string, number | boolean | string>;
}
