import type { Object3D } from 'three';
import type { SceneInstance } from '../core/Engine.js';
import type { CompiledScene } from './compiled.js';

/** How a prefab is instantiated — the Engine supplies this when wiring props. */
export type SpawnFn = (compiled: CompiledScene, parent?: Object3D) => SceneInstance;

export interface SpawnOptions {
  /** Parent for the spawned subtree. Defaults to the owning component's node. */
  parent?: Object3D;
  /** Local position to apply to the spawned root after spawning. */
  position?: [number, number, number];
}

/**
 * The value a `@property({ type: 'prefab' })` field receives: a handle that
 * spawns the build-time-embedded prefab at runtime — Unity/Cocos `Instantiate`,
 * without the component touching the bundle/instantiate machinery.
 *
 *   @property({ type: 'prefab' }) brick: PrefabRef | null = null;
 *   // …
 *   const instance = this.brick!.spawn({ position: [x, y, 0] });
 *   // later: instance.destroy();
 *
 * Spawned instances are owned by the engine; destroy them yourself (or let the
 * owning component destroy them in onDestroy) — they are *not* torn down by the
 * scene unload that removes the spawning component's subtree.
 */
export class PrefabRef {
  constructor(
    private readonly compiled: CompiledScene,
    private readonly spawnFn: SpawnFn,
    /** Default parent — the node of the component that holds this reference. */
    private readonly defaultParent?: Object3D,
  ) {}

  /** Spawn one instance of the prefab. Returns its handle (call `.destroy()` to remove). */
  spawn(options: SpawnOptions = {}): SceneInstance {
    const instance = this.spawnFn(this.compiled, options.parent ?? this.defaultParent);
    if (options.position) instance.root.position.fromArray(options.position);
    return instance;
  }
}
