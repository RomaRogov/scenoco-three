import { Box3Helper, Box3, Camera, Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { Behaviour } from './kernel/Behaviour.js';
import { Runtime, behavioursOn, assignInit } from './kernel/runtime.js';
import { fieldsOf, type FieldInfo } from './kernel/schema.js';
import { applyProp, sourceOf, type Source } from './jsx.js';
import type { Game, PlayOptions } from './play.js';

/**
 * Edit mode: `play()` in development, on a page opened with `?edit`. The scene is built exactly as
 * the game builds it — by the game's own code, on the game's own dev server — and then left
 * still: no behaviour wakes, nothing runs. A camera you orbit and a gizmo replace the game's, and
 * the editor's interface is loaded from its own URL (`?edit=<url>`, or `npx scenoco-editor`'s), so
 * the editor is never part of the project. Everything here is about the live objects; reading and
 * writing the scene files is the dev server's (`scenoco()` in `@scenoco-three/tools/vite`).
 */

/** What the editor's interface gets: the scene, the selection, and the live objects' own rules. */
export interface EditHost {
  /** What the scene function built. */
  readonly root: Object3D;
  readonly selected: Object3D | null;
  select(node: Object3D | null): void;
  /** The gizmo's mode. */
  setMode(mode: 'translate' | 'rotate' | 'scale'): void;
  /** The gizmo's handles along the world's axes or the object's own — Unity's Global and Local. */
  setSpace(space: 'world' | 'local'): void;
  /** `select`: the selection changed. `transform`: the gizmo let go of a node it moved. */
  on(event: 'select' | 'transform', listener: (node: Object3D | null) => void): void;
  /** Where the element that made this object was written. */
  sourceOf(made: object): Source | undefined;
  behavioursOn(node: Object3D): readonly Behaviour[];
  /** A behaviour's settings: its public fields and their defaults. */
  fieldsOf(behaviour: Behaviour): FieldInfo[];
  /** Set `name` on a live object the way the scene does — R3F's rules, or a behaviour's settings. */
  apply(target: object, name: string, value: unknown): void;
  /** Point the camera at a node. */
  frame(node: Object3D): void;
}

/** Where the interface comes from when the page does not say: `npx scenoco-editor`. */
const DEFAULT_UI = 'http://localhost:5185/editor.js';

/** @internal */
export function edit(build: () => unknown, options: PlayOptions = {}): Game {
  const world = new Scene();
  // A runtime that never steps: what reads `Runtime.current` finds one, and nothing wakes.
  const runtime = new Runtime(world);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const host = options.container ?? document.body;
  host.appendChild(renderer.domElement);
  const camera = new PerspectiveCamera(50, 1, 0.1, 5000);
  camera.position.set(0, 5, 10);
  const size = new Vector2();
  const resize = () => {
    const width = host === document.body ? innerWidth : host.clientWidth;
    const height = host === document.body ? innerHeight : host.clientHeight;
    renderer.setSize(width, height);
    renderer.getSize(size);
    camera.aspect = size.x / size.y;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  const game: Game = { scene: world, camera, renderer, runtime, render: () => renderer.render(world, camera) };
  document.body.classList.add('scenoco-editing');
  void start(game, build, world, camera, renderer).catch((error: unknown) => {
    console.error(error);
    banner(`The editor could not start: ${error instanceof Error ? error.message : String(error)}`);
  });
  return game;
}

/**
 * The scene to edit: the one the game plays, or `?scene=/src/scenes/levels.tsx#Level2` — any
 * scene or prefab function of the project, loaded by the game's own dev server.
 */
async function sceneToEdit(build: () => unknown): Promise<() => unknown> {
  const wanted = new URLSearchParams(location.search).get('scene');
  if (!wanted) return build;
  const [path, name] = wanted.split('#');
  const module = (await import(/* @vite-ignore */ path!)) as Record<string, unknown>;
  const found = name ? module[name] : Object.values(module).find((value) => typeof value === 'function');
  if (typeof found !== 'function') throw new Error(`${path} has no scene function${name ? ` named ${name}` : ''}.`);
  // Built as a tag with no attributes is: a prefab with props destructures an empty object.
  return () => (found as (props: object) => unknown)({});
}

async function start(game: Game, play: () => unknown, world: Scene, camera: PerspectiveCamera, renderer: WebGLRenderer): Promise<void> {
  const built = (await sceneToEdit(play))();
  if (!(built instanceof Object3D)) throw new Error('A scene function must return an element — <Scene>…</Scene>.');
  const content = built instanceof Scene ? built : new Scene().add(built);
  world.background = content.background;
  world.environment = content.environment;
  world.fog = content.fog;
  world.add(content);
  // Start where the game's camera stands, so the first view is the one the player sees.
  let gameCamera: Camera | null = null;
  content.traverse((node) => void (gameCamera ??= (node as Camera).isCamera ? (node as Camera) : null));
  if (gameCamera) {
    content.updateMatrixWorld(true);
    (gameCamera as Camera).matrixWorld.decompose(camera.position, camera.quaternion, new Vector3());
  }

  const [{ OrbitControls }, { TransformControls }] = await Promise.all([
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/controls/TransformControls.js'),
  ]);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.copy(camera.position).add(camera.getWorldDirection(new Vector3()).multiplyScalar(10));
  orbit.update();
  const gizmo = new TransformControls(camera, renderer.domElement);
  world.add(gizmo.getHelper());
  const box = new Box3();
  const outline = new Box3Helper(box, 0x38bdf8);
  outline.visible = false;
  world.add(outline);

  const listeners = { select: [] as ((n: Object3D | null) => void)[], transform: [] as ((n: Object3D | null) => void)[] };
  let selected: Object3D | null = null;
  const editHost: EditHost = {
    root: content,
    get selected() {
      return selected;
    },
    select(node) {
      selected = node;
      if (node) gizmo.attach(node);
      else gizmo.detach();
      outline.visible = node !== null;
      for (const listener of listeners.select) listener(node);
    },
    setMode: (mode) => gizmo.setMode(mode),
    setSpace: (space) => gizmo.setSpace(space),
    on: (event, listener) => void listeners[event].push(listener),
    sourceOf,
    behavioursOn: (node) => behavioursOn(node),
    fieldsOf: (behaviour) => fieldsOf(behaviour.constructor as new () => Behaviour),
    apply(target, name, value) {
      if (target instanceof Behaviour) assignInit(target, { [name]: value });
      else applyProp(target as Record<string, unknown>, name, value, target.constructor.name);
    },
    frame(node) {
      box.setFromObject(node);
      const center = box.getCenter(new Vector3());
      const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
      camera.position.copy(center).add(camera.getWorldDirection(new Vector3()).multiplyScalar(-radius * 3));
      orbit.target.copy(center);
      orbit.update();
    },
  };

  gizmo.addEventListener('dragging-changed', (event) => {
    orbit.enabled = !event.value;
    if (!event.value) for (const listener of listeners.transform) listener(selected);
  });

  // A click — not the end of an orbit drag — picks the nearest object an element made.
  const down = new Vector2();
  const raycaster = new Raycaster();
  renderer.domElement.addEventListener('pointerdown', (event) => down.set(event.clientX, event.clientY));
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (down.distanceTo(new Vector2(event.clientX, event.clientY)) > 4 || gizmo.dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = raycaster.intersectObject(content, true).find((h) => h.object.visible);
    let node: Object3D | null = hit?.object ?? null;
    while (node && !sourceOf(node)) node = node.parent;
    editHost.select(node && node !== content ? node : null);
  });

  renderer.setAnimationLoop(() => {
    orbit.update();
    if (selected) box.setFromObject(selected);
    game.render();
  });

  const params = new URLSearchParams(location.search);
  const url = params.get('edit') || DEFAULT_UI;
  let ui: { mount(host: EditHost): void };
  try {
    ui = (await import(/* @vite-ignore */ url)) as typeof ui;
  } catch {
    banner(`No editor at ${url}. Start one with \`npx scenoco-editor\`, or open ?edit=<its URL>.`);
    return;
  }
  ui.mount(editHost);
}

function banner(text: string): void {
  const note = document.createElement('div');
  note.textContent = text;
  note.style.cssText = 'position:fixed;left:16px;bottom:16px;padding:10px 14px;background:#7f1d1d;color:#fff;font:13px system-ui;border-radius:6px;z-index:1000';
  document.body.appendChild(note);
}
