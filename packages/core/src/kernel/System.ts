import type { Runtime } from './runtime.js';

/**
 * A package's per-scene service — a physics world, an audio mixer. Not for games: a game's
 * managers are behaviours. One per runtime, made on first ask with `service(node, Type)`, and run
 * **after** the behaviours in each phase: physics steps once every `fixedUpdate` script has moved
 * what it moves, as in Unity.
 */
export abstract class System {
  /** The runtime this system serves. Set before `awake`. */
  runtime!: Runtime;

  /** Once, when the runtime first creates it. */
  awake?(): void;
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  lateUpdate?(dt: number): void;
  /** Once, when its runtime is disposed. */
  onDestroy?(): void;
}

export type SystemType<T extends System = System> = new () => T;
