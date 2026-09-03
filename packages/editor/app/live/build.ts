/**
 * A live scene from XML, in the page, without the compiler's output.
 *
 * The compiler turns a document into TypeScript by reading the project's types; a page cannot
 * run that. What it *can* do is what the generated module would have done, with the same
 * vocabulary: construct each element's class with the parameters the model says it takes, set
 * the properties it names, place it, stamp it with where it came from, and add it to its
 * parent. This does that from the same parser and the same model, so the tree, the inspector
 * and the gizmos see exactly what they see when the server compiled the scene.
 *
 * What it cannot do, and says so: run a **component** or a **system**. Those are the project's
 * own TypeScript, and there is no TypeScript here. A document opens with its nodes live and its
 * behaviour inert — which is what a standalone viewer of a scene *is*, and everything a person
 * edits in it is nodes.
 */
import * as THREE from 'three';
import { Color, Object3D, Scene, TextureLoader, Vector2, Vector3, Vector4 } from 'three';
import type { SceneType } from '@scenoco-three/core';
import { parseDocument, type ProjectModel, type PropInfo, type SncElement, type TagInfo } from '@scenoco-three/compiler/browser';
import { parseValue } from '../values.js';
import type { Source } from './source.js';

/** Tag name → class, plus the constants an `enum` attribute names (`FrontSide`). */
export type Registry = Readonly<Record<string, unknown>>;

export interface LiveScene {
  /** Load this the way a generated scene class is loaded; it builds the tree in `onLoad`. */
  SceneClass: SceneType;
  /** What could not be honoured, in the order it was met. Never fatal: the rest still shows. */
  problems: string[];
}

const PLACEMENT = new Set(['id', 'name', 'position', 'eulerAngles', 'scale', 'visible', 'active', 'dontDestroyOnLoad']);
const SCENE_ONLY = new Set(['camera', 'render', 'dontDestroyOnLoad', 'disposeOnUnload']);

/** Build a scene class for the document at `path`. The tree is rebuilt on every load. */
export async function buildLive(path: string, source: Source, model: ProjectModel, registry: Registry): Promise<LiveScene> {
  const builder = new Builder(source, model, registry);
  const text = await source.read(path);
  const parsed = parseDocument(text, path);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map((d) => `${path}:${d.line}:${d.column} ${d.message}`).join('\n'));
  }
  const root = parsed.root;
  const problems = builder.problems;

  class LiveSceneClass extends Scene {
    override async onLoad(): Promise<void> {
      builder.problems.length = 0;
      if (root.tag === 'Scene') {
        await builder.populateScene(this, root, path);
      } else {
        // A prefab document opens on a stage, as it does in the server-backed editor.
        this.background = new Color(0x141a24);
        this.add(new THREE.AmbientLight(0xffffff, 0.8));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(4, 8, 5);
        this.add(sun);
        const node = await builder.buildNode(root, path, new Map());
        if (node) this.add(node);
      }
    }
  }
  return { SceneClass: LiveSceneClass, problems };
}

class Builder {
  readonly problems: string[] = [];
  private readonly resources = new Map<string, Promise<unknown>>();
  private readonly loader = new TextureLoader();

  private readonly source: Source;
  private readonly model: ProjectModel;
  private readonly registry: Registry;

  constructor(source: Source, model: ProjectModel, registry: Registry) {
    this.source = source;
    this.model = model;
    this.registry = registry;
  }

  async populateScene(scene: Scene, root: SncElement, file: string): Promise<void> {
    const ids = new Map<string, object>();
    for (const child of root.children) {
      const node = await this.buildNode(child, file, ids);
      if (node) scene.add(node);
    }
    // `<Scene>` is grammar, not a tag the model lists, so its own attributes are read here: the
    // four the engine defines are skipped, `background` is a colour, and the rest are three's.
    const background = root.attributes.get('background');
    if (background !== undefined) scene.background = new Color(parseValue('color', background) as number);
    const tag = this.model.tags.find((t) => t.name === 'Scene');
    if (tag) await this.assignAttributes(scene, tag, root, file, ids, new Set([...SCENE_ONLY, 'background']));
    for (const [id, thing] of ids) (scene as unknown as Record<string, unknown>)[id] = thing;
    const camera = root.attributes.get('camera');
    if (camera) {
      const target = ids.get(camera.replace(/^#/, ''));
      if (target && (target as { isCamera?: boolean }).isCamera) scene.mainCamera = target as THREE.Camera;
      else this.problems.push(`${file}: camera="${camera}" does not name a camera in this document`);
    }
    this.finishReferences(ids, file);
  }

  /** A node from an element, with its subtree, or null for what is not a node here. */
  async buildNode(element: SncElement, file: string, ids: Map<string, object>): Promise<Object3D | null> {
    if (element.tag === 'Components' || element.tag === 'Systems' || element.tag === 'Override') return null;
    if (element.tag === 'Prefab') return this.spawn(element, file, ids);

    const tag = this.model.tags.find((t) => t.name === element.tag && t.family === 'node');
    const Ctor = tag ? (this.registry[tag.name] as (new (...args: unknown[]) => Object3D) | undefined) : undefined;
    let node: Object3D;
    if (!tag || !Ctor) {
      // Kept in the tree as a plain node, so the person can still see and select what the
      // document said, with the reason it is not more than that.
      this.problems.push(`${file}:${element.line}: <${element.tag}> is not a node this editor can build`);
      node = new Object3D();
      node.name = `<${element.tag}>`;
    } else {
      const args = await this.constructorArguments(tag, element, file, ids);
      node = new Ctor(...args);
      await this.assignAttributes(node, tag, element, file, ids, PLACEMENT);
    }
    this.place(node, element, file, ids);
    for (const child of element.children) {
      const built = await this.buildNode(child, file, ids);
      if (built) node.add(built);
    }
    return node;
  }

  private async spawn(element: SncElement, file: string, ids: Map<string, object>): Promise<Object3D | null> {
    const src = element.attributes.get('src');
    if (!src) {
      this.problems.push(`${file}:${element.line}: <Prefab> has no src`);
      return null;
    }
    const prefabPath = this.source.resolve(file, src);
    let text: string;
    try {
      text = await this.source.read(prefabPath);
    } catch (error) {
      this.problems.push(`${file}:${element.line}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const parsed = parseDocument(text, prefabPath);
    if (!parsed.ok) {
      this.problems.push(`${prefabPath}: ${parsed.diagnostics[0]?.message ?? 'does not parse'}`);
      return null;
    }
    // The prefab's own ids are its own: an override reaches them, the scene does not.
    const inner = new Map<string, object>();
    const node = await this.buildNode(parsed.root, prefabPath, inner);
    if (!node) return null;
    this.finishReferences(inner, prefabPath);
    for (const child of element.children) {
      if (child.tag !== 'Override') continue;
      const target = child.attributes.get('target')?.replace(/^#/, '');
      const thing = target ? inner.get(target) : undefined;
      if (!thing) {
        this.problems.push(`${file}:${child.line}: <Override target="${child.attributes.get('target')}"> names nothing in ${src}`);
        continue;
      }
      // An override may say anything the element could have said itself: placement included.
      if ((thing as Partial<Object3D>).isObject3D) this.placement(thing as Object3D, child);
      const tag = this.tagOf(thing);
      if (tag) await this.assignAttributes(thing as Object3D, tag, child, file, inner, new Set(['target', ...PLACEMENT]));
    }
    this.place(node, element, file, ids);
    return node;
  }

  private tagOf(thing: object): TagInfo | undefined {
    const name = (thing as { type?: string }).type ?? thing.constructor.name;
    return this.model.tags.find((t) => t.name === name) ?? this.model.tags.find((t) => t.name === thing.constructor.name);
  }

  private async constructorArguments(tag: TagInfo, element: SncElement, file: string, ids: Map<string, object>): Promise<unknown[]> {
    if (tag.family === 'material') {
      // A material takes one options object, which is also how three.js wants it — several
      // material properties are only honoured at construction.
      const options: Record<string, unknown> = {};
      for (const prop of [...tag.parameters, ...tag.properties]) {
        const text = element.attributes.get(prop.name);
        if (text !== undefined) options[prop.name] = await this.valueOf(prop, text, file, ids);
      }
      return [options];
    }
    const args: unknown[] = [];
    let lastSet = -1;
    tag.parameters.forEach((p, i) => {
      if (element.attributes.has(p.name)) lastSet = i;
    });
    for (let i = 0; i <= lastSet; i++) {
      const prop = tag.parameters[i]!;
      const text = element.attributes.get(prop.name);
      args.push(text === undefined ? undefined : await this.valueOf(prop, text, file, ids));
    }
    return args;
  }

  private async assignAttributes(
    target: Object3D | object,
    tag: TagInfo,
    element: SncElement,
    file: string,
    ids: Map<string, object>,
    skip: ReadonlySet<string>,
  ): Promise<void> {
    const parameters = new Set(tag.parameters.map((p) => p.name));
    const byName = new Map<string, PropInfo>();
    for (const p of [...tag.parameters, ...tag.properties]) byName.set(p.name, p);
    for (const [name, text] of element.attributes) {
      if (skip.has(name) || name.includes(':') || (parameters.has(name) && tag.family !== 'material' && element.tag === tag.name)) continue;
      if (tag.family === 'material' && element.tag === tag.name) continue; // all went into the constructor
      const prop = byName.get(name);
      if (!prop) {
        this.problems.push(`${file}:${element.line}: <${element.tag}> has no attribute "${name}"`);
        continue;
      }
      const value = await this.valueOf(prop, text, file, ids);
      if (value !== undefined) assign(target as Record<string, unknown>, name, value);
    }
  }

  private place(node: Object3D, element: SncElement, file: string, ids: Map<string, object>): void {
    this.placement(node, element);
    // Where it came from — the same stamp the compiler writes, so selection and the inspector
    // find the element by the parser's positions.
    node.userData.scenoco = { file, line: element.line, column: element.column };
    const id = element.attributes.get('id');
    if (id) ids.set(id, node);
  }

  /** The transform half of placement, which an `<Override>` may restate. */
  private placement(node: Object3D, element: SncElement): void {
    const get = (name: string) => element.attributes.get(name);
    if (get('name') !== undefined) node.name = get('name')!;
    if (get('position') !== undefined) node.position.fromArray(parseValue('vector3', get('position')) as number[]);
    if (get('eulerAngles') !== undefined) node.eulerAngles = new Vector3().fromArray(parseValue('euler', get('eulerAngles')) as number[]);
    const scale = get('scale');
    if (scale !== undefined) {
      const uniform = Number(scale.trim());
      if (Number.isFinite(uniform) && !scale.includes(':')) node.scale.setScalar(uniform);
      else node.scale.fromArray(parseValue('vector3', scale) as number[]);
    }
    if (get('visible') !== undefined) node.visible = get('visible') === 'true';
    if (get('active') === 'false') node.setActive(false);
  }

  /** A `#id` written before its node was built is filled in once the whole tree exists. */
  private readonly pending: Array<{ target: Record<string, unknown>; name: string; id: string; ids: Map<string, object> }> = [];

  private finishReferences(ids: Map<string, object>, file: string): void {
    for (const ref of this.pending.splice(0)) {
      if (ref.ids !== ids) {
        this.pending.push(ref);
        continue;
      }
      const thing = ids.get(ref.id);
      if (thing) ref.target[ref.name] = thing;
      else this.problems.push(`${file}: "#${ref.id}" names nothing in this document`);
    }
  }

  private async valueOf(prop: PropInfo, text: string, file: string, ids: Map<string, object>): Promise<unknown> {
    switch (prop.shape) {
      case 'number':
      case 'boolean':
      case 'string':
        return parseValue(prop.shape, text);
      case 'color':
        return new Color(parseValue('color', text) as number);
      case 'vector2':
        return new Vector2().fromArray(parseValue('vector2', text) as number[]);
      case 'vector3':
        return new Vector3().fromArray(parseValue('vector3', text) as number[]);
      case 'euler':
        return new Vector3().fromArray(parseValue('euler', text) as number[]);
      case 'vector4':
        return new Vector4().fromArray(parseValue('vector4', text) as number[]);
      case 'enum':
        return this.registry[text.trim()] ?? text;
      case 'nodeRef':
        return { pendingRef: text.replace(/^#/, ''), ids };
      case 'assetRef':
        return this.asset(prop, text, file);
      default:
        this.problems.push(`${file}: ${prop.name}="${text}" is a ${prop.shape}, which this editor cannot build`);
        return undefined;
    }
  }

  /** A referenced document — a geometry, a material — built once and shared, as the compiler shares its module. */
  private asset(prop: PropInfo, ref: string, file: string): Promise<unknown> {
    const path = this.source.resolve(file, ref);
    let building = this.resources.get(path);
    if (!building) {
      building = this.buildAsset(path, ref, file).catch((error: unknown) => {
        this.problems.push(`${file}: ${prop.name}="${ref}" — ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      this.resources.set(path, building);
    }
    return building;
  }

  private async buildAsset(path: string, ref: string, file: string): Promise<unknown> {
    if (/\.(png|jpe?g|webp|gif|ktx2|hdr|exr)$/i.test(ref)) return this.loader.load(await this.source.url(path));
    if (!ref.endsWith('.xml')) throw new Error('only documents and images are loaded here; a model needs the compiler');
    const text = await this.source.read(path);
    const parsed = parseDocument(text, path);
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message ?? 'does not parse');
    const root = parsed.root;
    const tag = this.model.tags.find((t) => t.name === root.tag);
    const Ctor = tag ? (this.registry[tag.name] as (new (...args: unknown[]) => object) | undefined) : undefined;
    if (!tag || !Ctor) throw new Error(`<${root.tag}> is not something this editor can build`);
    const ids = new Map<string, object>();
    const thing = new Ctor(...(await this.constructorArguments(tag, root, path, ids)));
    await this.assignAttributes(thing, tag, root, path, ids, new Set());
    return thing;
  }
}

/** Set a property the way the generated code would: into a live vector or colour, or outright. */
function assign(target: Record<string, unknown>, name: string, value: unknown): void {
  const pending = value as { pendingRef?: string; ids?: Map<string, object> };
  if (pending && typeof pending === 'object' && pending.pendingRef !== undefined && pending.ids) {
    target[name] = pending.ids.get(pending.pendingRef) ?? null;
    return;
  }
  if (name === 'eulerAngles' && value instanceof Vector3) {
    (target as { eulerAngles: Vector3 }).eulerAngles = value;
    return;
  }
  const current = target[name] as { copy?: (v: unknown) => unknown; set?: (v: unknown) => unknown; isColor?: boolean } | undefined;
  if (current && typeof current === 'object') {
    if (value instanceof Color && current.isColor && current.set) {
      current.set(value);
      return;
    }
    if ((value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4) && current.copy) {
      current.copy(value);
      return;
    }
  }
  target[name] = value;
}
