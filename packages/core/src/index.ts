/**
 * `@scenoco-three/core` — a Unity-shaped scene and component layer for Three.js.
 *
 * Importing this module installs the augmentations: from here on every `THREE.Object3D` can
 * carry components and every `THREE.Scene` can load, unload and run an event cycle. There is
 * no wrapper type to learn and nothing to unwrap — a `Mesh` is still a `Mesh`, with the whole
 * three.js API on it.
 *
 * ## The whole model, in four nouns
 *
 * | | is | lives on | you write |
 * | --- | --- | --- | --- |
 * | **Component** | behaviour | one `Object3D` | `node.addComponent(Spinner, { speed: 2 })` |
 * | **System** | a scene-level service | the `Scene` | `scene.addSystem(Physics2D)` |
 * | **Prefab** | a node that builds itself | — | `parent.instantiate(Brick, { position })` |
 * | **Scene** | a `THREE.Scene` with a lifecycle | — | `SceneManager.load(Breakout)` |
 *
 * ```ts
 * import { Component, SceneManager } from '@scenoco-three/core';
 * import { Mesh, Scene } from 'three';
 *
 * class Spinner extends Component {
 *   speed = 1;                                     // a public field is a setting
 *   override update(dt: number) { this.object3D.rotation.y += this.speed * dt; }
 * }
 *
 * class Level extends Scene {
 *   override onLoad() {
 *     this.createObject('cube').addComponent(Spinner, { speed: 2 });
 *   }
 * }
 *
 * await SceneManager.load(Level);
 * ```
 *
 * ## The rules
 *
 * **Nothing is addressed by a string.** Components are found by class, scenes are loaded by
 * class, keys are named by `KeyCode`, events are typed `Event` fields. If you are about to
 * write a string literal that names a *thing*, there is a typed answer for it. Strings are for
 * text a person reads.
 *
 * **Components never declare a constructor.** `addComponent(Type, init)` constructs, then
 * applies `init`, then wakes — so a component always wakes up configured. Class field
 * initializers run after `super()`, which is why a constructor taking settings would have
 * every one of them silently overwritten by the subclass's own defaults.
 *
 * **`awake` for your own state, `start` for reaching other components.** Nothing has been
 * started when `awake` runs, so a `start` that depends on another `start` is a bug.
 *
 * **Every destroy is deferred** to the end of the frame — components, objects and systems
 * alike. Destroying inside a hook is therefore always safe, and every phase skips a doomed
 * thing from the moment it is marked.
 *
 * **Authored data is in degrees.** `Object3D.eulerAngles` is the degrees view; radians exist
 * only on the live `THREE.Euler` underneath.
 *
 * ## The frame
 *
 * `SceneManager.tick(timestamp)` runs the phases in this order. Systems run after every
 * component in the matching phase, which is the ordering physics needs.
 *
 * ```text
 * once, on the first frame: component.start → system.start
 * per fixed step:   component.fixedUpdate → system.fixedUpdate → coroutines
 * per frame:        component.update      → system.update       → coroutines
 *                   component.lateUpdate  → system.lateUpdate
 *                   deferred destruction
 * ```
 *
 * ## What outlives a scene
 *
 * `SceneManager.load` replaces everything — except what said otherwise.
 * `SceneManager.dontDestroyOnLoad(node)` moves a node into a persistent scene that is ticked
 * and drawn over the active one; `scene.dontDestroyOnLoad = true` exempts a whole scene, which
 * is the shape that cannot end up duplicated, since `loadAdditive` of a loaded scene is a
 * no-op. `SceneManager.findObjectOfType` searches every loaded scene, which is how a new level
 * reaches what survived the last one.
 *
 * ## What is deliberately absent
 *
 * No engine object, no registry, no wire format, no reflection, no queries, no tags, no
 * `sendMessage`. A component is a class extending `Component`, and that is the whole
 * registration: the build finds it by reading the workspace with the TypeScript API, the way
 * Unity reads a MonoBehaviour. Scene, prefab, geometry, material and particle documents
 * compile to TypeScript that constructs Three.js objects directly.
 */
// The `Object3D` augmentation, split by concern: each file declares the members it implements.
import './runtime/augment/object3d.js';
import './runtime/augment/components.js';
import './runtime/augment/prefabs.js';
import './runtime/augment/lifetime.js';
import './runtime/augment/scene.js';

export { Component } from './runtime/Component.js';
// A scene-level service with no node of its own — a physics world, an audio bus. Same hook
// names as a component; runs after every component in the matching phase.
export { System } from './runtime/System.js';
export { SceneManager, type SceneEventListener } from './runtime/SceneManager.js';
export { SceneRuntime } from './runtime/SceneRuntime.js';
export { disposeSceneResources } from './runtime/dispose.js';
// Where a node came from, for tooling. Present only in a build that asked for it.
export {
  findProvenance,
  nodesFrom,
  provenanceOf,
  type Provenance,
} from './runtime/provenance.js';

// Resources that live in files. A geometry or a material is built when its module is evaluated;
// a texture is handed over before its image lands; a model has to be awaited. `shared()` is what
// says the module owns a resource, so scene unload leaves it alone.
export { Asset, loadAssets, type Loadable } from './assets/Asset.js';
export { Model, sharedModel } from './assets/Model.js';
export { sharedTexture, type TextureSettings } from './assets/textures.js';
export { shared, isShared, disposeAssets } from './assets/shared.js';
export { Engine, type EngineOptions } from './runtime/Engine.js';
// How a frame is drawn. `Effect` is the model; the effects themselves live in a package, the
// way node tags live in three and physics tags live in box2d.
export { Effect, RenderSettings, RenderState } from './runtime/RenderSettings.js';
// The components core ships. Each is a component rather than a property on a three.js class,
// because three.js has no such concept and a document has to be able to tell the two apart.
export { CameraFit, type FitMode } from './runtime/CameraFit.js';
// Plays the clips a glTF model arrives with. Here rather than in a package because the models
// are here: `Model.instantiate` is what puts the clips on the node.
export { Animator } from './runtime/Animator.js';
// Attaches a node to a bone inside a model — a sword in a hand.
export { AttachTo } from './runtime/AttachTo.js';
// Runs a tween library on the engine's clock, so pause and slow motion reach it. SceNoCo has no
// tween of its own: three.js ships tween.js in its addons, and that is the one to use.
export { Tweens, type TweenTicker, type TweenStarter } from './runtime/Tweens.js';
export { Time } from './runtime/Time.js';

// Typed events: how components signal each other without importing each other. A class
// field, never a string name — the compiler checks every subscriber.
export { Event } from './runtime/Event.js';

export { Input } from './input/Input.js';
export { KeyCode, MouseButton } from './input/KeyCode.js';

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

// A component needs no decorators: extending `Component` registers it, and its public fields
// are serialized. These exist only for what the source cannot say on its own.
export {
  serialize,
  serializedFieldsOf,
  type SerializeOptions,
  type SerializedBag,
} from './decorators.js';

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
