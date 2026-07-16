import type { Component } from './Component.js';
import type { Engine } from './Engine.js';
import type { System } from './System.js';
import { allSystemDefs } from '../registry/NodeRegistry.js';

/** A component constructor a system's query is tested against. */
type ComponentType = abstract new (...args: never[]) => Component;

/**
 * Owns the engine's `@system` instances and their live component queries — the
 * ECS-hybrid half of the runtime. All three ways a system comes alive funnel
 * through the one private {@link start} helper, so seeding is defined once:
 *
 *  - **manual** `engine.addSystem(sys)` → {@link add} (persists; not scene-scoped)
 *  - **at scene load** → {@link ensureForScene} over the loaded batch
 *  - **at runtime** (a spawned/added component of a new type) → {@link ensureFor}
 *
 * A started system's `components` query is seeded from the full current component
 * set, then kept in sync by {@link onComponentAdded} / {@link onComponentRemoved}
 * as components come and go. Editor-mode gating lives on the engine (it simply
 * doesn't call the auto-start/step methods in edit mode), so this class stays
 * play/edit-agnostic.
 *
 * Systems run in registration order (for auto-started `@system`s: registry
 * declaration order, filtered by presence) — there is no per-system priority.
 * Within a tick the engine calls `fixedStep` after component `fixedUpdate`
 * (Unity: FixedUpdate then the internal physics step) and `step` before
 * component `update` (physics interpolation and contact hooks land before
 * gameplay reads them).
 */
export class SystemManager {
  private readonly systems: System[] = [];
  /** Each running system → the component type its `components` query tracks. */
  private readonly queries = new Map<System, ComponentType>();
  /** Systems auto-started for the loaded scene — torn down on unload ({@link clearScene}). */
  private sceneSystems: System[] = [];

  /** @param components live view of the engine's component set, used to seed queries. */
  constructor(
    private readonly engine: Engine,
    private readonly components: readonly Component[],
  ) {}

  /** The first running system assignable to `type` (Unity `GetComponent` style). */
  get<T extends System>(type: abstract new (...args: never[]) => T): T | undefined {
    for (const s of this.systems) if (s instanceof type) return s as T;
    return undefined;
  }

  /**
   * Register a subsystem instance directly (persists across scene loads). Injects
   * `system.engine`, seeds its query, runs `onAttach`. Usually you don't call this —
   * a registered `@system` auto-runs when its component type appears.
   */
  add<T extends System>(system: T): T {
    return this.start(system);
  }

  /** Remove a subsystem, running its `onDetach`, and drop its query. */
  remove(system: System): void {
    const i = this.systems.indexOf(system);
    if (i === -1) return;
    this.systems.splice(i, 1);
    this.queries.delete(system);
    system.onDetach?.();
  }

  /**
   * Start every registered `@system` whose component type is present in `batch`
   * and isn't already running — the scene-load path. Tracked as scene-scoped so
   * {@link clearScene} tears them down on unload.
   */
  ensureForScene(batch: readonly Component[]): void {
    for (const def of allSystemDefs()) {
      const type = def.componentType as ComponentType;
      if (batch.some((c) => c instanceof type)) this.startSceneSystemFor(def);
    }
  }

  /**
   * Start every registered `@system` that processes `instance`'s type and isn't
   * already running — the runtime path (a spawned prefab / `addComponent` bringing
   * in the first component of a type). Tracked as scene-scoped.
   */
  ensureFor(instance: Component): void {
    for (const def of allSystemDefs()) {
      if (instance instanceof (def.componentType as ComponentType)) this.startSceneSystemFor(def);
    }
  }

  /** Add a freshly-registered component to every running query it belongs to. */
  onComponentAdded(instance: Component): void {
    for (const [system, type] of this.queries) {
      if (instance instanceof type) (system.components as Component[]).push(instance);
    }
  }

  /** Drop a component from every running query it belonged to. */
  onComponentRemoved(instance: Component): void {
    for (const [system, type] of this.queries) {
      if (!(instance instanceof type)) continue;
      const q = system.components as Component[];
      const qi = q.indexOf(instance);
      if (qi !== -1) q.splice(qi, 1);
    }
  }

  /** Variable-rate step for every system, once per frame. */
  step(dt: number): void {
    for (const s of this.systems) s.step?.(dt);
  }

  /** Fixed-rate step for every system (inside the fixed-timestep loop). */
  fixedStep(fixedDt: number): void {
    for (const s of this.systems) s.fixedStep?.(fixedDt);
  }

  /** Tear down the scene-scoped systems (scene unload / dispose). */
  clearScene(): void {
    for (const s of this.sceneSystems) this.remove(s);
    this.sceneSystems = [];
  }

  /** Remove every system — manual and scene-scoped — running each `onDetach`. For engine dispose. */
  removeAll(): void {
    for (const s of [...this.systems]) this.remove(s);
    this.sceneSystems = [];
  }

  /** Start `def`'s system if none of its kind runs yet, tracking it as scene-scoped. */
  private startSceneSystemFor(def: { ctor: new () => unknown }): void {
    if (this.systems.some((s) => s instanceof def.ctor)) return;
    this.sceneSystems.push(this.start(new def.ctor() as System));
  }

  /** The one place a system is wired in: inject engine, seed its query, run onAttach. */
  private start<T extends System>(system: T): T {
    system.engine = this.engine;
    const type = allSystemDefs().find((d) => system instanceof d.ctor)?.componentType as ComponentType | undefined;
    if (type) {
      this.queries.set(system, type);
      (system.components as Component[]).push(...this.components.filter((c) => c instanceof type));
    }
    this.systems.push(system);
    system.onAttach?.();
    return system;
  }
}
