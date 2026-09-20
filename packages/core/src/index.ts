/**
 * `@scenoco-three/core` — a Unity-shaped scene and component layer for Three.js.
 *
 * Importing this module installs the augmentations: every `THREE.Object3D` can carry components
 * and every `THREE.Scene` can load, unload and run an event cycle. There is no wrapper type — a
 * `Mesh` is still a `Mesh`, with the whole three.js API on it.
 *
 * | | is | lives on | you write |
 * | --- | --- | --- | --- |
 * | **Component** | behaviour | one `Object3D` | `node.addComponent(Spinner, { speed: 2 })` |
 * | **System** | a scene-level service | the `Scene` | `scene.addSystem(Physics2D)` |
 * | **Prefab** | a node that builds itself | — | `parent.instantiate(Brick, { position })` |
 * | **Scene** | a `THREE.Scene` with a lifecycle | — | `SceneManager.load(Breakout)` |
 *
 * ## The rules
 *
 * - **Nothing is addressed by a string.** Components are found by class, scenes loaded by class,
 *   keys named by `KeyCode`, events are typed `Event` fields.
 * - **Components never declare a constructor.** `addComponent(Type, init)` constructs, applies
 *   `init`, then wakes — field initializers run after `super()`, so a constructor taking
 *   settings would have them overwritten.
 * - **`awake` for your own state, `start` for reaching other components.**
 * - **Every destroy is deferred** to the end of the frame, so destroying inside a hook is safe.
 * - **Angles you set are degrees** — `Object3D.eulerAngles`. Radians exist only on the live
 *   `THREE.Euler` underneath.
 * - **No engine object, no registry, no reflection, no queries, no tags.** A class extending
 *   `Component` is the whole registration.
 *
 * ## The frame
 *
 * `SceneManager.tick(timestamp)` runs the phases in order. Systems run after every component in
 * the matching phase, which is the ordering physics needs.
 *
 * ```text
 * once, on the first frame: component.start → system.start
 * per fixed step:   component.fixedUpdate → system.fixedUpdate → coroutines
 * per frame:        component.update      → system.update       → coroutines
 *                   component.lateUpdate  → system.lateUpdate
 *                   deferred destruction
 * ```
 *
 * `SceneManager.load` replaces every scene except one marked `dontDestroyOnLoad`, and
 * `SceneManager.findObjectOfType` searches all of them — which is how a new level reaches what
 * survived the last one.
 */
// The `Object3D` augmentation, split by concern.
import './runtime/augment/object3d.js';
import './runtime/augment/components.js';
import './runtime/augment/prefabs.js';
import './runtime/augment/lifetime.js';
import './runtime/augment/scene.js';

export { Component } from './runtime/Component.js';
export { System } from './runtime/System.js';
export { SceneManager, type SceneEventListener } from './runtime/SceneManager.js';
export { SceneRuntime } from './runtime/SceneRuntime.js';
export { disposeSceneResources } from './runtime/dispose.js';
export {
  findProvenance,
  nodesFrom,
  provenanceOf,
  type Provenance,
} from './runtime/provenance.js';

// Resources that live in files. A texture is handed over before its image lands, a model has to
// be awaited, and `shared()` says a module owns a resource so scene unload leaves it alone.
export { Asset, loadAssets, type Loadable } from './assets/Asset.js';
export { Model, sharedModel } from './assets/Model.js';
export { sharedTexture, type TextureSettings } from './assets/textures.js';
export { shared, isShared, disposeAssets } from './assets/shared.js';
export { Engine, type EngineOptions } from './runtime/Engine.js';
export { Effect, RenderSettings, RenderState } from './runtime/RenderSettings.js';

// The components core ships, each one a class rather than a property on a three.js class.
export { CameraFit, type FitMode } from './components/CameraFit.js';
export { Animator } from './components/Animator.js';
export { AttachTo } from './components/AttachTo.js';
export { Tweens, type TweenTicker, type TweenStarter } from './runtime/Tweens.js';

export { Time } from './runtime/Time.js';
export { Event } from './runtime/Event.js';

export { Input } from './input/Input.js';
export { KeyCode, MouseButton } from './input/KeyCode.js';
export { AXES, AXIS_NAMES, BUTTON_NAMES, type AxisName, type ButtonName } from './input/axes.js';

export {
  Coroutine,
  YieldInstruction,
  WaitForSeconds,
  WaitForSecondsRealtime,
  WaitForFixedUpdate,
  WaitUntil,
  WaitWhile,
  type IEnumerator,
  type Yieldable,
} from './runtime/Coroutine.js';

export type {
  AuthorableFields,
  ComponentInit,
  ComponentLifecycle,
  ComponentType,
  ComponentWith,
  ConstructableComponent,
  LifecycleHook,
  NodeLifecycle,
  OwnerOf,
  PrefabInit,
  PrefabPlacement,
  PrefabType,
  SceneLifecycle,
  SceneType,
  ConstructableSystem,
  SystemHook,
  SystemInit,
  SystemLifecycle,
  SystemType,
  SystemWith,
} from './runtime/types.js';
