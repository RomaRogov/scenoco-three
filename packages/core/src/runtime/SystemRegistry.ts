import type { Scene } from 'three';
import { System } from './System.js';
import type { SystemHook, SystemWith } from './types.js';

/** The systems on one scene: which exist, when each runs, and when they are torn down. */
export class SystemRegistry {
  /** In the order added, and bucketed per hook so an unimplemented phase costs nothing. */
  private readonly systems: System[] = [];
  private readonly fixedUpdaters: SystemWith<'fixedUpdate'>[] = [];
  private readonly updaters: SystemWith<'update'>[] = [];
  private readonly lateUpdaters: SystemWith<'lateUpdate'>[] = [];
  /** Added but not yet started, drained by the same flush that starts components. */
  private readonly pendingStart: System[] = [];
  private readonly destroyQueue: System[] = [];

  /** Every system on this scene, in the order they were added. */
  get list(): readonly System[] {
    return this.systems;
  }

  /** True while something is waiting to be torn down. */
  get hasPendingDestroy(): boolean {
    return this.destroyQueue.length > 0;
  }

  /** The system of this class, or null. */
  get<T extends System>(type: abstract new (...args: never[]) => T): T | null {
    for (const system of this.systems) {
      if (system instanceof type && !system._pendingDestroy) return system as T;
    }
    return null;
  }

  /** Register a system and wake it. A scene holds at most one of each class. */
  add(system: System): void {
    if (this.get(system.constructor as new () => System)) {
      throw new Error(
        `[scenoco] this scene already has a ${system.constructor.name}. ` +
          'A scene holds one system of each class; use getSystem or requireSystem.',
      );
    }
    this.systems.push(system);
    if (system.fixedUpdate) this.fixedUpdaters.push(system as SystemWith<'fixedUpdate'>);
    if (system.update) this.updaters.push(system as SystemWith<'update'>);
    if (system.lateUpdate) this.lateUpdaters.push(system as SystemWith<'lateUpdate'>);
    if (system.start) this.pendingStart.push(system);

    if (system.awake) {
      try {
        system.awake();
      } catch (error) {
        report(system, 'awake', error);
      }
    }
    system._awake = true;
  }

  /** Queue a system for removal. Returns false for one that is not here, or already going. */
  remove(system: System): boolean {
    if (system._pendingDestroy || !this.systems.includes(system)) return false;
    system._pendingDestroy = true;
    this.destroyQueue.push(system);
    return true;
  }

  /**
   * Run `start` on every system added since the last flush. After the components' starts, so
   * everything that registers itself in `awake` has done so.
   */
  flushStarts(): void {
    if (this.pendingStart.length === 0) return;
    const batch = this.pendingStart.splice(0, this.pendingStart.length);
    for (const system of batch) {
      if (system._pendingDestroy) continue;
      call(system as SystemWith<'start'>, 'start', (s) => s.start());
    }
  }

  fixedUpdate(dt: number): void {
    for (const system of this.fixedUpdaters.slice()) {
      if (system._pendingDestroy) continue;
      call(system, 'fixedUpdate', (s) => s.fixedUpdate(dt));
    }
  }

  update(dt: number): void {
    for (const system of this.updaters.slice()) {
      if (system._pendingDestroy) continue;
      call(system, 'update', (s) => s.update(dt));
    }
  }

  lateUpdate(dt: number): void {
    for (const system of this.lateUpdaters.slice()) {
      if (system._pendingDestroy) continue;
      call(system, 'lateUpdate', (s) => s.lateUpdate(dt));
    }
  }

  /**
   * Tear down what the frame queued. Last in the destruction pass: a component's `onDestroy`
   * commonly unregisters itself from a system, which has to still be there.
   */
  flushDestroyed(): void {
    const batch = this.destroyQueue.splice(0, this.destroyQueue.length);
    for (const system of batch) {
      this.forget(system);
      teardownSystem(system);
    }
  }

  /** Destroy every system, newest first, so one built on another goes before what it reads. */
  teardown(): void {
    for (const system of this.systems.slice().reverse()) teardownSystem(system);
    this.systems.length = 0;
    this.fixedUpdaters.length = 0;
    this.updaters.length = 0;
    this.lateUpdaters.length = 0;
    this.pendingStart.length = 0;
    this.destroyQueue.length = 0;
  }

  private forget(system: System): void {
    removeFrom(this.systems, system);
    removeFrom(this.fixedUpdaters, system as SystemWith<'fixedUpdate'>);
    removeFrom(this.updaters, system as SystemWith<'update'>);
    removeFrom(this.lateUpdaters, system as SystemWith<'lateUpdate'>);
    removeFrom(this.pendingStart, system);
  }
}

/** Run a system's teardown immediately. Idempotent. */
export function teardownSystem(system: System): void {
  if (system._destroyed) return;
  system._pendingDestroy = true;
  system._destroyed = true;
  if (!system.awake || system._awake) {
    try {
      system.onDestroy?.();
    } catch (error) {
      report(system, 'onDestroy', error);
    }
  }
  // Last, as for a component: `onDestroy` may still be listening to what it is about to leave.
  for (const unsubscribe of system._subscriptions ?? []) unsubscribe();
  system._subscriptions = null;
  system._scene = null!;
}

/** A system has no owning object to name, so the report says the class. */
function report(system: System, at: SystemHook, error: unknown): void {
  console.error(`[scenoco] system ${system.constructor.name}.${at}() threw:`, error);
}

function call<K extends SystemHook>(
  system: SystemWith<K>,
  at: K,
  run: (system: SystemWith<K>) => void,
): void {
  try {
    run(system);
  } catch (error) {
    report(system, at, error);
  }
}

function removeFrom<T>(list: T[], value: T): void {
  const index = list.indexOf(value);
  if (index !== -1) list.splice(index, 1);
}

/** Kept for the scene augmentation's type import. */
export type { Scene };
