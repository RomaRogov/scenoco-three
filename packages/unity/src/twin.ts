/**
 * The game's prefabs and scenes as Scenoco's text (`com.roro.scenoco`): a `.uprefab` beside each
 * `.prefab` and a `.uscene` beside each `.unity`, which Unity builds into them — XAML-style, in Unity's
 * own C# vocabulary. An attribute is what a script would assign: a Unity property set through its
 * setter, a script's serialized field by its name. A reference is `#Name` (or `#id`), an asset its path.
 *
 * What the text names but cannot hold — a mesh, a material, a physics material, a URP Volume's profile,
 * UI Toolkit's panel settings, a terrain's data — is an asset the importer makes first (`TwinAssets`).
 * One wrong name makes Scenoco refuse a whole file, so a field is written only where its class declares
 * it; anything else is a warning, as before.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { UnityComponent, UnityExport, UnityNode, UnityTerrain, UnityValue } from './convert.js';

/** Assets the twins name, which the importer makes before Scenoco builds the twins. */
export interface TwinAssets {
  /** Unity's PhysicsMaterial (3D) or PhysicsMaterial2D for a collider's friction and bounciness. */
  physicsMaterials: { path: string; dimensions: 2 | 3; friction: number; bounciness: number }[];
  /** One particle material per blending, `Assets/Materials/Particles-<blending>.mat`. */
  particleMaterials: ('Additive' | 'Alpha')[];
  /** A URP Volume's profile and the effects in it, by the component types SceNoCo names them by. */
  volumes: { path: string; effects: { type: string; fields: Record<string, UnityValue> }[] }[];
  /** UI Toolkit's panel settings, one per UIDocument element, scaling as core's UIDocument does. */
  panels: { path: string; referenceResolution: number[]; match: number; sortingOrder: number }[];
  /** URP's terrain material, which a Terrain needs or draws pink. */
  terrainMaterial?: string;
}

export interface TwinOptions {
  /** The page's UXML by the element a UIDocument names, in the page's order. */
  documents?: Record<string, string>;
  /** Whether a game behaviour's C# class declares a serialized field of that name. */
  declares?: (type: string, field: string) => boolean;
  /** The first scene gets the UI's EventSystem, kept across scenes (needs com.unity.ugui). */
  eventSystem?: boolean;
}

export interface Twins {
  /** Text by the twin's path in the Unity project: `Assets/Prefabs/Crate.uprefab`. */
  files: Map<string, string>;
  assets: TwinAssets;
  warnings: string[];
}

/** A twin's path: the asset's, with `.prefab` → `.uprefab` and `.unity` → `.uscene`. */
export const twinPath = (asset: string) => asset.replace(/\.prefab$/, '.uprefab').replace(/\.unity$/, '.uscene');

export function twins(data: UnityExport, options: TwinOptions = {}): Twins {
  const assets: TwinAssets = { physicsMaterials: [], particleMaterials: [], volumes: [], panels: [] };
  const warnings: string[] = [];
  const files = new Map<string, string>();
  const terrains = new Map(data.terrains.map((t) => [t.path, t]));
  const volumes = hasVolume(data);
  const prefabs = new Map(data.prefabs.map((p) => [p.path, p.root]));
  const writer = (holder: string, roots: UnityNode[]) => new Writer(roots, holder, assets, warnings, options, terrains, volumes, prefabs);

  for (const p of data.prefabs) {
    // A prefab's root is named after its asset, as Unity names it when it saves one.
    const node = { ...p.root, name: p.path.replace(/^.*\/|\.prefab$/g, '') };
    const w = writer(p.path, [node]);
    const root = w.object(node, 'Prefab', '');
    w.finish();
    files.set(twinPath(p.path), print(root));
  }
  data.scenes.forEach((s, i) => {
    const w = writer(s.path, s.roots);
    const scene = new El('Scene').set('name', s.path.replace(/^.*\/|\.unity$/g, ''));
    let mainCamera = false;
    s.roots.forEach((r, n) => {
      const e = w.object(r, r.prefab ? 'PrefabInstance' : 'GameObject', String(n), { background: s.background });
      // The first camera is the main one: Camera.main finds it by this tag. It hears the game too, as a
      // new scene's Main Camera does — the page needs no listener, Unity plays nothing without one.
      if (!mainCamera) mainCamera = w.tagMainCamera(e);
      scene.add(e);
    });
    if (!mainCamera) warnings.push(`${s.path}: no camera in the scene.`);
    // UI input in every scene with a page, so a level played on its own takes taps; KeepAcrossScenes keeps
    // the first one loaded and drops the next scene's.
    const page = (n: UnityNode): boolean => n.components.some((c) => c.type === 'UIDocument') || n.children.some(page);
    if (options.eventSystem && (i === 0 || s.roots.some(page))) {
      scene.add(new El('GameObject').set('name', 'Input').add(new El('EventSystem'), new El('InputSystemUIInputModule'), new El('KeepAcrossScenes')));
    }
    w.finish();
    files.set(twinPath(s.path), print(scene));
  });
  return { files, assets, warnings };
}

function hasVolume(data: UnityExport): boolean {
  const visit = (n: UnityNode): boolean => n.components.some((c) => c.type === 'Volume') || n.children.some(visit);
  return data.prefabs.some((p) => visit(p.root)) || data.scenes.some((s) => s.roots.some(visit));
}

// --- one file ----------------------------------------------------------------------------------

class Writer {
  /** `#Name` where a name is the file's only one, else `#id` given to the element. */
  private readonly refs = new Map<UnityNode, string>();
  private readonly elements = new Map<UnityNode, El>();
  /** Colliders a MeshCollider above gives a node's mesh objects: a path inside a placed model, or [] for its own mesh. */
  private readonly meshColliders = new Map<UnityNode, { path: string[]; collider: El; layer?: number }[]>();
  private readonly names = new Map<string, number>();
  private readonly ids = new Set<string>();
  private readonly idsByNode = new Map<UnityNode, string>();
  private readonly roots: UnityNode[];
  private readonly holder: string;
  private readonly assets: TwinAssets;
  private readonly warnings: string[];
  private readonly options: TwinOptions;
  private readonly terrains: Map<string, UnityTerrain>;
  private readonly volumes: boolean;
  /** Each prefab's root by its asset path: what a placement is compared with. */
  private readonly prefabs: Map<string, UnityNode>;
  /** While comparing a copy with its prefab: the copy's path, which references are made relative to. */
  private comparing: string | null = null;
  /** Each node's parent in this file, for where one stands in another's space (a spline's knot nodes). */
  private readonly parents = new Map<UnityNode, UnityNode>();

  constructor(roots: UnityNode[], holder: string, assets: TwinAssets, warnings: string[], options: TwinOptions, terrains: Map<string, UnityTerrain>, volumes: boolean, prefabs: Map<string, UnityNode>) {
    this.prefabs = prefabs;
    this.roots = roots;
    this.holder = holder;
    this.assets = assets;
    this.warnings = warnings;
    this.options = options;
    this.terrains = terrains;
    this.volumes = volumes;
    const count = (n: UnityNode) => {
      this.names.set(n.name, (this.names.get(n.name) ?? 0) + 1);
      // What a placed prefab holds is the prefab's: it is no element of this file.
      if (!n.prefab) n.children.forEach((child) => (this.parents.set(child, n), count(child)));
    };
    roots.forEach(count);
  }

  /** A node, its components and its children; `path` is its place as references give it (child indices). */
  object(n: UnityNode, tag: 'Prefab' | 'GameObject' | 'PrefabInstance', path: string, scene: { background?: string } = {}, hidden = false): El {
    const e = new El(tag);
    this.elements.set(n, e);
    // A placed prefab (or a prefab whose root is one, a variant) writes only how it differs from that prefab.
    const base = n.prefab ? this.prefabs.get(n.prefab) : undefined;
    if (tag === 'PrefabInstance') e.set('prefab', n.prefab!);
    // A model file is a prefab too: one whose root is a placed model is its variant.
    else if (n.prefab) e.set('base', n.prefab);
    e.set('name', n.name);
    if (base) {
      const transform = this.transform(n, base);
      if (transform.attrs.length) e.add(transform);
      if (n.given) this.overrides(n, base, e, path, path, scene, hidden);
      return e;
    }
    if (n.layer) e.set('layer', String(n.layer));
    if (!n.active) e.set('m_IsActive', 'false');
    // Hidden in three while a behaviour on it runs: its renderers off, the object active.
    const off = hidden || !n.renderersEnabled;
    const transform = this.transform(n);
    if (transform.attrs.length) e.add(transform);
    e.add(...this.own(n, off, scene));
    n.children.forEach((child, i) => e.add(this.object(child, child.prefab ? 'PrefabInstance' : 'GameObject', path === '' ? String(i) : `${path}/${i}`, scene, off)));
    this.writeMeshColliders(n, e);
    return e;
  }

  /** The MeshColliders given to this node's mesh objects: on its own mesh, or on a placed model's, as overrides of its children. */
  private writeMeshColliders(n: UnityNode, e: El) {
    for (const { path, collider, layer } of this.meshColliders.get(n) ?? []) {
      let at = e;
      for (const name of path) {
        let child = at.children.find((c) => c.tag === 'GameObject' && c.get('name') === name);
        if (!child) at.add((child = new El('GameObject').set('name', name)));
        at = child;
      }
      if (layer && path.length) at.set('layer', String(layer));
      at.add(collider);
    }
  }

  /**
   * The physics package's MeshCollider as Unity's, which takes the mesh of its own object: one on every
   * mesh under the node, as SceNoCo's gathers them — a placed model's on its own objects, under the
   * scale that unpacks a compressed glTF. A Rigidbody above takes them all, as it takes child colliders.
   */
  private meshCollider(c: UnityComponent, n: UnityNode, where: string) {
    const collider = this.physics(c, where);
    let found = 0;
    const add = (node: UnityNode, path: string[]) => {
      const list = this.meshColliders.get(node) ?? [];
      list.push({ path, collider: copy(collider), layer: n.layer });
      this.meshColliders.set(node, list);
      found++;
    };
    const visit = (node: UnityNode) => {
      if (node.mesh) add(node, []);
      for (const path of node.meshNodes ?? []) add(node, path);
      // A game prefab placed under it brings colliders of its own.
      if (!node.prefab || node.meshNodes) node.children.forEach(visit);
    };
    visit(n);
    if (!found) this.warn(where, 'MeshCollider: no mesh under it — left off.');
  }

  /** A node's Transform: each value that differs from `from`'s (a prefab's), or from a new object's. */
  private transform(n: UnityNode, from?: UnityNode): El {
    const t = new El('Transform');
    const differs = (a: number[], b: number[] | undefined, fresh: number) => (b ? vec(a) !== vec(b) : a.some((v) => v !== fresh));
    if (differs(n.position, from?.position, 0)) t.set('localPosition', vec(n.position));
    const euler = eulerAngles(n.rotation);
    if (differs(euler, from && eulerAngles(from.rotation), 0)) t.set('localEulerAngles', vec(euler));
    if (differs(n.scale, from?.scale, 1)) t.set('localScale', vec(n.scale));
    return t;
  }

  /** What a node's object holds besides its Transform and children: renderer, light, camera, components. */
  private own(n: UnityNode, off: boolean, scene: { background?: string }): El[] {
    const e = new El('own');
    if (n.mesh || n.materials) {
      const filter = new El('MeshFilter');
      if (n.mesh) filter.set('sharedMesh', n.mesh);
      e.add(filter);
      const renderer = new El('MeshRenderer');
      const materials = n.materials ?? [];
      if (materials.length === 1) renderer.set('sharedMaterial', materials[0]!);
      else if (materials.length > 1) renderer.set('sharedMaterials', list(materials));
      if (n.castShadows === false) renderer.set('shadowCastingMode', 'Off');
      if (n.receiveShadows === false) renderer.set('receiveShadows', 'false');
      if (off) renderer.set('enabled', 'false');
      e.add(renderer);
    }
    if (n.light) {
      const l = n.light;
      const light = new El('Light').set('type', l.type).set('color', l.color).set('intensity', num(l.intensity));
      if (l.shadows) light.set('shadows', 'Soft');
      if (l.range !== undefined) light.set('range', num(l.range));
      if (l.spotAngle !== undefined) light.set('spotAngle', num(l.spotAngle));
      if (l.innerSpotAngle !== undefined) light.set('innerSpotAngle', num(l.innerSpotAngle));
      e.add(light);
    }
    if (n.camera) {
      const c = n.camera;
      const camera = new El('Camera');
      if (c.orthographic) camera.set('orthographic', 'true');
      camera.set('nearClipPlane', num(c.near)).set('farClipPlane', num(c.far));
      if (c.orthographic) camera.set('orthographicSize', num(c.size ?? 5));
      else camera.set('fieldOfView', num(c.fov ?? 60));
      if (scene.background) camera.set('clearFlags', 'SolidColor').set('backgroundColor', scene.background);
      e.add(camera);
      // Post Processing on for every camera of a game with a Volume: one kept across loads shapes every level.
      if (this.volumes) e.add(new El('UniversalAdditionalCameraData').set('renderPostProcessing', 'true'));
    }
    for (const c of n.components) this.component(c, n, e, off);
    return e.children;
  }

  /**
   * How a copy differs from its prefab, as Unity's overrides on a placement: values of the object and of
   * each component (the n-th of its type), components and children it adds, and the ones it lacks. A child
   * is the prefab's child of its name. A reference inside the copy is the same as the prefab's when it
   * points at the same place in each.
   */
  private overrides(i: UnityNode, p: UnityNode, e: El, path: string, root: string, scene: { background?: string }, hidden: boolean) {
    if ((i.layer ?? 0) !== (p.layer ?? 0)) e.set('layer', String(i.layer ?? 0));
    if (i.active !== p.active) e.set('m_IsActive', String(i.active));
    const off = hidden || !i.renderersEnabled;
    const mine = this.compared(root, () => this.own(i, off, scene));
    const theirs = this.compared('', () => this.own(p, !p.renderersEnabled, {}));
    // Written as this file writes them; what it can't say here is said only for a value that differs.
    const warned = this.warnings.length;
    const written = this.own(i, off, scene);
    this.warnings.length = warned;
    const removed: El[] = [];
    const nth = (list: El[], at: number) => list.slice(0, at).filter((x) => x.tag === list[at]!.tag).length;
    const used = new Set<number>();
    mine.forEach((m, k) => {
      const at = theirs.findIndex((t, x) => !used.has(x) && t.tag === m.tag && nth(theirs, x) === nth(mine, k));
      if (at < 0) return void e.add(written[k]!);                                  // a component the prefab lacks
      used.add(at);
      const t = theirs[at]!;
      const diff = new El(m.tag);
      for (const [key, value] of m.attrs) {
        if (t.get(key) === value) continue;
        const text = written[k]!.get(key);
        if (text !== undefined) diff.set(key, text);
        else this.warn(i.source ?? `${this.holder} ${i.name}`, `${m.tag}.${key} on this copy points inside a placed prefab — set it in the prefab.`);
      }
      for (const [key] of t.attrs) if (m.get(key) === undefined) this.warn(i.source ?? `${this.holder} ${i.name}`, `${m.tag}.${key} is the prefab's own on this copy only by default — not written.`);
      m.children.forEach((c, x) => {
        if (print(c) !== (t.children.find((y) => y.tag === c.tag) ? print(t.children.find((y) => y.tag === c.tag)!) : '')) diff.add(written[k]!.children[x]!);
      });
      if (diff.attrs.length || diff.children.length) e.add(diff);
    });
    theirs.forEach((t, x) => void (!used.has(x) && t.tag !== 'GameObject' && removed.push(new El(t.tag))));
    if (removed.length) e.add(new El(`${e.tag}.removedComponents`).add(...removed));

    const named = (list: UnityNode[], name: string) => list.filter((c) => c.name === name);
    const gone: El[] = [];
    i.children.forEach((child, x) => {
      const at = path === '' ? String(x) : `${path}/${x}`;
      const same = named(p.children, child.name);
      if (same.length === 0) return void e.add(this.object(child, child.prefab ? 'PrefabInstance' : 'GameObject', at, scene, off));
      const counterpart = same[named(i.children, child.name).indexOf(child)];
      if (!counterpart) return;
      const el = new El('GameObject').set('name', child.name);
      const transform = this.transform(child, counterpart);
      if (transform.attrs.length) el.add(transform);
      this.overrides(child, counterpart, el, at, root, scene, off);
      if (el.attrs.length + el.children.length === 1) return;
      if (same.length > 1) return this.warn(child.source ?? `${this.holder} ${child.name}`, `this copy changes ${p.name}'s child "${child.name}", one of ${same.length} of that name — an override can't tell them apart: name them.`);
      e.add(el);
    });
    for (const name of new Set(p.children.map((c) => c.name)))
      for (let k = named(i.children, name).length; k < named(p.children, name).length; k++) gone.push(new El('GameObject').set('name', name));
    if (gone.length) e.add(new El(`${e.tag}.removedGameObjects`).add(...gone));
  }

  /** Elements written for comparing: references relative to `root`, and nothing else recorded. */
  private compared(root: string, write: () => El[]): El[] {
    const warned = this.warnings.length;
    const assets = { ...this.assets, volumes: [...this.assets.volumes] };
    this.comparing = root;
    try {
      return write();
    } finally {
      this.comparing = null;
      this.warnings.length = warned;
      this.assets.volumes = assets.volumes;
    }
  }

  /** Tag the first camera under `e` MainCamera; false when it has none. */
  tagMainCamera(e: El): boolean {
    if (e.children.some((c) => c.tag === 'Camera')) {
      e.attrs.splice(e.attrs.findIndex(([k]) => k === 'name') + 1, 0, ['tag', 'MainCamera']);
      if (!e.children.some((c) => c.tag === 'AudioListener')) e.children.splice(e.children.findIndex((c) => c.tag === 'Camera') + 1, 0, new El('AudioListener'));
      return true;
    }
    return e.children.some((c) => (c.tag === 'GameObject' ? this.tagMainCamera(c) : false));
  }

  private warn(where: string, what: string) {
    this.warnings.push(`${where}: ${what}`);
  }

  private where(c: UnityComponent, n: UnityNode) {
    return c.source ?? n.source ?? `${this.holder} ${n.name}`;
  }

  // --- components --------------------------------------------------------------------------------

  private component(c: UnityComponent, n: UnityNode, e: El, off: boolean) {
    const where = this.where(c, n);
    if (c.game) return void e.add(this.behaviour(c, where));
    if (c.type === 'MeshCollider') return this.meshCollider(c, n, where);
    if (c.type in PHYSICS) return void e.add(this.physics(c, where));
    switch (c.type) {
      case 'ParticleSystem':
        return this.particles(c, e, off, where);
      case 'UIDocument':
        return this.document(c, n, e, where);
      case 'Terrain':
      case 'TerrainCollider':
        return this.terrain(c, e, where);
      case 'Volume':
        return this.volume(n, e);
      case 'AudioSource':
        return void e.add(this.audioSource(c, where));
      case 'SplineContainer':
        return this.splineContainer(c, n, e, where);
      case 'SplineInstantiate':
        return void e.add(this.splineInstantiate(c, where));
      case 'SplineExtrude':
        return void e.add(this.splineExtrude(c, n, where));
      case 'SplineMesh':
        return void e.add(this.splineMesh(c, where));
      case 'SplineAnimate':
        return void e.add(this.splineAnimate(c, where));
    }
    if (EFFECTS.has(c.type)) return; // in its Volume's profile
    this.warn(where, `${c.type} has no Unity counterpart here — left off.`);
  }

  // --- audio and splines: the packages' components are Unity's own, by the same names -------------

  /** The audio package's AudioSource as Unity's: the same names, `spatial` as Unity's spatial blend. */
  private audioSource(c: UnityComponent, where: string): El {
    const e = new El('AudioSource');
    const f = c.fields;
    if (f.clip && typeof f.clip === 'object' && 'asset' in f.clip) e.set('clip', f.clip.asset);
    for (const key of ['playOnAwake', 'loop', 'volume', 'pitch', 'minDistance', 'maxDistance'] as const) {
      const v = f[key];
      if (typeof v === 'number' || typeof v === 'boolean') e.set(key, String(v));
    }
    if (typeof f.spatial === 'boolean') e.set('spatialBlend', f.spatial ? '1' : '0');
    const known = new Set(['clip', 'playOnAwake', 'loop', 'volume', 'pitch', 'spatial', 'minDistance', 'maxDistance']);
    const unknown = Object.keys(f).filter((k) => !known.has(k) && f[k] !== null);
    if (unknown.length) this.warn(where, `AudioSource: ${unknown.join(', ')} ${unknown.length > 1 ? 'have' : 'has'} no Unity counterpart — left out.`);
    return e;
  }

  /**
   * The splines package's knots as Unity's spline: each knot with the tangents SceNoCo gives it — its own,
   * or made smooth from its neighbours as Unity's AutoSmooth does — mirrored as positions, and kept as
   * written (Unity's Broken mode), so both engines draw the same curve.
   */
  private splineContainer(c: UnityComponent, n: UnityNode, holder: El, where: string): void {
    const e = new El('SplineContainer');
    holder.add(e);
    let knots = c.fields.knots;
    if (knots && typeof knots === 'object' && 'node' in knots) {
      // Knots that are nodes: the spline as they stand now, and SplineKnotNodes to follow them as they move.
      const parent = this.nodeAt(knots.node);
      const ref = this.ref(knots.node, where);
      if (!parent || !ref) return;
      holder.add(new El('SplineKnotNodes').set('knots', ref));
      const into = this.world(n).invert();
      knots = { array: parent.children.map((k) => ({ v3: new Vector3().setFromMatrixPosition(into.clone().multiply(this.world(k))).toArray() })) };
    }
    if (!knots || typeof knots !== 'object' || !('array' in knots)) return;
    type K = { position: number[]; tangentIn?: number[]; tangentOut?: number[]; roll?: number };
    const triple = (v: UnityValue | undefined): number[] | undefined =>
      v && typeof v === 'object' && 'array' in v && v.array.length === 3 && v.array.every((x) => typeof x === 'number') ? (v.array as number[]) : v && typeof v === 'object' && 'v3' in v ? flipBack(v.v3) : undefined;
    const read: K[] = [];
    for (const k of knots.array) {
      const position = triple(k);
      if (position) read.push({ position });
      else if (k && typeof k === 'object' && 'object' in k) {
        const f = k.object.fields;
        const p = triple(f.position);
        if (p) read.push({ position: p, tangentIn: triple(f.tangentIn), tangentOut: triple(f.tangentOut), roll: typeof f.roll === 'number' ? f.roll : undefined });
      }
    }
    if (read.length !== knots.array.length) this.warn(where, 'SplineContainer: a knot that is neither a position nor knot fields — left out.');
    const closed = c.fields.closed === true;
    const count = read.length;
    const at = (i: number) => read[closed ? (i + count) % count : Math.min(Math.max(i, 0), count - 1)]!.position;
    const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
    const len = (a: number[]) => Math.hypot(...a);
    // SceNoCo's AutoSmooth: along the line from the knot before to the one after, a third of the way to each.
    const smooth = (i: number, side: 'in' | 'out'): number[] => {
      if (!closed && (side === 'in' ? i === 0 : i === count - 1)) return [0, 0, 0];
      const d = sub(at(i + 1), at(i - 1));
      const l = len(d) || 1;
      const reach = side === 'out' ? len(sub(at(i + 1), at(i))) / 3 : -len(sub(at(i), at(i - 1))) / 3;
      return d.map((x) => (x / l) * reach);
    };
    const neg = (a: number[]) => a.map((x) => -x);
    const float3 = (tag: string, [x, y, z]: number[]) => new El(`BezierKnot.${tag}`).add(new El('float3').set('x', num(x!)).set('y', num(y!)).set('z', num(z!)));
    const list = new El('Spline.m_Knots');
    // A roll banks the knot: Unity keeps it in the knot's Rotation, its tangents in the knot's own space.
    const rolled = read.some((k) => k.roll);
    read.forEach((k, i) => {
      let out = mirror(k.tangentOut ?? (k.tangentIn ? neg(k.tangentIn) : smooth(i, 'out')));
      let tin = mirror(k.tangentIn ?? (k.tangentOut ? neg(k.tangentOut) : smooth(i, 'in')));
      const knot = new El('BezierKnot').add(float3('Position', mirror(k.position)));
      if (rolled) {
        const rotation = knotRotation(out, tin, k.roll ?? 0);
        const inverse = rotation.clone().invert();
        const local = (t: number[]) => new Vector3(...t).applyQuaternion(inverse).toArray() as number[];
        [out, tin] = [local(out), local(tin)];
        knot.add(new El('BezierKnot.Rotation').add(new El('quaternion').add(new El('quaternion.value').add(new El('float4').set('x', num(rotation.x)).set('y', num(rotation.y)).set('z', num(rotation.z)).set('w', num(rotation.w))))));
      }
      list.add(knot.add(float3('TangentIn', tin), float3('TangentOut', out)));
    });
    e.add(new El('SplineContainer.m_Splines').add(new El('Spline').set('m_Closed', String(closed)).add(list)));
  }

  /** The node at a path of child indices in this file, as `ref` finds it. */
  private nodeAt(path: string): UnityNode | undefined {
    const steps = path === '' ? [] : path.split('/').map(Number);
    let node: UnityNode | undefined = this.roots.length === 1 && this.holder.endsWith('.prefab') ? this.roots[0] : undefined;
    if (!node) node = this.roots[steps.shift() ?? -1];
    for (const i of steps) node = node?.prefab ? undefined : node?.children[i];
    return node;
  }

  /** A node's place in this file's space, in Unity's coordinates. */
  private world(n: UnityNode): Matrix4 {
    const own = new Matrix4().compose(new Vector3(...n.position), new Quaternion(...n.rotation), new Vector3(...n.scale));
    const parent = this.parents.get(n);
    return parent ? this.world(parent).multiply(own) : own;
  }

  /**
   * The splines package's SplineInstantiate as Unity's: one item every `spacing`, offset in the spline's
   * frame. Unity picks among several items by chance where SceNoCo takes turns, and places its copies itself.
   */
  private splineInstantiate(c: UnityComponent, where: string): El {
    const e = new El('SplineInstantiate');
    const f = c.fields;
    if (f.container && typeof f.container === 'object' && 'node' in f.container) {
      const ref = this.ref((f.container as { node: string }).node, where);
      if (ref) e.set('m_Container', ref);
    }
    const items = f.itemsToInstantiate && typeof f.itemsToInstantiate === 'object' && 'array' in f.itemsToInstantiate ? f.itemsToInstantiate.array : [];
    if (items.length > 1) this.warn(where, 'SplineInstantiate: Unity picks among several items by chance; SceNoCo takes turns.');
    const list = new El('SplineInstantiate.m_ItemsToInstantiate');
    for (const item of items) if (item && typeof item === 'object' && 'asset' in item) list.add(new El('InstantiableItem').set('Prefab', item.asset).set('Probability', '100'));
    e.add(list);
    const method = f.method === 'instanceCount' ? 'InstanceCount' : 'SpacingDistance';
    e.set('m_Method', method);
    if (method === 'InstanceCount' && typeof f.instanceCount === 'number') e.set('m_Spacing', vec([f.instanceCount, f.instanceCount]));
    else e.set('m_Spacing', vec([typeof f.spacing === 'number' ? f.spacing : 2, typeof f.spacing === 'number' ? f.spacing : 2]));
    e.set('m_Space', f.alignTo === 'world' ? 'World' : 'Spline');
    // In the spline's frame — right, up, along — which mirrors with the world: the numbers stay as written.
    const offset = f.positionOffset && typeof f.positionOffset === 'object' && 'v3' in f.positionOffset ? flipBack(f.positionOffset.v3) : undefined;
    if (offset && offset.some((x) => x !== 0)) e.add(new El('SplineInstantiate.m_PositionOffset').add(new El('Vector3Offset').set('setup', 'HasOffset').set('min', vec(offset)).set('max', vec(offset))));
    if (f.rotationOffset && typeof f.rotationOffset === 'object' && 'quat' in f.rotationOffset && f.rotationOffset.quat.slice(0, 3).some((x) => x !== 0)) this.warn(where, 'SplineInstantiate: rotationOffset is not exported — set it in Unity.');
    // The same copies on every load: Unity seeds its choices, and picks a random seed of its own for 0.
    e.set('m_Seed', '1');
    return e;
  }

  /**
   * The splines package's SplineExtrude as Unity's, which it builds vertex for vertex. Unity extrudes
   * in the container's own space, where SceNoCo reads the spline into the mesh's: the same only when
   * the two nodes sit in one place.
   */
  private splineExtrude(c: UnityComponent, n: UnityNode, where: string): El {
    const e = new El('SplineExtrude');
    const f = c.fields;
    const holder = f.container && typeof f.container === 'object' && 'node' in f.container ? (f.container as { node: string }).node : undefined;
    if (holder) {
      const ref = this.ref(holder, where);
      if (ref) e.set('m_Container', ref);
      const other = this.nodeAt(holder);
      if (other && !this.world(other).equals(this.world(n))) this.warn(where, 'SplineExtrude: Unity builds in the container node\'s space — put the mesh where its container is, or the road lands offset.');
    }
    const shape = f.shape === 'square' ? 'Square' : f.shape === 'road' ? 'Road' : 'Circle';
    const shapeEl = new El(shape);
    if (shape === 'Circle' && typeof f.sides === 'number') shapeEl.set('m_Sides', String(f.sides));
    e.add(new El('SplineExtrude.m_Shape').add(shapeEl));
    if (typeof f.sides === 'number') e.set('m_Sides', String(f.sides));
    for (const [key, field] of [['segmentsPerUnit', 'm_SegmentsPerUnit'], ['capped', 'm_Capped'], ['radius', 'm_Radius'], ['flipNormals', 'm_FlipNormals']] as const) {
      const v = f[key];
      if (typeof v === 'number' || typeof v === 'boolean') e.set(field, String(v));
    }
    if (f.range && typeof f.range === 'object' && 'v2' in f.range) e.set('m_Range', vec(f.range.v2));
    return e;
  }

  /**
   * The splines package's SplineMesh, which Unity lacks, as SceNoCo's own port of it (SplineMesh.cs,
   * copied with the export): the same piece bent the same way, a model keeping its materials.
   */
  private splineMesh(c: UnityComponent, where: string): El {
    const e = new El('SplineMesh');
    const f = c.fields;
    if (f.container && typeof f.container === 'object' && 'node' in f.container) {
      const ref = this.ref((f.container as { node: string }).node, where);
      if (ref) e.set('container', ref);
    }
    if (f.mesh && typeof f.mesh === 'object' && 'asset' in f.mesh) e.set('mesh', f.mesh.asset);
    else this.warn(where, 'SplineMesh: its mesh is not a model file or a mesh the export writes — set it in Unity.');
    if (typeof f.count === 'number' && f.count > 0) e.set('count', String(f.count));
    return e;
  }

  /** The splines package's SplineAnimate as Unity's: the same settings, with the node's +Z along the spline and +Y up. */
  private splineAnimate(c: UnityComponent, where: string): El {
    const e = new El('SplineAnimate');
    const f = c.fields;
    if (f.container && typeof f.container === 'object' && 'node' in f.container) {
      const ref = this.ref((f.container as { node: string }).node, where);
      if (ref) e.set('m_Target', ref);
    } else this.warn(where, 'SplineAnimate: Unity needs its container named — give it container={…}.');
    if (f.animationMethod === 'speed') e.set('m_Method', 'Speed');
    const loop = { once: 'Once', loopContinuous: 'Loop', pingPong: 'PingPong' }[f.loop as string];
    if (loop) e.set('m_LoopMode', loop);
    if (f.alignment === 'none') e.set('m_AlignmentMode', 'None');
    for (const [key, field] of [['duration', 'm_Duration'], ['maxSpeed', 'm_MaxSpeed'], ['playOnAwake', 'm_PlayOnAwake'], ['startOffset', 'm_StartOffset']] as const) {
      const v = f[key];
      if (typeof v === 'number' || typeof v === 'boolean') e.set(field, String(v));
    }
    return e;
  }

  /** A game behaviour: its serialized fields by name, each only where its C# class declares it. */
  private behaviour(c: UnityComponent, where: string): El {
    const e = new El(c.type);
    for (const [field, v] of Object.entries(c.fields)) {
      if (v === null) continue;
      if (this.options.declares && !this.options.declares(c.type, field)) {
        this.warn(where, `${c.type} has no serialized field ${field} — add a public one to wire it, and export again.`);
        continue;
      }
      this.value(e, field, v, where);
    }
    return e;
  }

  /** One value as an attribute, or as a property element when it is a list of what text can't hold. */
  private value(e: El, name: string, v: UnityValue, where: string) {
    const text = this.text(v, where);
    if (text !== undefined) return void e.set(name, text);
    if (v && typeof v === 'object' && 'array' in v) {
      const items = v.array.map((item) => this.item(item, where)).filter((x): x is El => !!x);
      if (items.length === v.array.length) return void e.add(new El(`${e.tag}.${name}`).add(...items));
    }
    if (v && typeof v === 'object' && 'object' in v) return void e.add(new El(`${e.tag}.${name}`).add(this.struct(v.object.type, v.object.fields, where)));
    this.warn(where, `${e.tag}.${name} could not be written — left out.`);
  }

  /** A value as attribute text, or undefined when it is structured (or a reference that could not be found). */
  private text(v: UnityValue, where: string): string | undefined {
    if (v === null) return undefined;
    if (typeof v === 'number') return num(v);
    if (typeof v === 'boolean' || typeof v === 'string') return String(v);
    if ('v2' in v) return vec(v.v2);
    if ('v3' in v) return vec(v.v3);
    if ('v4' in v) return vec(v.v4);
    if ('quat' in v) return vec(v.quat);
    if ('color' in v) return v.color;
    if ('asset' in v) {
      if (v.asset === this.holder && this.comparing === null) {
        this.warn(where, `holds its own prefab: in Unity a prefab's reference to itself is, on each copy, that copy — Instantiate clones the live object, not the asset.`);
        // As Unity keeps it, and Scenoco writes it: the prefab's root, by reference.
        return this.ref('', where);
      }
      return v.asset;
    }
    if ('node' in v) return this.ref(v.node, where, 'component' in v ? v.component : undefined);
    if ('array' in v) {
      // Lists of numbers or references are one attribute; anything else is items.
      const items = v.array.map((x) => (typeof x === 'number' || typeof x === 'boolean' ? String(x) : x && typeof x === 'object' && ('asset' in x || 'node' in x) ? this.text(x, where) : undefined));
      if (items.some((x) => x === undefined)) return undefined;
      return list(items as string[]);
    }
    return undefined;
  }

  private item(v: UnityValue, where: string): El | undefined {
    if (v === null) return undefined;
    const t = typeof v === 'string' ? 'String' : typeof v === 'number' ? 'Single' : typeof v === 'boolean' ? 'Boolean'
      : 'v2' in v ? 'Vector2' : 'v3' in v ? 'Vector3' : 'v4' in v ? 'Vector4' : 'quat' in v ? 'Quaternion' : 'color' in v ? 'Color' : undefined;
    if (t) return new El(t).set('value', this.text(v, where)!);
    if (typeof v === 'object' && 'object' in v) return this.struct(v.object.type, v.object.fields, where);
    return undefined;
  }

  private struct(type: string, fields: Record<string, UnityValue>, where: string): El {
    const e = new El(type);
    for (const [k, f] of Object.entries(fields)) if (f !== null) this.value(e, k, f, where);
    return e;
  }

  /** A node of this file by its path of child indices: `#Name`, or `#id` given to its element. */
  private ref(path: string, where: string, component?: string): string | undefined {
    if (this.comparing !== null) {
      const root = this.comparing;
      if (root === '' || path === root) return `@${root === '' ? path : ''}`;
      return path.startsWith(`${root}/`) ? `@${path.slice(root.length + 1)}` : `@@${path}`;
    }
    const steps = path === '' ? [] : path.split('/').map(Number);
    let node: UnityNode | undefined = this.roots.length === 1 && this.holder.endsWith('.prefab') ? this.roots[0] : undefined;
    if (!node) node = this.roots[steps.shift() ?? -1];
    for (const [k, i] of steps.entries()) {
      // Inside a placed prefab, past its root: what it holds is the prefab's, no element here.
      if (node?.prefab && k < steps.length) node = undefined;
      else node = node?.children[i];
    }
    if (!node) {
      this.warn(where, `a reference to ${path || 'the root'} is inside a placed prefab — set it in that prefab instead.`);
      return undefined;
    }
    // Unity's text names a component by its object, the field's type picking it: two of one type can't be told apart.
    const same = component ? node.components.filter((c) => c.type === component).length : 0;
    if (same > 1) this.warn(where, `a reference to one of the ${same} ${component}s on "${node.name}" — Unity's can't say which: put each on an object of its own.`);
    const known = this.refs.get(node);
    if (known) return known;
    let ref: string;
    if ((this.names.get(node.name) ?? 0) === 1 && !/[/#,\s]/.test(node.name)) ref = `#${node.name}`;
    else {
      const base = node.name.replace(/[^\w-]+/g, '_') || 'Object';
      let id = base;
      for (let k = 2; this.ids.has(id) || this.names.has(id); k++) id = `${base}_${k}`;
      this.ids.add(id);
      ref = `#${id}`;
      // Given to its element once the file is written (finish): it may come before or after this reference.
      this.idsByNode.set(node, id);
    }
    this.refs.set(node, ref);
    return ref;
  }

  // --- physics: SceNoCo's rapier and box2d components are Unity's own, by the same names --------

  private physics(c: UnityComponent, where: string): El {
    const spec = PHYSICS[c.type]!;
    const f = c.fields;
    const e = new El(c.type);
    const unknown = Object.keys(f).filter((k) => !spec.fields.includes(k) && !SURFACE.has(k) && k !== 'layer' && f[k] !== null);
    if (unknown.length) this.warn(where, `${c.type}: ${unknown.join(', ')} ${unknown.length > 1 ? 'have' : 'has'} no Unity counterpart — left out.`);
    // Unity's setters in the order they need: a joint's auto anchor before its anchor, a body's auto mass before its mass.
    for (const k of spec.fields) {
      let v = k in f ? f[k]! : k === 'autoConfigureConnectedAnchor' ? spec.autoAnchor ?? null : null;
      if (v === null) continue;
      if (k === 'mass' && f.useAutoMass === true) continue;
      if (k === 'size' && spec.dimensions === 3 && typeof v === 'object' && 'v3' in v) v = { v3: v.v3.map(Math.abs) };
      const struct = spec.structs?.[k];
      if (struct) {
        // A struct's setter turns its switch on (motor → useMotor): written only where the switch is not off.
        if (f[struct.switch] === false || typeof v !== 'object' || !('object' in v)) continue;
        e.add(new El(`${c.type}.${k}`).add(this.struct(struct.type, v.object.fields, where)));
        continue;
      }
      if (k === 'points' && typeof v === 'object' && 'array' in v) {
        e.add(new El(`${c.type}.points`).add(...v.array.map((p) => new El('Vector2').set('value', this.text(p, where) ?? '0 0'))));
        continue;
      }
      const text = this.text(v, where);
      if (text !== undefined) e.set(k, text);
    }
    const material = this.surface(c, spec.dimensions);
    if (material) e.set('sharedMaterial', material);
    return e;
  }

  /** A collider's friction and bounciness — its own, or its shared material's — as one physics material asset per pair. */
  private surface(c: UnityComponent, dimensions: 2 | 3): string | undefined {
    const m = c.fields.material;
    const s = m && typeof m === 'object' && 'object' in m ? m.object.fields : c.fields;
    if (s.friction === undefined && s.bounciness === undefined) return undefined;
    const friction = typeof s.friction === 'number' ? s.friction : dimensions === 2 ? 0.4 : 0.5;
    const bounciness = typeof s.bounciness === 'number' ? s.bounciness : 0;
    const label = (n: number) => String(Math.round(n * 100) / 100);
    const path = `Assets/Materials/Physics/Friction${label(friction)}_Bounce${label(bounciness)}${dimensions === 2 ? '_2D' : ''}.asset`;
    if (!this.assets.physicsMaterials.some((p) => p.path === path)) this.assets.physicsMaterials.push({ path, dimensions, friction, bounciness });
    return path;
  }

  // --- particles: three.quarks' effect as Unity's ParticleSystem, module by module --------------

  private particles(c: UnityComponent, e: El, off: boolean, where: string) {
    const effect = c.fields.effect;
    if (!effect || typeof effect !== 'object' || !('object' in effect)) return this.warn(where, 'ParticleSystem has no effect it could read — left off.');
    const f = effect.object.fields;
    const n = (o: Record<string, UnityValue>, k: string, d: number) => (typeof o[k] === 'number' ? (o[k] as number) : d);
    const sub = (k: string): Record<string, UnityValue> => {
      const v = f[k];
      return v && typeof v === 'object' && 'object' in v ? v.object.fields : {};
    };
    const deg = Math.PI / 180;
    const ps = new El('ParticleSystem');

    const main = new El('MainModule')
      .set('duration', num(n(f, 'duration', 5)))
      .set('loop', String(f.looping !== false))
      .set('prewarm', String(f.prewarm === true))
      .set('startLifetime', num(n(f, 'startLifetime', 5)))
      .set('startSpeed', num(n(f, 'startSpeed', 5)))
      .set('startSize', num(n(f, 'startSize', 1)))
      .set('startRotation', num(n(f, 'startRotation', 0) * deg))
      .set('startColor', f.startColor && typeof f.startColor === 'object' && 'color' in f.startColor ? f.startColor.color : '#ffffff')
      .set('gravityModifier', num(n(f, 'gravityModifier', 0)))
      .set('simulationSpace', f.simulationSpace === 'World' ? 'World' : 'Local')
      .set('scalingMode', 'Hierarchy')
      .set('playOnAwake', String(c.fields.playOnAwake !== false));
    ps.add(new El('ParticleSystem.main').add(main));

    const em = sub('emission');
    const emission = new El('EmissionModule').set('rateOverTime', num(n(em, 'rateOverTime', 10)));
    const bursts = em.bursts && typeof em.bursts === 'object' && 'array' in em.bursts ? em.bursts.array : [];
    if (bursts.length) {
      emission.add(new El('EmissionModule.bursts').add(...bursts.map((b) => {
        const bf = b && typeof b === 'object' && 'object' in b ? b.object.fields : {};
        return new El('Burst').set('time', num(n(bf, 'time', 0))).set('count', num(Math.round(n(bf, 'count', 0))));
      })));
    }
    ps.add(new El('ParticleSystem.emission').add(emission));

    // three.quarks emits along +Z like Unity; the mirror on Z turns a cone or a hemisphere round.
    const sh = sub('shape');
    const type = typeof sh.type === 'string' ? sh.type : 'Cone';
    const radius = n(sh, 'radius', 1);
    const shape = new El('ShapeModule');
    const shapeType = ({ Sphere: 'Sphere', Hemisphere: 'Hemisphere', Circle: 'Circle', Donut: 'Donut', Rectangle: 'Rectangle', Point: 'Sphere' } as Record<string, string>)[type] ?? 'Cone';
    shape.set('shapeType', shapeType).set('radius', num(type === 'Point' ? 0.0001 : radius)).set('angle', num(n(sh, 'angle', 25))).set('arc', num(n(sh, 'arc', 360)));
    if (shapeType === 'Cone' || shapeType === 'Hemisphere') shape.set('rotation', '0 180 0');
    if (shapeType === 'Rectangle') shape.set('scale', vec([radius * 2, radius * 2, 1]));
    ps.add(new El('ParticleSystem.shape').add(shape));

    if ('noise' in f) {
      const no = sub('noise');
      ps.add(new El('ParticleSystem.noise').add(new El('NoiseModule').set('enabled', 'true').set('strength', num(n(no, 'strength', 1))).set('frequency', num(n(no, 'frequency', 2)))));
    }
    const colorList = sub('colorOverLifetime').colors;
    const colors = (colorList && typeof colorList === 'object' && 'array' in colorList ? colorList.array : [])
      .map((x) => (x && typeof x === 'object' && 'color' in x ? x.color : null)).filter((x): x is string => !!x).slice(0, 8);
    if (colors.length) {
      // Evenly spaced, as the effect writes them; full alpha, fading out over the last third, as three.quarks does.
      const gradient = new El('MinMaxGradient.gradient').add(
        ...colors.map((col, i) => new El('Color').set('time', num(colors.length === 1 ? 0 : i / (colors.length - 1))).set('value', col)),
        new El('Alpha').set('time', '0').set('value', '1'),
        new El('Alpha').set('time', '0.7').set('value', '1'),
        new El('Alpha').set('time', '1').set('value', '0'),
      );
      ps.add(new El('ParticleSystem.colorOverLifetime').add(new El('ColorOverLifetimeModule').set('enabled', 'true')
        .add(new El('ColorOverLifetimeModule.color').add(new El('MinMaxGradient').set('mode', 'Gradient').add(gradient)))));
    }
    const sizeList = sub('sizeOverLifetime').curve;
    const sizes = (sizeList && typeof sizeList === 'object' && 'array' in sizeList ? sizeList.array : []).filter((x): x is number => typeof x === 'number');
    if (sizes.length) {
      // Linear between the values, as three.quarks reads them: each key's tangents are the slopes to its neighbours.
      const at = (i: number) => (sizes.length === 1 ? 0 : i / (sizes.length - 1));
      const slope = (a: number, b: number) => (b < 0 || b >= sizes.length || a < 0 ? 0 : (sizes[b]! - sizes[a]!) / (at(b) - at(a)));
      const keys = sizes.map((v, i) => new El('Key').set('time', num(at(i))).set('value', num(v)).set('inTangent', num(slope(i - 1, i))).set('outTangent', num(slope(i, i + 1))));
      ps.add(new El('ParticleSystem.sizeOverLifetime').add(new El('SizeOverLifetimeModule').set('enabled', 'true')
        .add(new El('SizeOverLifetimeModule.size').add(new El('MinMaxCurve').set('mode', 'Curve').set('curveMultiplier', '1').add(new El('MinMaxCurve.curve').add(...keys))))));
    }
    if ('rotationOverLifetime' in f) {
      ps.add(new El('ParticleSystem.rotationOverLifetime').add(new El('RotationOverLifetimeModule').set('enabled', 'true').set('z', num(n(sub('rotationOverLifetime'), 'angularVelocity', 0) * deg))));
    }
    e.add(ps);

    const r = sub('renderer');
    const renderMode = ({ StretchedBillboard: 'Stretch', HorizontalBillboard: 'HorizontalBillboard', VerticalBillboard: 'VerticalBillboard', Mesh: 'Mesh' } as Record<string, string>)[String(r.renderMode)] ?? 'Billboard';
    const blending = r.blending === 'Alpha' ? 'Alpha' : 'Additive';
    if (!this.assets.particleMaterials.includes(blending)) this.assets.particleMaterials.push(blending);
    const renderer = new El('ParticleSystemRenderer').set('renderMode', renderMode).set('sharedMaterial', `Assets/Materials/Particles-${blending}.mat`);
    if (off) renderer.set('enabled', 'false');
    e.add(renderer);
  }

  // --- the page, terrains, post effects ----------------------------------------------------------

  private document(c: UnityComponent, n: UnityNode, e: El, where: string) {
    const element = typeof c.fields.element === 'string' ? c.fields.element : 'ui';
    const documents = this.options.documents ?? {};
    const uxml = documents[element];
    if (!uxml) return this.warn(where, `no UXML for the element "${element}" — the page has no element with that id.`);
    const path = `Assets/UI/${element}.panel.asset`;
    if (!this.assets.panels.some((p) => p.path === path)) {
      const size = c.fields.referenceResolution;
      this.assets.panels.push({
        path,
        referenceResolution: size && typeof size === 'object' && 'v2' in size ? size.v2 : [1280, 720],
        match: typeof c.fields.match === 'number' ? c.fields.match : 0.5,
        // In the page's order: an element written later draws over an earlier one.
        sortingOrder: Object.keys(documents).indexOf(element),
      });
    }
    const document = new El('UIDocument').set('panelSettings', path).set('visualTreeAsset', uxml);
    // Unity takes one UIDocument an object: several on one node are each on a child named after its element.
    if (n.components.filter((x) => x.type === 'UIDocument').length > 1) e.add(new El('GameObject').set('name', element).add(document));
    else e.add(document);
  }

  /**
   * SceNoCo's terrain is centred on its node; Unity's starts at its object's corner, so the Terrain and
   * its collider sit on a child named Terrain at the data's offset.
   */
  private terrain(c: UnityComponent, e: El, where: string) {
    const data = c.fields.terrainData;
    const path = data && typeof data === 'object' && 'asset' in data ? data.asset : undefined;
    const t = path ? this.terrains.get(path) : undefined;
    if (!t) return this.warn(where, `${c.type} has no exported terrainData — left off.`);
    let child = e.children.find((x) => x.tag === 'GameObject' && x.get('name') === 'Terrain');
    if (!child) {
      child = new El('GameObject').set('name', 'Terrain').add(new El('Transform').set('localPosition', vec(t.offset)));
      e.add(child);
    }
    if (c.type === 'Terrain') {
      this.assets.terrainMaterial = 'Assets/Terrains/TerrainLit.mat';
      const terrain = new El('Terrain').set('terrainData', t.path).set('materialTemplate', this.assets.terrainMaterial);
      if (typeof c.fields.heightmapPixelError === 'number') terrain.set('heightmapPixelError', num(c.fields.heightmapPixelError));
      if (c.fields.castShadows === false) terrain.set('shadowCastingMode', 'Off');
      child.add(terrain);
    } else child.add(new El('TerrainCollider').set('terrainData', t.path));
  }

  /** A URP Volume: global, with its profile — the node's effect components — as an asset the importer makes. */
  private volume(n: UnityNode, e: El) {
    const volume = n.components.find((c) => c.type === 'Volume')!;
    const base = n.name.replace(/[^\w-]+/g, '_') || 'Volume';
    let path = `Assets/Materials/Volume-${base}.asset`;
    for (let k = 2; this.assets.volumes.some((v) => v.path === path); k++) path = `Assets/Materials/Volume-${base}-${k}.asset`;
    this.assets.volumes.push({ path, effects: n.components.filter((c) => EFFECTS.has(c.type)).map((c) => ({ type: c.type, fields: c.fields })) });
    const el = new El('Volume').set('isGlobal', 'true').set('sharedProfile', path);
    if (typeof volume.fields.priority === 'number') el.set('priority', num(volume.fields.priority));
    e.add(el);
  }

  /** Give each referenced element its id, after its name: called once the file is written. */
  finish() {
    for (const [node, id] of this.idsByNode) {
      const e = this.elements.get(node);
      if (e) e.attrs.splice(e.attrs.findIndex(([k]) => k === 'name') + 1, 0, ['id', id]);
    }
  }
}

/** The post effects a Volume's profile holds: components of their own in SceNoCo, overrides in URP. */
const EFFECTS = new Set(['Bloom', 'Tonemapping', 'ColorAdjustments', 'Vignette', 'DepthOfField', 'ChromaticAberration', 'FilmGrain']);

/** A collider's surface, written as its physics material. */
const SURFACE = new Set(['friction', 'bounciness', 'material']);

interface PhysicsSpec {
  dimensions: 2 | 3;
  /** Unity's property names SceNoCo shares, in the order Unity's setters need them. */
  fields: string[];
  /** A struct value, by its C# type, and the switch its setter turns on. */
  structs?: Record<string, { type: string; switch: string }>;
  /** SceNoCo's default where it is not Unity's. */
  autoAnchor?: boolean;
}

const COLLIDER_3D = ['isTrigger'];
const COLLIDER_2D = ['isTrigger', 'offset', 'density'];
const JOINT = ['enableCollision', 'breakForce', 'breakTorque', 'connectedBody'];
const ANCHORED = [...JOINT, 'anchor', 'autoConfigureConnectedAnchor', 'connectedAnchor'];
const MOTOR = { motor: { type: 'JointMotor2D', switch: 'useMotor' } };

const PHYSICS: Record<string, PhysicsSpec> = {
  Rigidbody: { dimensions: 3, fields: ['isKinematic', 'useGravity', 'linearDamping', 'angularDamping', 'constraints', 'freezeRotation'] },
  BoxCollider: { dimensions: 3, fields: [...COLLIDER_3D, 'size', 'center'] },
  SphereCollider: { dimensions: 3, fields: [...COLLIDER_3D, 'radius', 'center'] },
  CapsuleCollider: { dimensions: 3, fields: [...COLLIDER_3D, 'radius', 'height', 'center'] },
  MeshCollider: { dimensions: 3, fields: ['convex', ...COLLIDER_3D] },
  Rigidbody2D: { dimensions: 2, fields: ['bodyType', 'useAutoMass', 'mass', 'gravityScale', 'linearDamping', 'angularDamping', 'constraints', 'freezeRotation', 'collisionDetectionMode'] },
  BoxCollider2D: { dimensions: 2, fields: [...COLLIDER_2D, 'size'] },
  CircleCollider2D: { dimensions: 2, fields: [...COLLIDER_2D, 'radius'] },
  CapsuleCollider2D: { dimensions: 2, fields: [...COLLIDER_2D, 'size', 'direction'] },
  PolygonCollider2D: { dimensions: 2, fields: [...COLLIDER_2D, 'points'] },
  EdgeCollider2D: { dimensions: 2, fields: [...COLLIDER_2D, 'points'] },
  FixedJoint2D: { dimensions: 2, fields: [...ANCHORED, 'frequency', 'dampingRatio'] },
  HingeJoint2D: { dimensions: 2, fields: [...ANCHORED, 'useLimits', 'limits', 'useMotor', 'motor'], structs: { limits: { type: 'JointAngleLimits2D', switch: 'useLimits' }, ...MOTOR } },
  DistanceJoint2D: { dimensions: 2, fields: [...ANCHORED, 'autoConfigureDistance', 'distance', 'maxDistanceOnly'], autoAnchor: false },
  SpringJoint2D: { dimensions: 2, fields: [...ANCHORED, 'autoConfigureDistance', 'distance', 'dampingRatio', 'frequency'], autoAnchor: false },
  SliderJoint2D: { dimensions: 2, fields: [...ANCHORED, 'autoConfigureAngle', 'angle', 'useLimits', 'limits', 'useMotor', 'motor'], structs: { limits: { type: 'JointTranslationLimits2D', switch: 'useLimits' }, ...MOTOR } },
  WheelJoint2D: { dimensions: 2, fields: [...ANCHORED, 'suspension', 'useMotor', 'motor'], structs: { suspension: { type: 'JointSuspension2D', switch: '' }, ...MOTOR } },
  FrictionJoint2D: { dimensions: 2, fields: [...ANCHORED, 'maxForce', 'maxTorque'] },
  RelativeJoint2D: { dimensions: 2, fields: [...JOINT, 'maxForce', 'maxTorque', 'correctionScale', 'autoConfigureOffset', 'linearOffset', 'angularOffset'] },
  TargetJoint2D: { dimensions: 2, fields: [...JOINT, 'anchor', 'autoConfigureTarget', 'target', 'maxForce', 'dampingRatio', 'frequency'] },
};

// --- values ------------------------------------------------------------------------------------

/** A number as the shortest text Scenoco reads back the same, rounded as the exporter rounds. */
/** three's position as Unity's: z negated. */
const mirror = ([x, y, z]: number[]) => [x!, y!, z === 0 ? 0 : -z!];

/**
 * A knot's Rotation in Unity's space: facing along the curve, its up the world's made square to the
 * curve and turned `roll` radians about it, as SceNoCo banks a knot.
 */
function knotRotation(out: number[], tin: number[], roll: number): Quaternion {
  const forward = new Vector3(...out);
  if (forward.lengthSq() < 1e-12) forward.set(-tin[0]!, -tin[1]!, -tin[2]!);
  if (forward.lengthSq() < 1e-12) forward.set(0, 0, 1);
  forward.normalize();
  const up = new Vector3(0, 1, 0);
  if (Math.abs(forward.dot(up)) > 0.999) up.set(0, 0, 1);
  // Unity's LookRotation: right = up × forward, in its left-handed space.
  const right = new Vector3().crossVectors(up, forward).normalize();
  up.crossVectors(forward, right);
  const look = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, forward));
  // Mirrored, a turn about the curve changes hands: SceNoCo's roll is Unity's −roll about z.
  return look.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -roll));
}
/** A value the converter mirrored as a vector, back in three's space — for a writer that mirrors itself. */
const flipBack = mirror;

function num(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

const vec = (v: number[]) => v.map(num).join(' ');

/** A list of numbers or references: space-separated, or comma-separated when an item has a space. */
const list = (items: string[]) => items.join(items.some((i) => /\s/.test(i)) ? ', ' : ' ');

/**
 * Unity's Euler angles for a quaternion, in degrees: Quaternion.Euler(x, y, z) turns about z, then x,
 * then y — a matrix Ry·Rx·Rz, three's order 'YXZ' read in Unity's own space.
 */
export function eulerAngles([x, y, z, w]: number[]): number[] {
  const m11 = 1 - 2 * (y! * y! + z! * z!), m12 = 2 * (x! * y! - z! * w!), m13 = 2 * (x! * z! + y! * w!);
  const m21 = 2 * (x! * y! + z! * w!), m22 = 1 - 2 * (x! * x! + z! * z!), m23 = 2 * (y! * z! - x! * w!);
  const m31 = 2 * (x! * z! - y! * w!), m33 = 1 - 2 * (x! * x! + y! * y!);
  const ex = Math.asin(Math.max(-1, Math.min(1, -m23)));
  let ey: number, ez: number;
  if (Math.abs(m23) < 0.9999999) {
    ey = Math.atan2(m13, m33);
    ez = Math.atan2(m21, m22);
  } else {
    ey = Math.atan2(-m31, m11);
    ez = 0;
  }
  return [ex, ey, ez].map((a) => Math.round(((a * 180) / Math.PI) * 1e4) / 1e4 || 0);
}

// --- the text ----------------------------------------------------------------------------------

class El {
  attrs: [string, string][] = [];
  children: El[] = [];
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  set(key: string, value: string): this {
    const at = this.attrs.findIndex(([k]) => k === key);
    if (at >= 0) this.attrs[at] = [key, value];
    else this.attrs.push([key, value]);
    return this;
  }
  get(key: string): string | undefined {
    return this.attrs.find(([k]) => k === key)?.[1];
  }
  add(...children: El[]): this {
    this.children.push(...children);
    return this;
  }
}

/** An element and everything under it, anew: one written in two places. */
function copy(e: El): El {
  const out = new El(e.tag);
  out.attrs = e.attrs.map(([k, v]) => [k, v]);
  out.children = e.children.map(copy);
  return out;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Scenoco's house style: two spaces a level, one element a line, empty elements closed in place. */
function print(e: El, depth = 0): string {
  const pad = '  '.repeat(depth);
  const attrs = e.attrs.map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
  if (!e.children.length) return `${pad}<${e.tag}${attrs} />\n`;
  return `${pad}<${e.tag}${attrs}>\n${e.children.map((c) => print(c, depth + 1)).join('')}${pad}</${e.tag}>\n`;
}
