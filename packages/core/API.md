# API

Every public signature of `@scenoco-three/core`. Read this instead of `src/`. Everything not here
is three.js, as three.js documents it.

```ts
// ── scenes: TSX with no React ──────────────────────────────────────────────────────────────
// A tag is a class you import: <Mesh> is `new Mesh()`, built at once. Lowercase tags do not exist.
//   args={[1, 2, 3]}             the constructor's arguments
//   position={[0, 1, 0]}         a value goes through the property's own set/copy: [x, y, z], '#ff8800', a scalar
//   shadow-mapSize={[2048, 2048]} a dashed name reaches inside
//   <MeshStandardMaterial />     geometry and material attach to their parent; anything else needs attach="fog"
//   <Spinner speed={2} />        a Behaviour becomes a component of its parent; its props are its public fields
//   ref={hero}                   const hero = ref<Mesh>() inside the scene function; a behaviour field takes it too
// A scene file only declares: no loops, branches, handlers or calls — `scenoco check` says what to write instead.

function play(scene: () => JSX.Element, options?: { container?: HTMLElement; fixedDelta?: number }): Game;
interface Game {
  readonly scene: Scene;            // the one scene that draws; SceneManager swaps what is in it
  readonly camera: PerspectiveCamera;   // the loaded scene's first camera, or a default
  readonly renderer: WebGLRenderer; // shadows, tone mapping: set them as three.js documents
  render: () => void;               // replace to draw another way: game.render = () => composer.render()
}
function ref<T>(): { current: T | null };
function instantiate(prefab: (() => JSX.Element) | Model, options?: {   // a prefab is a function returning TSX, or a loaded model
  parent?: Object3D;                                  // default: the scene
  position?: Vector3 | [number, number, number];
  rotation?: Euler | [number, number, number];
  quaternion?: Quaternion;
}): Object3D;                                         // awake runs now, start next frame: set fields in between
function sourceOf(made: object): { fileName: string; lineNumber: number; columnNumber: number } | undefined;  // dev only

const SceneManager: {
  load(scene: () => JSX.Element): Scene;          // the last loaded scene goes at the end of the frame
  loadAdditive(scene: () => JSX.Element): Scene;  // beside what is loaded
  readonly activeScene: Scene | null;
};
function dontDestroyOnLoad(target: Object3D | Behaviour): void;  // in awake: this tree outlives every later load

// ── behaviours ────────────────────────────────────────────────────────────────────────────
abstract class Behaviour<N extends Object3D = Object3D> {
  readonly node: N;                     // the three.js object it is attached to
  enabled: boolean;                     // false: no hooks; toggling calls onEnable/onDisable
  readonly isActiveAndEnabled: boolean; // receiving hooks now
  readonly isDestroyed: boolean;
  readonly camera: PerspectiveCamera;   // the camera the scene is drawn with — Unity's Camera.main

  // hooks — all optional, camelCase Unity names
  awake?(): void;  onEnable?(): void;  start?(): void;
  fixedUpdate?(dt: number): void;  update?(dt: number): void;  lateUpdate?(dt: number): void;
  onDisable?(): void;  onDestroy?(): void;

  getComponent<T>(type: Class<T>): T | null;            // same node
  getComponents<T>(type: Class<T>): T[];
  getComponentInChildren<T>(type: Class<T>): T | null;  // this node and below
  getComponentsInChildren<T>(type: Class<T>): T[];
  getComponentInParent<T>(type: Class<T>): T | null;    // this node and above

  listen<A extends unknown[]>(event: Event<A>, fn: (...args: A) => void): void;  // unsubscribes on destroy
  startCoroutine(body: Generator<Yieldable>): Coroutine;  // this.startCoroutine(this.spawnWaves())
  stopCoroutine(c: Coroutine): void;
  stopAllCoroutines(): void;
}

// Coroutines — a generator method, *spawnWaves() { while (true) { yield new WaitForSeconds(2); … } }
type Yieldable = null                       // one frame
  | WaitForSeconds | WaitForSecondsRealtime  // new WaitForSeconds(0.5): game time, stops at timeScale 0
  | WaitUntil | WaitWhile                    // new WaitUntil(() => this.ready): checked each frame after update
  | CustomYieldInstruction                   // extend it: get keepWaiting(): boolean
  | YieldInstruction                         // the base of all of the above
  | Coroutine                                // yield this.startCoroutine(this.intro()): wait for it to finish
  | Promise<unknown>;
class Coroutine { readonly isDone: boolean; stop(): void }

const Time: {
  readonly deltaTime: number;          // this frame, scaled; fixedDeltaTime inside fixedUpdate
  readonly time: number;               // game seconds since start
  timeScale: number;                   // 1 normal, 0 paused, 0.5 slow motion
  readonly unscaledDeltaTime: number;  readonly unscaledTime: number;   // real time, for pause menus
  readonly fixedDeltaTime: number;     readonly frameCount: number;
};

class Event<A extends unknown[] = []> {   // a class field: readonly onScored = new Event<[points: number]>()
  emit(...args: A): void;
  on(fn: (...args: A) => void): void;  off(fn): void;  once(fn): void;  clear(): void;
}

function destroy(target: Object3D | Behaviour): void;  // at the end of the frame, with children and their behaviours
function findObjectOfType<T>(type: Class<T>): T | null;
function findObjectsOfType<T>(type: Class<T>): T[];   // skips what is being destroyed
function sendMessage(node: Object3D, method: string, ...args: unknown[]): void;
function broadcastMessage(node: Object3D, method: string, ...args: unknown[]): void;  // and its children
function addComponent<T>(node: Object3D, type: Class<T>, init?: Partial<Fields<T>>): T;
// and as free functions, the lookups above: getComponent(node, T), getComponents, getComponentInChildren,
// getComponentsInChildren, getComponentInParent. three's Object3D gains them all as methods, and addComponent.

// ── input: Unity's Input ──────────────────────────────────────────────────────────────────
const Input: {
  getKey(key: KeyCode): boolean;  getKeyDown(key: KeyCode): boolean;  getKeyUp(key: KeyCode): boolean;
  getMouseButton(b?: MouseButton): boolean;  getMouseButtonDown(b?: MouseButton): boolean;  getMouseButtonUp(b?: MouseButton): boolean;
  getAxis(axis: AxisName): number;     // 'Horizontal' | 'Vertical' | …, smoothed; getAxisRaw: -1/0/1
  getAxisRaw(axis: AxisName): number;
  getButton(name: ButtonName): boolean;  getButtonDown(name: ButtonName): boolean;  getButtonUp(name: ButtonName): boolean;
  // ButtonName: 'Fire1' 'Fire2' 'Fire3' 'Jump' 'Submit' 'Cancel' — or any page element's
  //   <button data-button="Pause">, read with getButtonDown('Pause') like a key
  setAxis(axis: AxisName, value: number | null): void;      // a virtual stick; null hands it back to the keys
  setButton(name: ButtonName, down: boolean | null): void;
  readonly overriddenAxes: AxisName[];
  readonly mousePosition: Vector2;     // CSS pixels on the canvas
  readonly pointer: Vector2;           // normalized device coordinates, for Raycaster.setFromCamera
  readonly mouseDelta: Vector2;  readonly mouseScrollDelta: Vector2;
};
const KeyCode: { A … Z; Alpha0 … Alpha9; F1 … F12; LeftArrow; RightArrow; UpArrow; DownArrow;
  Space; Return; Escape; Tab; Backspace; LeftShift; LeftControl; … };   // Unity's names: KeyCode.A, KeyCode.LeftArrow, KeyCode.Return
const MouseButton: { Left: 0; Middle: 1; Right: 2 };
const AXES: Record<AxisName, …>;  const AXIS_NAMES: AxisName[];   // Unity's default axes and their keys

// ── assets: made once in a .ts module, named from scenes ──────────────────────────────────
// What a node's own elements built (<BoxGeometry> inside a <Mesh>) is freed when the node is destroyed —
// a scene load included. What a scene only names in a prop (material={paint.wall}) is never freed by it.
function sharedTexture(url: string, settings?: TextureSettings): Texture;   // one per URL; the image arrives later
function sharedModel(url: string): Model;    // a glTF: await loadAssets(model), then model.instantiate()
class Model extends Asset<GLTF> { readonly clips: AnimationClip[]; instantiate(): Object3D }
// A model's clips play through an Animator on its root, or on a node above it. No controller: the
// states are the clips' names, and every state loops.
//   const hero = instantiate(heroModel, { parent: this.node }); this.animator = hero.addComponent(Animator);
class Animator extends Behaviour {
  speed: number;                                                         // 1 normal, 0 frozen
  play(stateName: string, layer?: number, normalizedTime?: number): void;   // the playing state again: nothing
  crossFade(stateName: string, normalizedTransitionDuration: number): void; // a fraction of the current state's length
  crossFadeInFixedTime(stateName: string, fixedTransitionDuration: number): void;  // seconds
  getCurrentAnimatorStateInfo(layer?: number): { length: number; normalizedTime: number; speed: number; isName(name: string): boolean };
  isInTransition(layer?: number): boolean;    // normalizedTime counts loops: >= 1 has played through once
}
abstract class Asset<T> { readonly url: string; readonly isLoaded: boolean; readonly value: T; load(): Promise<T> }
function loadAssets(...assets: Loadable[]): Promise<void>;   // await before play() for what must be ready
```
