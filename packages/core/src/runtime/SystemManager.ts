import type { Object3D } from 'three';
import type { Component } from './Component.js';
import type { Engine } from './Engine.js';
import type { System } from './System.js';
import { allSystemDefs, type AttachClass, type SystemDef } from '../registry/NodeRegistry.js';

/** A component constructor a system's query is tested against. */
type ComponentType = abstract new (...args: never[]) => Component;

/**
 * Owns the engine's `@system` instances and their live queries — the ECS-hybrid
 * half of the runtime. A system queries either a component type
 * (`@system(SomeComponent)` → `system.components`) or an Object3D class
 * (`@system({ nodes: SomeClass })` → `system.nodes`). All three ways a system
 * comes alive funnel through the one private {@link start} helper, so seeding is
 * defined once:
 *
 *  - **manual** `engine.addSystem(sys)` → {@link add} (persists; not scene-scoped)
 *  - **at scene load** → {@link ensureForScene} over the loaded batch + scene tree
 *  - **at runtime** (a spawned/added component or node of a new type) →
 *    {@link ensureFor} / {@link ensureForSubtree}
 *
 * A started system's query is seeded from the full current set, then kept in
 * sync by the `onComponentAdded`/`onComponentRemoved` and `onObjectAdded`/
 * `onObjectRemoved` notifications as things come and go.
 *
 * Editor-mode gating: the engine passes `editor` flags through — in editor mode
 * only systems registered with `executeInEditor` start and step (the system-side
 * `@executeInEditor`); in play mode every system runs.
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
  /** Each running system → its registration (queries + editor flag); absent for def-less manual systems. */
  private readonly defs = new Map<System, SystemDef>();
  /** Each running component-query system → the component type its `components` query tracks. */
  private readonly queries = new Map<System, ComponentType>();
  /** Each running node-query system → the Object3D class its `nodes` query tracks. */
  private readonly nodeQueries = new Map<System, AttachClass>();
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
   * a registered `@system` auto-runs when its query type appears.
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
    this.nodeQueries.delete(system);
    this.defs.delete(system);
    system.onDetach?.();
  }

  /**
   * Start every registered `@system` whose query type is present — component
   * types tested against `batch`, node classes against the live scene tree — and
   * isn't already running. The scene-load path; tracked as scene-scoped so
   * {@link clearScene} tears them down on unload. In editor mode (`editor`),
   * only `executeInEditor` systems are considered.
   */
  ensureForScene(batch: readonly Component[], editor = false): void {
    const nodeDefs: SystemDef[] = [];
    for (const def of allSystemDefs()) {
      if (editor && !def.executeInEditor) continue;
      if (def.componentType && batch.some((c) => c instanceof (def.componentType as ComponentType))) {
        this.startSceneSystemFor(def);
      }
      if (def.nodeType && !this.running(def)) nodeDefs.push(def);
    }
    if (nodeDefs.length === 0) return;
    // One traversal tests every pending node-query def against the scene tree.
    this.engine.scene.traverse((object) => {
      for (const def of nodeDefs) {
        if (!this.running(def) && object instanceof def.nodeType!) this.startSceneSystemFor(def);
      }
    });
  }

  /**
   * Start every registered `@system` that processes `instance`'s type and isn't
   * already running — the runtime path (a spawned prefab / `addComponent` bringing
   * in the first component of a type). Tracked as scene-scoped. In editor mode,
   * only `executeInEditor` systems start.
   */
  ensureFor(instance: Component, editor = false): void {
    for (const def of allSystemDefs()) {
      if (editor && !def.executeInEditor) continue;
      if (def.componentType && instance instanceof def.componentType) this.startSceneSystemFor(def);
    }
  }

  /**
   * Start every node-query `@system` whose node class appears in `root`'s subtree
   * and isn't running yet — the runtime counterpart of {@link ensureFor} for
   * spawned/instantiated objects. Tracked as scene-scoped.
   */
  ensureForSubtree(root: Object3D, editor = false): void {
    const pending = allSystemDefs().filter(
      (def) => def.nodeType && !this.running(def) && (!editor || def.executeInEditor),
    );
    if (pending.length === 0) return;
    root.traverse((object) => {
      for (const def of pending) {
        if (!this.running(def) && object instanceof def.nodeType!) this.startSceneSystemFor(def);
      }
    });
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

  /** Add a scene-entering object to every running node query it belongs to. */
  onObjectAdded(object: Object3D): void {
    for (const [system, cls] of this.nodeQueries) {
      if (object instanceof cls) (system.nodes as Object3D[]).push(object);
    }
  }

  /** Drop a scene-leaving object from every running node query it belonged to. */
  onObjectRemoved(object: Object3D): void {
    for (const [system, cls] of this.nodeQueries) {
      if (!(object instanceof cls)) continue;
      const q = system.nodes as Object3D[];
      const qi = q.indexOf(object);
      if (qi !== -1) q.splice(qi, 1);
    }
  }

  /**
   * Variable-rate step for every system, once per frame. With `editor` set (the
   * engine is in editor mode) only `executeInEditor` systems step.
   */
  step(dt: number, editor = false): void {
    for (const s of this.systems) {
      if (editor && !this.defs.get(s)?.executeInEditor) continue;
      s.step?.(dt);
    }
  }

  /** Fixed-rate step for every system (inside the fixed-timestep loop; play mode only). */
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

  /** Whether a system of `def`'s kind is already running. */
  private running(def: SystemDef): boolean {
    return this.systems.some((s) => s instanceof def.ctor);
  }

  /** Start `def`'s system if none of its kind runs yet, tracking it as scene-scoped. */
  private startSceneSystemFor(def: SystemDef): void {
    if (this.running(def)) return;
    this.sceneSystems.push(this.start(new def.ctor() as System));
  }

  /** The one place a system is wired in: inject engine, seed its queries, run onAttach. */
  private start<T extends System>(system: T): T {
    system.engine = this.engine;
    const def = allSystemDefs().find((d) => system instanceof d.ctor);
    if (def) {
      this.defs.set(system, def);
      if (def.componentType) {
        const type = def.componentType as ComponentType;
        this.queries.set(system, type);
        (system.components as Component[]).push(...this.components.filter((c) => c instanceof type));
      }
      if (def.nodeType) {
        const cls = def.nodeType;
        this.nodeQueries.set(system, cls);
        this.engine.scene.traverse((object) => {
          if (object instanceof cls) (system.nodes as Object3D[]).push(object);
        });
      }
    }
    this.systems.push(system);
    system.onAttach?.();
    return system;
  }
}
