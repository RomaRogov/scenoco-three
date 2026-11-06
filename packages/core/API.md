# API

Every public signature of `@scenoco-three/core`. Read this instead of `src/`. Everything not here
is three.js, as three.js documents it.

From 1.0, semantic versioning covers what this file documents: a minor release adds to it, and only a
major one changes or removes. The exports core has for packages and for the editor — `System`,
`service`, `declareMessages`, `wake`, `writtenOf`, `Runtime` and the editor's types — are not listed
here, and may change in a minor release; a package written against them names the core version it needs.

```ts
// ── scenes: TSX with no React ──────────────────────────────────────────────────────────────
// A tag is a class you import: <Mesh> is `new Mesh()`, built at once. Lowercase tags do not exist.
//   args={[1, 2, 3]}             the constructor's arguments
//   position={[0, 1, 0]}         a value goes through the property's own set/copy: [x, y, z], '#ff8800', a scalar
//   shadow-mapSize={[2048, 2048]} a dashed name reaches inside
//   <MeshStandardMaterial />     geometry and material attach to their parent; anything else needs attach="fog"
//   <Object3D attach="target" /> a node with attach is added and assigned: a light's target, moving with it
//   <Spinner speed={2} />        a Behaviour becomes a component of its parent; its props are its public fields
//   ref={hero}                   const hero = ref<Mesh>() inside the scene function; a behaviour field takes it too,
//                                and holds the object itself: target: Mesh | null = null, never a Ref
//   <Rigidbody2D ref={wheel} />  a behaviour's tag takes ref too: the component, for a field such as connectedBody
//   <Tower projectile={Arrow} /> a prefab as a setting: projectile: Prefab | null = null
//   <Pad position={[4, 0, 2]} /> a prefab(…) returns one root; its tag's position, rotation, scale and name are
//                                that root's, as a Unity instance's Transform — the prefab's props are the rest
// A scene file only declares: no loops, branches, handlers or calls — `scenoco check` says what to write instead.

function play(scene: () => JSX.Element, options?: {
  container?: HTMLElement;         // default document.body: the game is the page; an element — a React app's <div> — it fills and follows
  fixedDelta?: number;
  renderer?: WebGLRenderer;         // your own, for what only its constructor sets: new WebGLRenderer({ alpha: true }); none antialiases by default
  autoCamera?: boolean;             // false: play picks and fits no camera — set game.camera and size it yourself
}): Game;
interface Game {
  readonly scene: Scene;            // the one scene that draws; SceneManager swaps what is in it
  camera: PerspectiveCamera | OrthographicCamera | null;   // the loaded scene's first visible camera, fitted to the canvas;
                                    // hidden or removed, the next one draws. Settable; with autoCamera: false, only what you set
  readonly renderer: WebGLRenderer; // shadows, tone mapping: set them as three.js documents
  render: () => void;               // replace to draw another way: game.render = () => composer.render()
  dispose: () => void;              // stop it and free the canvas; onDestroy runs — a React effect's cleanup
}
function gameOf(node: Object3D): Game | null;       // the game this node runs in; null under simulate
function simulate(scene: () => JSX.Element, options?: {
  fixedDelta?: number;
  size?: [number, number];          // the screen in pixels: Screen, and what pointers are on. Default 1920×1080
  page?: string;                    // the page as text — import page from '../index.html?raw' — its body, without
                                    // scripts, in jsdom's document until dispose: the UI, and data-buttons to click
}): Simulation;                     // no canvas, no loop:
                                    // a test in Node or jsdom (Vitest) steps it — the game's rules, frame-exact
interface Simulation {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera | OrthographicCamera | null;   // what this.camera is; nothing is drawn
  step(frames?: number, dt?: number): void;                         // default 1 frame of 1/60 s
  until(condition: () => boolean, maxFrames?: number): boolean;     // steps until true: whether it came true (600);
                                                                    // false warns in the console, naming the condition
  press(key: KeyCode, frames?: number): void;                       // held 6 frames, then let go
  keyDown(key: KeyCode): void;
  keyUp(key: KeyCode): void;
  click(target: [x: number, y: number] | string): void;             // a point in pixels, or a data-button by name
  pointerDown(x: number, y: number): void;  pointerMove(x: number, y: number): void;  pointerUp(): void;
  swipe(from: [number, number], to: [number, number], frames?: number): void;   // press, drag, lift (8 frames)
  worldToScreen(position: Vector3): [number, number];               // where to aim a pointer
  dispose(): void;                                                  // onDestroy runs; input let go
}
function ref<T>(): { current: T | null };
function prefab<F extends (props: P) => JSX.Element>(build: F): F;  // export const Coin = prefab(() => <Mesh>…</Mesh>): one root;
                                                                    // a function not wrapped is a plain component — its tag is its props.
                                                                    // Props are typed by their defaults — prefab(({ width = 1 }) => …) —
                                                                    // or by a written type: ({ width }: { width: number })
type Prefab<T extends Object3D = Object3D>;   // what prefab() makes, taking no props — as a field's type, or instantiate's
function instantiate<T extends Object3D>(prefab: Prefab<T> | Model, options?: {   // a prefab, or a loaded model
  parent?: Object3D;                                  // default: the active scene — the next load destroys it, as in Unity
  position?: Vector3 | [number, number, number];
  rotation?: Euler | [number, number, number];
  quaternion?: Quaternion;
}): T;                                                // awake runs now, start next frame: set fields in between
function sourceOf(made: object): { fileName: string; lineNumber: number; columnNumber: number } | undefined;  // dev only

const SceneManager: {
  load(scene: () => JSX.Element): void;          // from a frame, at the end of it; from outside one, now
  loadAdditive(scene: () => JSX.Element): void;  // beside what is loaded
  sceneLoaded: Event<[scene: Scene]>;            // after its awake and onEnable, before its start
  readonly activeScene: Scene | null;
};
// A load, in order:
//   the rest of this frame    the old scene runs on, and activeScene is still the old one
//   the new scene is built    constructors and attributes; a throw here leaves the old scene running
//   old: onDisable, onDestroy everything but what dontDestroyOnLoad kept; what its elements built is freed
//   background, environment and fog, and backgroundBlurriness, backgroundIntensity, backgroundRotation,
//                             environmentIntensity, environmentRotation — Unity's RenderSettings — are the new
//                             scene's, unset ones too: a level with no fog has none, whichever came before it.
//                             From then on its <Scene>'s own properties are what draws: a behaviour on it may
//                             set scene.environment at any time. For a setting across levels, set it on
//                             game.scene from a kept behaviour that listens to sceneLoaded
//   new: awake, onEnable      sceneLoaded fires
//   the next frame            new: start. Input stays as it is; what instantiate placed in the old scene went with it
function dontDestroyOnLoad(target: Object3D | Behaviour): void;  // in awake: this tree outlives every later load.
                                                                 // Marking a child keeps its whole tree: move it to the scene's root first

// ── behaviours ────────────────────────────────────────────────────────────────────────────
abstract class Behaviour<N extends Object3D = Object3D> {   // Behaviour<Mesh>: goes only on a node typed Mesh — instantiate<Mesh>(P)
  readonly node: N;                     // the three.js object it is attached to
  enabled: boolean;                     // false: no hooks; toggling calls onEnable/onDisable
  readonly isActiveAndEnabled: boolean; // receiving hooks now
  readonly isDestroyed: boolean;
  readonly camera: PerspectiveCamera | OrthographicCamera;   // the camera the scene is drawn with — Unity's Camera.main

  // hooks — all optional, camelCase Unity names
  awake?(): void;  onEnable?(): void;  start?(): void;
  fixedUpdate?(dt: number): void;  update?(dt: number): void;  lateUpdate?(dt: number): void;
  onDisable?(): void;  onDestroy?(): void;
  onValidate?(): void;                  // Unity's OnValidate: after the editor changed a field, or moved its node or one it was given — redo what start did

  getComponent<T>(type: BehaviourType<T>): T | null;    // same node
  getComponents<T>(type: BehaviourType<T>): T[];
  getComponentInChildren<T>(type: BehaviourType<T>): T | null;  // this node and below
  getComponentsInChildren<T>(type: BehaviourType<T>): T[];
  getComponentInParent<T>(type: BehaviourType<T>): T | null;    // this node and above

  listen<A extends unknown[]>(event: Event<A>, fn: (...args: A) => void): void;  // unsubscribes on destroy
  startCoroutine(body: Generator<unknown, unknown, any>): Coroutine;  // this.startCoroutine(this.spawnWaves())
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

// Tweens — a value moving over time. They start by themselves, on the game's clock, and chain.
//   node.doMove(to, 0.5).setEase(Ease.OutBack).onComplete(() => destroy(node));
//   Tween.sequence().append(node.doScale(2, 0.2)).join(material.doFade(0, 0.2)).appendInterval(0.1).appendCallback(next);
//   el.classList.add('bump'); Tween.delayedCall(0.12, () => el.classList.remove('bump')).setUpdate(true);
//   yield node.doLocalMoveY(1, 0.3).waitForCompletion();       // in a coroutine
// three's Object3D gains these. A tween on a node ends when the node leaves the game, without onComplete:
//   doMove doMoveX/Y/Z(to, s) to a world position      doLocalMove doLocalMoveX/Y/Z(to, s) to three's position
//   doRotate doLocalRotate(angles, s, mode?)           Vector3: degrees, Euler: radians; mode: RotateMode.Fast | FastBeyond360
//   doRotateQuaternion doLocalRotateQuaternion(q, s)   doLookAt(worldPoint, s)
//   doScale(number | Vector3, s)  doScaleX/Y/Z(to, s)  doJump doLocalJump(to, power, jumps, s)
//   doPunchPosition/Rotation/Scale(amount: Vector3, s, vibrato = 10, elasticity = 1)   rotation's in degrees
//   doShakePosition/Rotation/Scale(s, strength = 1, vibrato = 10)   rotation's in degrees, 90 by default
//   doKill(complete?)  doComplete()                    every tween on this node
// Material: doColor(color, s), doFade(opacity, s) (makes it transparent), doFloat(to, 'property', s).
// Light: doColor, doIntensity. PerspectiveCamera: doFieldOfView. OrthographicCamera: doOrthoSize.
class Tween {
  static to<T extends Tweenable>(get: () => T, set: (value: T) => void, to: T, duration: number): Tween;   // number, Vector2/3/4, Color, Quaternion
  static float(from: number, to: number, duration: number, fn: (value: number) => void): Tween;
  static delayedCall(seconds: number, fn: () => void): Tween;
  static sequence(): Sequence;
  static kill(target: object, complete?: boolean): void;   static killAll(complete?: boolean): void;
  timeScale: number;
  setEase(ease: EaseFunction): this;                 // Ease.OutQuad unless set; any (t) => t is an ease
  setDelay(seconds: number): this;
  setLoops(loops: number, type?: LoopType): this;    // -1 for ever; LoopType.Restart | Yoyo | Incremental
  setRelative(relative?: boolean): this;             // the end value is added to where it starts
  from(value?: Tweenable): this;                     // from there, or from its end value, to where it is now
  setUpdate(unscaled: boolean): this;                // true: real time, a pause does not stop it
  setLink(link: Object3D | Behaviour): this;         // ends with it: for a tween not on a node, or its callbacks' owner
  setAutoKill(autoKill: boolean): this;              // false: stays when it ends, for restart
  setTarget(target: object): this;                   // what Tween.kill finds it by
  onStart(fn): this;  onUpdate(fn): this;  onStepComplete(fn): this;  onComplete(fn): this;  onKill(fn): this;
  pause(): this;  play(): this;  restart(): this;  complete(): this;  kill(complete?: boolean): void;
  isActive(): boolean;  isPlaying(): boolean;
  waitForCompletion(): WaitUntil;                    // or until it is killed
}
class Sequence extends Tween {                       // what goes in runs from here
  append(tween: Tween): this;  prepend(tween: Tween): this;  join(tween: Tween): this;  insert(at: number, tween: Tween): this;
  appendInterval(seconds: number): this;  appendCallback(fn: () => void): this;  insertCallback(at: number, fn: () => void): this;
}
const Ease;  // Linear, and In, Out, InOut of Sine Quad Cubic Quart Quint Expo Circ Elastic Back Bounce: Ease.InOutSine

const Mathf: {   // Unity's, where JavaScript's Math spells it differently; Math.max/pow/round stay JS's
  clamp(v, min, max): number;  clamp01(v): number;  lerp(a, b, t): number;  lerpUnclamped(a, b, t): number;
  inverseLerp(a, b, v): number;  smoothStep(from, to, t): number;  moveTowards(current, target, maxDelta): number;
  repeat(t, length): number;  pingPong(t, length): number;  deltaAngle(a, b): number;  lerpAngle(a, b, t): number;
  approximately(a, b): boolean;
  perlinNoise(x, y): number;   // about 0..1, features a unit apart: Mathf.perlinNoise(x * 0.1 + seed, z * 0.1)
};

const Random: {   // Unity's: one seeded generator; Random.initState(level) repeats a level's layout
  initState(seed): void;  state: RandomState;   // save state and put it back to replay the same numbers
  readonly value: number;                       // 0 up to 1
  range(min, max): number;  rangeInt(min, max): number;   // rangeInt(0, items.length): a whole number, max excluded
  readonly insideUnitCircle: Vector2;  readonly insideUnitSphere: Vector3;  readonly onUnitSphere: Vector3;
  readonly rotation: Quaternion;  colorHSV(hueMin?, hueMax?, satMin?, satMax?, valueMin?, valueMax?): Color;
};

const Screen: {   // Unity's: the canvas, in CSS pixels as Input.mousePosition; changes only on a resize
  readonly width: number;  readonly height: number;
};

class UIDocument extends Behaviour {   // Unity's, with Scale With Screen Size: <UIDocument referenceResolution={[1280, 720]} />
  element: string;                   // the id of the UI's root element, 'ui'
  referenceResolution: Vector2;      // the size the UI is designed at: its CSS px are reference pixels, as in USS
  match: number;                     // 0 matches the screen's width, 1 its height, as Unity blends them
  readonly rootVisualElement: HTMLElement;   // the root; it lets the pointer through, a control says pointer-events: auto
  readonly scale: number;            // screen pixels per reference pixel
}

const QualitySettings: {   // Unity's: levels for every running game; nothing changes until the game sets one
  levels: QualityLevel[];    // lowest first; default Low, Medium, High. Change them before setting one
  readonly names: string[];
  getQualityLevel(): number;                 // 2 until set
  setQualityLevel(index: number): void;      // applied at once, from how the renderer was set up: set it up first
  activeQualityLevelChanged: Event<[previous: number, current: number]>;
  readonly shadows: ShadowQuality;  readonly renderScale: number;  readonly postProcessing: boolean;   // the active level's
};
interface QualityLevel {
  name: string;
  shadows: ShadowQuality;    // ShadowQuality.Disable, HardOnly (three's BasicShadowMap), All (the renderer's shadowMap.type)
  renderScale: number;       // URP's: the pixel ratio the game set up, times this. Low is 0.75
  postProcessing: boolean;   // whether a Volume draws its effects (@scenoco-three/postprocessing); Low has none
}

const PlayerPrefs: {   // Unity's, on localStorage; kept in memory for the visit where storage is refused
  getInt(key, defaultValue = 0): number;  setInt(key, value): void;
  getFloat(key, defaultValue = 0): number;  setFloat(key, value): void;
  getString(key, defaultValue = ''): string;  setString(key, value): void;
  hasKey(key): boolean;  deleteKey(key): void;  deleteAll(): void;  save(): void;
};

class Event<A extends unknown[] = []> {   // a class field: readonly onScored = new Event<[points: number]>()
  emit(...args: A): void;
  on(fn: (...args: A) => void): void;  off(fn): void;  once(fn): void;  clear(): void;
}

// A behaviour class as a value — what the lookups take, and how to type a list of kinds:
//   const kinds: BehaviourType<Weapon>[] = [Bolt, Ring];  for (const k of kinds) node.getComponent(k)
type BehaviourType<T extends Behaviour = Behaviour> = abstract new () => T;
type ConstructableBehaviour<T extends Behaviour = Behaviour> = new () => T;   // not abstract: addComponent makes one
type BehaviourInit<T>;   // its public fields, each optional: addComponent(node, Spinner, { speed: 2 })
function destroy(target: Object3D | Behaviour): void;  // at the end of the frame, with children and their behaviours
function findObjectOfType<T>(type: BehaviourType<T>): T | null;
function findObjectsOfType<T>(type: BehaviourType<T>): T[];   // skips what is being destroyed
function sendMessage(node: Object3D, method: string, ...args: unknown[]): void;
function broadcastMessage(node: Object3D, method: string, ...args: unknown[]): void;  // and its children
function addComponent<T>(node: Object3D, type: ConstructableBehaviour<T>, init?: BehaviourInit<T>): T;   // node typed as T's N
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
  getJoystickNames(): string[];        // connected gamepads; empty until a button is pressed on one, as browsers show them
  // A gamepad, as Unity's Input Manager has it: its buttons are keys (KeyCode.JoystickButton0…19, the
  //   browser's standard layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 12–15 d-pad);
  //   the left stick and d-pad feed 'Horizontal'/'Vertical' beside the keys; A is Fire1 and Submit,
  //   B Fire2 and Cancel, X Fire3, Y Jump. Read once a frame; any pad counts.
  readonly mousePosition: Vector2;     // CSS pixels on the canvas
  readonly pointer: Vector2;           // normalized device coordinates, for Raycaster.setFromCamera
  readonly mouseDelta: Vector2;  readonly mouseScrollDelta: Vector2;
};
const KeyCode: { A … Z; Alpha0 … Alpha9; F1 … F12; LeftArrow; RightArrow; UpArrow; DownArrow;
  Space; Return; Escape; Tab; Backspace; LeftShift; LeftControl; …; JoystickButton0 … JoystickButton19 };   // Unity's names: KeyCode.A, KeyCode.LeftArrow, KeyCode.Return
const MouseButton: { Left: 0; Middle: 1; Right: 2 };
const AXES: Record<AxisName, …>;  const AXIS_NAMES: AxisName[];   // Unity's default axes and their keys

// ── assets: made once in a .ts module, named from scenes ──────────────────────────────────
// What a node's own elements built (<BoxGeometry> inside a <Mesh>) is freed when the node is destroyed —
// a scene load included. What a scene only names in a prop (material={paint.wall}) is never freed by it.
function sharedTexture(url: string, settings?: TextureSettings): Texture;   // one per URL; the image arrives later
function sharedModel(url: string): Model;    // a glTF: await loadAssets(model), then model.instantiate(); meshopt-compressed (gltfpack -cc) loads too
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
