import { Box3, Box3Helper, Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, type Camera, type Light, type Material, type Texture, type WebGLRenderer } from 'three';
import { Behaviour } from '../kernel/Behaviour.js';
import { Runtime, assignInit, behavioursOn, destroy, flushDestroyed, wake } from '../kernel/runtime.js';
import { INSTANCE, applyProp, givenOf, isPrefab, jsxDEV, keepGiven, ownOf, prefabOf, setGiven, sourceOf } from '../jsx.js';
import { setHeld, setView, isHeld } from '../observe.js';
import type { EditHost, Transform } from './EditHost.js';
import { openedScene, write, writeOpened } from './session.js';
import { EditorGrid } from './grid.js';
import { Flythrough } from './flythrough.js';
import { applyArguments, settableArgument } from './arguments.js';
import { fingerPads } from './gizmo.js';

/**
 * The editor itself, over the running game: paused, it looks through its own camera — orbit, and
 * Unity's flythrough on the right button — with a gizmo, an outline round the selection and a ground
 * grid; every edit goes through `EditHost` to the interface the dev server serves.
 */

const EDITOR = '/__scenoco/editor.js';

const spawnedNodes = new WeakSet<Object3D>();
const spawnedFrom = new WeakMap<Object3D, Function>();

/** @internal `instantiate` marks what it made, and from which prefab, so the editor knows no scene file wrote it. */
export function markSpawned(node: Object3D, prefab?: Function): void {
  spawnedNodes.add(node);
  if (prefab) spawnedFrom.set(node, prefab);
}

/**
 * @internal A behaviour's field set from the editor, then its `onValidate` — Unity's, so what it
 * built from the field in `start` follows. Its errors are the game's: reported, not let loose.
 */
export function setField(behaviour: Behaviour, name: string, value: unknown): void {
  assignInit(behaviour, { [name]: value });
  validate(behaviour);
}

function validate(behaviour: Behaviour): void {
  try {
    behaviour.onValidate?.();
  } catch (error) {
    console.error(`${behaviour.constructor.name}.onValidate threw:`, error);
  }
}

/**
 * The behaviours a moved node concerns: its own, and every one a scene gave it to, or a node above it
 * — `knots={points}` follows a point moved under `points`. Only what the scene wrote counts, so what
 * a behaviour keeps for itself (the copies it placed) never makes it build again under the gizmo.
 */
function concerned(scene: Object3D, node: Object3D): Set<Behaviour> {
  const found = new Set(behavioursOn(node));
  const holds = (value: unknown) => {
    if (!(value instanceof Object3D)) return false;
    for (let n: Object3D | null = node; n; n = n.parent) if (n === value) return true;
    return false;
  };
  scene.traverse((n) => {
    for (const b of behavioursOn(n)) {
      const given = givenOf(b);
      if (given && Object.keys(given).some((key) => holds((b as unknown as Record<string, unknown>)[key]))) found.add(b);
    }
  });
  return found;
}

/** The editor's own drawing, set while it is open. */
let drawing: ((camera: Camera) => void) | null = null;

/** @internal after the game drew: the editor's own things — gizmo, grid, outline — over it. */
export function drawEditor(camera: Camera): void {
  drawing?.(camera);
}

export interface Editor {
  /** The clock was held from outside: look through the editor's camera. */
  held(): void;
}

export async function startEditor(
  scene: Scene,
  runtime: Runtime,
  renderer: WebGLRenderer,
  gameCamera: () => Camera | null,
  frame: (dt: number) => void,
  closed: () => void,
): Promise<Editor> {
  const [{ OrbitControls }, { TransformControls }, ui] = await Promise.all([
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/controls/TransformControls.js'),
    import(/* @vite-ignore */ EDITOR).catch(() => {
      throw new Error(`No editor at ${EDITOR}: the project's vite.config needs scenoco() from @scenoco-three/tools/vite, and @scenoco-three/editor installed.`);
    }) as Promise<{ mount(host: EditHost): () => void }>,
  ]);

  const camera = new PerspectiveCamera(50, 1, 0.05, 5000);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enabled = false;
  // A pinch or the wheel goes towards what is under the fingers or the cursor, as in Unity.
  orbit.zoomToCursor = true;
  const fly = new Flythrough(camera, renderer.domElement, orbit);
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.enabled = false;
  const overlay = new Scene();
  overlay.add(gizmo.getHelper());
  const grid = new EditorGrid();
  overlay.add(grid);
  const box = new Box3();
  const outline = new Box3Helper(box, 0x38bdf8);
  outline.visible = false;
  overlay.add(outline);
  const size = new Vector2();

  const listeners = { select: [] as ((n: Object3D | null) => void)[], moved: [] as ((n: Object3D, before: Transform) => void)[] };
  let selected: Object3D | null = null;

  /** Paused, the editor looks through its own camera, from where the game's stood the first time. */
  let placed = false;
  const lookThrough = (paused: boolean) => {
    orbit.enabled = paused;
    fly.enabled = paused;
    gizmo.enabled = paused;
    grid.visible = paused;
    if (paused && selected) gizmo.attach(selected);
    else gizmo.detach();
    if (paused && !placed) {
      placed = true;
      const from = gameCamera();
      if (from) {
        from.updateMatrixWorld();
        from.matrixWorld.decompose(camera.position, camera.quaternion, new Vector3());
      } else camera.position.set(0, 5, 10);
      orbit.target.copy(camera.position).add(camera.getWorldDirection(new Vector3()).multiplyScalar(10));
    }
    setView(runtime, paused ? camera : null);
  };

  const replaced = new WeakMap<object, object>();
  /** What isolation hid, and whether it was visible before. */
  const isolated = new Map<Object3D, boolean>();

  /** A prefab or component called again with one prop changed, its node swapped in where the old one stood. */
  const rebuild = (node: Object3D, props: Record<string, unknown>) => {
    const made = prefabOf(node)!;
    const fresh = jsxDEV(made.prefab, props, undefined, false, sourceOf(node));
    if (!(fresh instanceof Object3D)) return;
    const parent = node.parent!;
    parent.add(fresh);
    parent.children.splice(parent.children.indexOf(fresh), 1);
    parent.children.splice(parent.children.indexOf(node), 0, fresh);
    keepGiven(node, fresh);
    replaced.set(node, fresh);
    destroy(node);
    flushDestroyed();
    wake(fresh);
    if (selected === node) host.select(fresh);
  };

  const host: EditHost = {
    scene,
    get selected() {
      return selected;
    },
    select(node) {
      selected = node;
      if (node && gizmo.enabled) gizmo.attach(node);
      else gizmo.detach();
      outline.visible = node !== null;
      for (const listener of listeners.select) listener(node);
    },
    get paused() {
      return isHeld(runtime);
    },
    pause() {
      setHeld(runtime, true);
      lookThrough(true);
    },
    play() {
      setHeld(runtime, false);
      lookThrough(false);
    },
    step() {
      host.pause();
      frame(1 / 60);
    },
    reset(reach = 'frame') {
      write(reach);
      location.reload();
    },
    openScene(opened, reach) {
      writeOpened(opened);
      host.reset(reach);
    },
    get openedScene() {
      return openedScene();
    },
    setMode: (mode) => gizmo.setMode(mode),
    on: ((event: 'select' | 'moved', listener: never) => void listeners[event].push(listener)) as EditHost['on'],
    sourceOf,
    givenOf,
    madeBy(node) {
      const made = prefabOf(node);
      if (made) return { name: made.prefab.name, prefab: isPrefab(made.prefab), props: made.props, fn: made.prefab };
      const from = spawnedFrom.get(node);
      return from && { name: from.name, prefab: true, props: {}, fn: from };
    },
    own(node) {
      // A spawned copy has no tag: its root's own element is the one `sourceOf` already answers for.
      return ownOf(node) ?? (spawnedFrom.has(node) ? { source: sourceOf(node), given: givenOf(node) } : undefined);
    },
    isolate(node) {
      for (const [hidden, was] of isolated) hidden.visible = was;
      isolated.clear();
      if (!node) return;
      // Everything off the way from the root to the node, and beside it, is hidden; the way itself
      // stays, and so do the lights, or what is isolated would sit in the dark.
      for (let keep: Object3D = node; keep.parent; keep = keep.parent) {
        for (const sibling of keep.parent.children) {
          if (sibling === keep || isolated.has(sibling) || (sibling as Light).isLight) continue;
          isolated.set(sibling, sibling.visible);
          sibling.visible = false;
        }
      }
    },
    spawned(node) {
      for (let n: Object3D | null = node; n; n = n.parent) if (spawnedNodes.has(n)) return true;
      return false;
    },
    behavioursOn: (node) => behavioursOn(node),
    parameters(made) {
      const args = givenOf(made)?.args;
      if (!Array.isArray(args)) return [];
      return args.map((_, i) => ({ settable: settableArgument(made, args, i) }));
    },
    current(target) {
      while (replaced.has(target)) target = replaced.get(target)!;
      return target;
    },
    written(target, name, value) {
      setGiven(host.current(target), name, value);
    },
    apply(target, name, value, declared = false) {
      target = host.current(target);
      if (name === 'args' && !(target instanceof Behaviour)) {
        applyArguments(target as Record<string, unknown>, value as unknown[]);
        if (target instanceof Object3D) for (const b of concerned(scene, target)) validate(b);
        settle();
        return;
      }
      const made = target instanceof Object3D ? prefabOf(target) : undefined;
      // A prefab's tag places and names its root; every other attribute of a function's tag is a prop.
      const prop = made && !(isPrefab(made.prefab) && (INSTANCE as readonly string[]).includes(name));
      // A prop the element passed, or one the function declares, and not on a tag with children: they were built already.
      if (made && prop && (declared || name in made.props) && made.props.children === undefined) rebuild(target as Object3D, { ...made.props, [name]: value });
      else if (target instanceof Behaviour) setField(target, name, value);
      else {
        applyProp(target as Record<string, unknown>, name, value, target.constructor.name);
        // The tag's transform and name, kept for when one of its props calls the prefab again.
        if (made && !prop) made.props = { ...made.props, [name]: value };
        if ((target as Material).isMaterial || (target as Texture).isTexture) (target as Material).needsUpdate = true;
        if (target instanceof Object3D) for (const b of concerned(scene, target)) validate(b);
      }
      settle();
    },
    frame(node) {
      if (!host.paused) host.pause();
      box.setFromObject(node);
      // A node with nothing to draw — a spline's knot, a spawn point — is framed where it stands.
      const center = box.isEmpty() ? node.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
      const radius = box.isEmpty() ? 2 : Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
      camera.position.copy(center).add(camera.getWorldDirection(new Vector3()).multiplyScalar(-radius * 3));
      orbit.target.copy(center);
    },
    close() {
      host.isolate(null);
      host.select(null);
      host.play();
      unmount();
      orbit.dispose();
      fly.dispose();
      gizmo.dispose();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointerdown', press, { capture: true });
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
      renderer.domElement.removeEventListener('wheel', retarget, { capture: true });
      drawing = null;
      closed();
    },
  };

  /**
   * What an edit set going, finished now rather than on a frame that may not come while the clock is
   * held: what `onValidate` placed starts, and what it destroyed goes.
   */
  const settle = () => {
    runtime.startPending();
    flushDestroyed();
  };
  // Every step of a drag, so what depends on the node follows it under the gizmo.
  gizmo.addEventListener('objectChange', () => {
    if (!selected) return;
    for (const b of concerned(scene, selected)) validate(b);
    settle();
  });

  let before: Transform | null = null;
  gizmo.addEventListener('dragging-changed', (event) => {
    orbit.enabled = !event.value && !fly.flying;
    const node = selected;
    if (!node) return;
    if (event.value) before = { position: node.position.toArray(), rotation: [node.rotation.x, node.rotation.y, node.rotation.z], scale: node.scale.toArray() };
    else if (before) for (const listener of listeners.moved) listener(node, before);
  });

  // A tap while paused — not the end of an orbit drag — picks the nearest object an element wrote.
  const at = new Vector2();
  const raycaster = new Raycaster();
  const down = (event: PointerEvent) => void at.set(event.clientX, event.clientY);
  const up = (event: PointerEvent) => {
    if (!host.paused || event.button !== 0 || at.distanceTo(new Vector2(event.clientX, event.clientY)) > 4 || gizmo.dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    let node: Object3D | null = raycaster.intersectObject(scene, true).find((hit) => hit.object.visible)?.object ?? null;
    while (node && !sourceOf(node)) node = node.parent;
    host.select(node);
  };
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);

  // Orbit turns, pans and zooms at speeds that scale with the distance to its target. Before each
  // gesture the target moves to what is straight ahead — along the view, so nothing turns — and so
  // the speeds suit what is being looked at, not a framed object's middle or a point in the air.
  const pressed = new Set<number>();
  const ahead = new Vector2();
  const retarget = () => {
    if (!host.paused || fly.flying || gizmo.dragging) return;
    raycaster.setFromCamera(ahead, camera);
    const hit = raycaster.intersectObject(scene, true).find((h) => h.object.visible);
    if (!hit) return;
    orbit.target.copy(camera.position).add(camera.getWorldDirection(new Vector3()).multiplyScalar(Math.max(hit.distance, 0.5)));
  };
  // Capture comes first on the canvas: the target is moved before orbit reads it.
  const press = (event: PointerEvent) => {
    fingerPads(gizmo, event.pointerType === 'touch');
    // A second finger joins a gesture already going: the target stays.
    if (pressed.size === 0) retarget();
    pressed.add(event.pointerId);
  };
  const release = (event: PointerEvent) => void pressed.delete(event.pointerId);
  renderer.domElement.addEventListener('pointerdown', press, { capture: true });
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  renderer.domElement.addEventListener('wheel', retarget, { capture: true, passive: true });

  let last = performance.now();
  drawing = (drawn) => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (host.paused) {
      renderer.getSize(size);
      camera.aspect = size.x / size.y;
      camera.updateProjectionMatrix();
      fly.update(dt);
      // Orbit controls turn the camera to their target: not while it looks around on its own.
      if (!fly.flying) orbit.update();
      grid.follow(camera);
    }
    if (selected) box.setFromObject(selected);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlay, drawn);
    renderer.autoClear = auto;
  };

  const unmount = ui.mount(host);
  lookThrough(host.paused);
  return { held: () => lookThrough(true) };
}
