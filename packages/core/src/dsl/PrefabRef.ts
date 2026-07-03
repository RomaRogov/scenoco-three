import type { Euler, Object3D, Quaternion, Vector3 } from 'three';
import type { CompiledScene } from './compiled.js';

/** How a prefab is instantiated — the Engine supplies this when wiring props. */
export type SpawnFn = (compiled: CompiledScene, parent?: Object3D) => Object3D;

/** A local position — a Three.js `Vector3` or a plain `[x, y, z]` (same value works on any Object3D). */
export type Vec3Input = Vector3 | [number, number, number];
/** A local rotation — a Three.js `Euler`/`Quaternion` or a plain `[x, y, z]` radians triple. */
export type RotationInput = Euler | Quaternion | [number, number, number];

/**
 * Options for {@link PrefabRef.spawn} — the Unity `Instantiate(prefab, position,
 * rotation, parent)` shape. Just placement: everything else (component fields,
 * references) is wired the Unity/Cocos way — on the returned root via
 * `engine.getComponents`, or by the prefab's own script resolving scene objects
 * (`engine.getComponentsOfType` / `engine.findComponent`).
 */
export interface SpawnOptions {
  /** Parent for the spawned subtree. Defaults to the owning component's node. */
  parent?: Object3D;
  /** Local position applied to the spawned root — a `Vector3` or `[x, y, z]`. */
  position?: Vec3Input;
  /** Local rotation applied to the spawned root — a `Euler`, a `Quaternion`, or `[x, y, z]` radians. */
  rotation?: RotationInput;
}

/**
 * The value a `@property({ type: 'prefab' })` field receives: a handle that
 * spawns the build-time-embedded prefab at runtime — Unity/Cocos `Instantiate`,
 * without the component touching the bundle/instantiate machinery.
 *
 *   @property({ type: 'prefab', description: 'Brick prefab to spawn' }) brick: PrefabRef | null = null;
 *   // …
 *   const root = this.brick!.spawn({ position: [x, y, 0] });
 *   // wire fields/references on the fresh instance, GetComponent-style:
 *   const ctrl = this.engine.getComponents(root).find((c) => c instanceof Controller) as Controller;
 *   ctrl.gameManager = this.engine.findComponent('gm', GameManager);
 *   // later: this.engine.destroy(root);
 *
 * Spawned subtrees are owned by the engine; destroy them yourself with
 * `engine.destroy(root)` (or let the owning component destroy them in onDestroy)
 * — they are *not* torn down by the scene unload that removes the spawning
 * component's subtree.
 */
export class PrefabRef {
  constructor(
    private readonly compiled: CompiledScene,
    private readonly spawnFn: SpawnFn,
    /** Default parent — the node of the component that holds this reference. */
    private readonly defaultParent?: Object3D,
  ) {}

  /** Spawn one instance of the prefab. Returns its root Object3D (pass it to `engine.destroy` to remove). */
  spawn(options: SpawnOptions = {}): Object3D {
    const root = this.spawnFn(this.compiled, options.parent ?? this.defaultParent);
    if (options.position) setVec3(root.position, options.position);
    if (options.rotation) setRotation(root, options.rotation);
    return root;
  }
}

/** Copy a `Vector3` or `[x, y, z]` into a target vector. */
function setVec3(target: Vector3, value: Vec3Input): void {
  if (Array.isArray(value)) target.fromArray(value);
  else target.copy(value);
}

/** Apply a `Euler`, `Quaternion`, or `[x, y, z]` radians triple to an object's orientation. */
function setRotation(root: Object3D, value: RotationInput): void {
  if (Array.isArray(value)) root.rotation.set(value[0], value[1], value[2]);
  else if ('isQuaternion' in value) root.quaternion.copy(value);
  else root.rotation.copy(value);
}
