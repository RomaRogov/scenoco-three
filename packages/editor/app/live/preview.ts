import * as THREE from 'three';
import { TextureLoader, type Object3D } from 'three';
import type { ComponentInfo, DocumentKindInfo, DocumentShape, PropInfo, SncElement } from '@scenoco-three/compiler';
// The browser entry, deliberately: importing a *value* from the package root pulls the Node
// compiler — and TypeScript itself — into the page's bundle.
import { parseDocument, PREVIEW_THREE } from '@scenoco-three/compiler/browser';
import { parseValue } from '../values.js';
import type { Source } from './source.js';

/**
 * What a component looks like, when it is the kind of component that puts geometry in the world.
 *
 * Almost nothing a component does can be shown in an editor that runs no game code, and every
 * editor worth the name says so plainly: PlayCanvas draws an icon where a script is and leaves it
 * at that. The exception is the component whose whole output *is* geometry — a terrain, a
 * procedural wall — where the thing to look at is computable from what the document already says.
 *
 * So a preview is a pure function of the component's authored attributes, and nothing else:
 *
 * ```js
 * // terrain.preview.js — declared in package.json as "previews": { "Terrain": "./src/terrain.preview.js" }
 * import { Mesh, PlaneGeometry, MeshStandardMaterial } from 'three';
 * export default function preview(props) { … }
 * ```
 *
 * It is a pure function so that there is nothing for it to break: no scene to mutate, no lifecycle
 * to get wrong, no undo to corrupt. That is the difference between this and running components in
 * the editor, and it is the whole reason this is a mechanism one can afford.
 *
 * ### Something that moves
 *
 * A still frame of an effect says nothing, so a preview may return an `update` beside its object
 * and the editor will drive it — with transport controls beside the component, as every editor with
 * a particle system has. It is still not game code: what it is handed is `dt` and its own subtree,
 * which is the whole reason it stays affordable.
 *
 * ```js
 * export default function preview(props) {
 *   const object = new Group();
 *   return { object, update: (dt) => { … } };
 * }
 * ```
 *
 * An `update` that throws is not called again — a mistake in a preview costs its own picture and
 * nothing else, rather than the editor's frame loop.
 */
export class Previews {
  private readonly source: Source;
  /** The document these previews are for — what a relative artifact path is resolved against. */
  private readonly from: string;
  /** How far above the document the project's `.scenoco` sits: `''`, `'../'`, `'../../'`. */
  private readonly base: string;
  /** The document kinds this project has, so a reference to one can be handed over as a value. */
  private readonly kinds: readonly DocumentKindInfo[];
  /** One import per module, however many nodes use it. */
  private readonly loaded = new Map<string, Promise<PreviewFunction | null>>();
  /** What is currently drawn, by node and component — and whether it is running. */
  private readonly mounted = new Map<string, Mounted>();
  /** What could not be loaded, said once. */
  readonly problems: string[] = [];
  /** Told when what is drawn changes, so the chrome can repaint. Set by the page. */
  onChanged?: () => void;
  /**
   * Told why a preview is not there, as it happens. Set by the page.
   *
   * Because the alternative is what it did before: a preview that failed to rebuild took its
   * transport with it and said nothing, and the only clue was that the buttons had gone. These
   * arrive long after the document was opened — a file has moved, a server has stopped — so the
   * list of problems the open collected is the wrong place to put them.
   */
  onProblem?: (message: string) => void;

  constructor(source: Source, from: string, base: string, kinds: readonly DocumentKindInfo[] = []) {
    this.source = source;
    this.from = from;
    this.base = base;
    this.kinds = kinds;
  }

  /**
   * Build a component's preview and hang it under the node, replacing whatever was there.
   *
   * It is marked as a preview rather than stamped with a document position, which is what keeps
   * it out of the tree and out of the way of a pick: nothing here is something the document says.
   *
   * The old one stays up until the new one is ready. Building is asynchronous — a module to
   * import, a document to read — and taking the old preview down first left a gap in which the
   * component had no preview at all: the transport beside it, which asks whether there is one,
   * vanished the moment Stop was pressed and did not come back.
   */
  async mount(node: Object3D, info: ComponentInfo, attributes: ReadonlyMap<string, string>): Promise<void> {
    const key = keyOf(node, info);
    const previous = this.mounted.get(key);
    const wasPlaying = previous?.playing ?? false;

    const replace = (entry: Mounted | null): void => {
      if (previous) detach(previous);
      if (entry) this.mounted.set(key, entry);
      else this.mounted.delete(key);
      // Whatever is drawn just changed, and the chrome reads this at render time rather than
      // subscribing to it. Without this the transport comes back only on the next unrelated edit.
      this.onChanged?.();
    };

    const build = await this.load(info);
    if (!build) return replace(null);

    let result: PreviewResult | null = null;
    try {
      result = build(await this.propsOf(info, attributes));
    } catch (error) {
      this.note(`${info.name}'s preview threw: ${reason(error)}`);
      return replace(null);
    }
    const object = result && 'isObject3D' in result ? result : result?.object;
    if (!object || !(object as { isObject3D?: boolean }).isObject3D) return replace(null);
    const update = result && 'isObject3D' in result ? undefined : result?.update;

    object.userData.scenocoPreview = info.name;
    node.add(object);
    // A rebuild keeps what was running running: a scrubbed number must not stop the effect it is
    // being scrubbed against. A stop is the exception, and says so by clearing `playing` first.
    replace({ node, info, object, update, attributes, playing: wasPlaying && update !== undefined });
  }

  /** Whether this component's preview moves, and whether it is moving — for the transport. */
  stateOf(node: Object3D, component: string): { animated: boolean; playing: boolean } {
    const found = this.mounted.get(`${node.uuid}:${component}`);
    return { animated: found?.update !== undefined, playing: found?.playing ?? false };
  }

  play(node: Object3D, component: string): void {
    const found = this.mounted.get(`${node.uuid}:${component}`);
    if (found?.update) found.playing = true;
  }

  pause(node: Object3D, component: string): void {
    const found = this.mounted.get(`${node.uuid}:${component}`);
    if (found) found.playing = false;
  }

  /** Back to the first frame: the preview is built again from the same attributes, not running. */
  stop(node: Object3D, component: string): void {
    const found = this.mounted.get(`${node.uuid}:${component}`);
    if (!found) return;
    found.playing = false;
    void this.mount(node, found.info, found.attributes);
  }

  /** Drive every running preview. Called once per editor frame. */
  step(dt: number): void {
    for (const entry of this.mounted.values()) {
      if (!entry.playing || !entry.update) continue;
      try {
        entry.update(dt);
      } catch (error) {
        // Once. A preview that throws sixty times a second would be the editor's problem rather
        // than its own, and the first message is the one worth reading anyway.
        entry.playing = false;
        entry.update = undefined;
        this.note(`${entry.info.name}'s preview stopped: its update threw — ${reason(error)}`);
      }
    }
  }


  /**
   * The component's attributes as the values its fields are declared to hold.
   *
   * The same reading the inspector does, and then two steps further. A field declared `Vector3` is
   * handed a `Vector3` and a `Color` a `Color` — a preview is written against the component's own
   * field types, so it must receive what the component would have been given.
   *
   * And a field that names a **document** is handed the document, built from the shape the model
   * carries: `<ParticleSystem effect="../vfx/fire.particle.xml">` reaches its preview as the
   * effect, not as the path to it. A preview cannot fetch or parse anything, and this is the whole
   * reason it does not have to.
   */
  private async propsOf(
    info: ComponentInfo,
    attributes: ReadonlyMap<string, string>,
  ): Promise<Record<string, unknown>> {
    const props: Record<string, unknown> = {};
    for (const field of info.fields) {
      const written = attributes.get(field.name) ?? field.default?.replace(/^['"]|['"]$/g, '');
      if (written === undefined) continue;
      const value =
        field.shape === 'assetRef' ? await this.referenced(this.from, written) : asRuntimeValue(field, parseValue(field.shape, written)!);
      if (value !== undefined) props[field.name] = value;
    }
    return props;
  }

  /**
   * What a path in a document names: another document, as a value, or an image, as a texture.
   *
   * Anything else is left out rather than passed as its own text — a preview handed a string where
   * it expected an object would fail somewhere deep inside itself, and the useful behaviour is to
   * draw what can be drawn.
   */
  private async referenced(from: string, href: string): Promise<unknown> {
    const kind = this.kinds.find((k) => href.endsWith(k.extension));
    const path = this.source.resolve(from, href);
    if (kind?.shape) {
      try {
        const parsed = parseDocument(await this.source.read(path), path);
        if (parsed.ok && parsed.root.tag === kind.shape.name) return await this.valueOf(parsed.root, kind.shape, path);
      } catch (error) {
        this.note(`${href} could not be read for a preview: ${reason(error)}`);
      }
      return undefined;
    }
    if (/\.(png|jpe?g|webp|gif|ktx2|hdr|exr)$/i.test(href)) {
      try {
        return await new TextureLoader().loadAsync(await this.source.url(path));
      } catch {
        return undefined; // the effect draws with its own default rather than nothing at all
      }
    }
    return undefined;
  }

  /**
   * One config document as the value it compiles to.
   *
   * The same walk the form draws and the compiler emits, over the same shape: an element is named
   * by the type of the field it fills, its attributes are that type's fields. Nothing here is
   * specific to any kind of document.
   */
  private async valueOf(element: SncElement, shape: DocumentShape, path: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const field of shape.fields) {
      const written = element.attributes.get(field.name);
      if (written === undefined) continue;
      out[field.name] =
        field.shape === 'assetRef' ? await this.referenced(path, written) : asRuntimeValue(field, parseValue(field.shape, written)!);
    }
    for (const [name, group] of Object.entries(shape.groups)) {
      const child = element.children.find((c) => c.tag === group.name);
      if (child) out[name] = await this.valueOf(child, group, path);
    }
    for (const [name, list] of Object.entries(shape.lists)) {
      const written = element.children.filter((c) => c.tag === list.name);
      if (written.length > 0) out[name] = await Promise.all(written.map((c) => this.valueOf(c, list, path)));
    }
    return out;
  }



  /** Record why something is not drawn, and say it where someone will see it. */
  private note(message: string): void {
    this.problems.push(message);
    this.onProblem?.(message);
  }

  private load(info: ComponentInfo): Promise<PreviewFunction | null> {
    const path = this.source.resolve(this.from, `${this.base}${info.preview!}`);
    const existing = this.loaded.get(path);
    if (existing) return existing;
    const started = this.importModule(path).catch((error: unknown) => {
      this.note(`${info.name}'s preview (${info.preview!}) did not load: ${String(error)}`);
      return null;
    });
    this.loaded.set(path, started);
    return started;
  }

  /**
   * Fetch the module and import it.
   *
   * Through a blob, because the file may have come from a folder the person picked, where there is
   * no URL to import — and because a blob cannot resolve anything, which is precisely why the
   * build writes this artifact with no imports at all. It reads `three` off a global instead, and
   * the global is this editor's own copy: one three in the page, whatever the project was built
   * against.
   */
  private async importModule(path: string): Promise<PreviewFunction | null> {
    (globalThis as unknown as Record<string, unknown>)[PREVIEW_THREE] = THREE;
    const source = await this.source.read(path);
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const module = (await import(/* @vite-ignore */ url)) as { default?: unknown };
      return typeof module.default === 'function' ? (module.default as PreviewFunction) : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * A preview module's default export.
 *
 * Either the object to draw, or that object with an `update` the editor may drive — which is what
 * turns a still picture of an effect into the effect.
 */
type PreviewFunction = (props: Record<string, unknown>) => PreviewResult | null;
type PreviewResult = Object3D | { object: Object3D; update?: (dt: number) => void };

/** One preview currently on a node. */
interface Mounted {
  node: Object3D;
  info: ComponentInfo;
  object: Object3D;
  update: ((dt: number) => void) | undefined;
  playing: boolean;
  /** What it was built from, so a stop can build the same thing again. */
  attributes: ReadonlyMap<string, string>;
}

const keyOf = (node: Object3D, info: ComponentInfo): string => `${node.uuid}:${info.name}`;
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Take one preview down and free what it held. */
function detach(entry: Mounted): void {
  entry.object.removeFromParent();
  entry.object.traverse((object) => {
    const disposable = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    disposable.geometry?.dispose();
    disposable.material?.dispose();
  });
}



function asRuntimeValue(field: PropInfo, value: number | boolean | string | number[]): unknown {
  switch (field.shape) {
    case 'array': {
      // `[#ffee88, #ff6622]`, `[1, 0.6, 0]` — the element's own shape decides each entry, and a
      // config field declared `Color[]` has to arrive as colours rather than as its own text.
      const inner: PropInfo = { ...field, shape: field.elementShape ?? 'string' };
      return String(value)
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .map((part) => asRuntimeValue(inner, parseValue(inner.shape, part)!));
    }
    case 'color':
      return new THREE.Color(value as number);
    case 'vector2':
      return new THREE.Vector2(...(value as number[]));
    case 'vector3':
    case 'euler':
      return new THREE.Vector3(...(value as number[]));
    case 'vector4':
      return new THREE.Vector4(...(value as number[]));
    default:
      // A reference — `#id`, a path to a document — stays the text it was written as. Nothing
      // here can resolve one, and a preview that needs one is past what a preview is for.
      return value;
  }
}
