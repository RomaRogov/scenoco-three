import type { Object3D } from 'three';
import type { Component } from './Component.js';
import type { Engine } from './Engine.js';

/**
 * An ECS-hybrid system: registered with `@system(SomeComponent)` — or
 * `@system({ nodes: SomeObject3DClass })` for a system driven by scene objects
 * rather than components — the engine auto-runs it once its query type exists,
 * whether present at scene load or added later at runtime (a spawned prefab,
 * `addComponent`), and keeps `this.components` / `this.nodes` populated with the
 * live set. The system owns the behaviour; the components are plain data (they
 * keep their own lifecycle — this is additive, à la Unity DOTS hybrid).
 *
 *   @system(RigidBody)
 *   class PhysicsSystem extends System<RigidBody> {
 *     override fixedStep(dt) { for (const rb of this.components) { … } }
 *   }
 *
 * The engine drives it alongside component lifecycles: `fixedStep` runs inside
 * the fixed-timestep loop (after components' `fixedUpdate`), `step` once per
 * frame (after `update`). Config comes from a singleton attachment, reachable
 * via `this.engine.findAttachment(SomeAttachment)`.
 *
 * A system normally steps only in play mode; registering with
 * `executeInEditor: true` opts its `step` into editor mode too (visual systems
 * — UI layout — whose effect must be visible while editing).
 */
export abstract class System<T extends Component = Component, N extends Object3D = Object3D> {
  /** Owning engine. Assigned before onAttach. */
  engine!: Engine;
  /** The live set of components of this system's type — maintained by the engine. */
  readonly components: readonly T[] = [];
  /** The live set of scene objects of this system's node class (`@system({ nodes: … })`) — maintained by the engine. */
  readonly nodes: readonly N[] = [];

  /** Once, when the engine starts running the system (its component type first appeared, at load or runtime). */
  onAttach?(): void;
  /** Fixed-rate step, for deterministic simulation (physics world step, …). */
  fixedStep?(fixedDt: number): void;
  /** Variable-rate step, once per frame. */
  step?(dt: number): void;
  /** Once, when the system stops (scene unload / dispose). */
  onDetach?(): void;
}
