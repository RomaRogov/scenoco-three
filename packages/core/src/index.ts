/**
 * `@scenoco-three/core` — Unity-style behaviours for three.js, with scenes written in TSX.
 *
 * ```tsx
 * export const Main = () => (
 *   <Scene>
 *     <Mesh position={[0, 1, 0]}>
 *       <BoxGeometry />
 *       <MeshStandardMaterial color="orange" />
 *       <Spinner speed={2} />
 *     </Mesh>
 *   </Scene>
 * );
 * play(Main);
 * ```
 *
 * A tag is a class you import and builds that object at once; an attribute sets its property the
 * way React Three Fiber does. A `Behaviour` is a component with Unity's lifecycle. A prefab is a
 * function returning TSX, and `instantiate` calls it. Everything else is three.js.
 */
import './port.js';
import './augment.js';
import './tween/shortcuts.js';

export {
  play,
  instantiate,
  gameOf,
  simulate,
  SceneManager,
  dontDestroyOnLoad,
  prefab,
  ref,
  sourceOf,
  Behaviour,
  Event,
  Coroutine,
  YieldInstruction,
  WaitForSeconds,
  WaitForSecondsRealtime,
  WaitUntil,
  WaitWhile,
  CustomYieldInstruction,
  Time,
  addComponent,
  destroy,
  sendMessage,
  broadcastMessage,
  findObjectOfType,
  findObjectsOfType,
  getComponent,
  getComponents,
  getComponentInChildren,
  getComponentsInChildren,
  getComponentInParent,
  Tween,
  Sequence,
  LoopType,
  Ease,
  RotateMode,
  Mathf,
  Random,
  PlayerPrefs,
  Screen,
  QualitySettings,
  ShadowQuality,
  UIDocument,
  Input,
  KeyCode,
  MouseButton,
  AXES,
  AXIS_NAMES,
  Asset,
  loadAssets,
  type Game,
  type PlayOptions,
  type InstantiateOptions,
  type Simulation,
  type SimulateOptions,
  type Ref,
  type Source,
  type BehaviourInit,
  type BehaviourType,
  type Prefab,
  type RenderCamera,
  type Yieldable,
  type Tweenable,
  type EaseFunction,
  type RandomState,
  type QualityLevel,
  type ButtonName,
  type AxisName,
  type Loadable,
} from '@scenoco/kernel';

export { Model, sharedModel, type ModelSettings } from './assets/Model.js';
export { Animator, type AnimatorStateInfo } from './animation/Animator.js';
export { sharedTexture, type TextureSettings } from './assets/textures.js';

// For packages — physics, audio, particles — not for games: a package's per-scene service, the
// messages it sends, the kernel's view of what is running, and what a component was given.
export {
  System,
  service,
  cameraOf,
  declareMessages,
  runtimeOf,
  behavioursOn,
  wake,
  writtenOf,
  Runtime,
  type SystemType,
  type BehaviourHooks,
  type ConstructableBehaviour,
  type NodeOf,
} from '@scenoco/kernel';

// For the editor's interface, `@scenoco-three/editor`: what it reaches the running game through.
export type { EditHost, OpenedScene, Transform } from '@scenoco/kernel';
export type { Reach } from '@scenoco/kernel';
