import type { Component } from './Component.js';
import type { Engine } from './Engine.js';

/**
 * An ECS-hybrid system: registered with `@system(SomeComponent)`, the engine
 * auto-runs it once a component of that type exists — whether present at scene
 * load or added later at runtime (a spawned prefab, `addComponent`) — and keeps
 * `this.components` populated with the live set. The system owns the behaviour;
 * the components are plain data (they keep their own lifecycle — this is
 * additive, à la Unity DOTS hybrid).
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
 */
export abstract class System<T extends Component = Component> {
  /** Owning engine. Assigned before onAttach. */
  engine!: Engine;
  /** The live set of components of this system's type — maintained by the engine. */
  readonly components: readonly T[] = [];

  /** Once, when the engine starts running the system (its component type first appeared, at load or runtime). */
  onAttach?(): void;
  /** Fixed-rate step, for deterministic simulation (physics world step, …). */
  fixedStep?(fixedDt: number): void;
  /** Variable-rate step, once per frame. */
  step?(dt: number): void;
  /** Once, when the system stops (scene unload / dispose). */
  onDetach?(): void;
}
