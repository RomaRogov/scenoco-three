/**
 * `@scenoco-three/core` — Unity's behaviours on three.js, with scenes written in TSX.
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
import './augment.js';

export { play, instantiate, type Game, type PlayOptions, type InstantiateOptions } from './play.js';
export { SceneManager, dontDestroyOnLoad } from './scenes.js';
export { ref, sourceOf, type Ref, type Source } from './jsx.js';
export type { EditHost } from './edit.js';
export {
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
  type BehaviourInit,
  type BehaviourType,
  type Prefab,
  type RenderCamera,
  type Yieldable,
} from './kernel/index.js';

export { Mathf } from './Mathf.js';
export { Random, type RandomState } from './Random.js';
export { PlayerPrefs } from './PlayerPrefs.js';
export { Input, type ButtonName } from './input/Input.js';
export { KeyCode, MouseButton } from './input/KeyCode.js';
export { AXES, AXIS_NAMES, type AxisName } from './input/axes.js';

export { Asset, loadAssets, type Loadable } from './assets/Asset.js';
export { Model, sharedModel } from './assets/Model.js';
export { Animator, type AnimatorStateInfo } from './animation/Animator.js';
export { sharedTexture, type TextureSettings } from './assets/textures.js';

// For packages — physics, audio, particles — not for games: a package's per-scene service, the
// messages it sends, and the kernel's view of what is running.
export {
  System,
  service,
  cameraOf,
  declareMessages,
  runtimeOf,
  behavioursOn,
  wake,
  Runtime,
  type SystemType,
  type BehaviourHooks,
  type ConstructableBehaviour,
  type NodeOf,
} from './kernel/index.js';
