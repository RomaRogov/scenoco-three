import { MathUtils, Object3D, type Material } from 'three';
import type { Component } from './Component.js';
import type { Engine } from './Engine.js';

const { RAD2DEG, DEG2RAD } = MathUtils;

/**
 * A live **degrees** view over a node's `rotation` Euler (which is radians). Holds
 * no state of its own — every read/write converts against the node's `rotation`,
 * so `node.eulerAngles` and `node.rotation` are always two units of the same value
 * and can't drift. Unlike Unity's `Transform.eulerAngles` (a fresh struct each get,
 * where mutating the returned value silently no-ops), this is a persistent view:
 * `node.eulerAngles.y = 90` writes straight through.
 */
export class EulerAngles {
  constructor(private readonly node: Object3D) {}

  get x(): number {
    return this.node.rotation.x * RAD2DEG;
  }
  set x(deg: number) {
    this.node.rotation.x = deg * DEG2RAD;
  }
  get y(): number {
    return this.node.rotation.y * RAD2DEG;
  }
  set y(deg: number) {
    this.node.rotation.y = deg * DEG2RAD;
  }
  get z(): number {
    return this.node.rotation.z * RAD2DEG;
  }
  set z(deg: number) {
    this.node.rotation.z = deg * DEG2RAD;
  }

  /** Set all three angles at once, in degrees. Chainable. */
  set(x: number, y: number, z: number): this {
    this.node.rotation.set(x * DEG2RAD, y * DEG2RAD, z * DEG2RAD);
    return this;
  }
  /** Set from a degrees array/`Vector3`/`{x,y,z}`. Chainable. */
  fromArray(a: ArrayLike<number>): this {
    return this.set(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
  }
  /** `[x, y, z]` in degrees. */
  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

// One view per node, created on first access (a node's `rotation` Euler identity
// is stable, and the view reads it live, so a single cached view stays correct).
const eulerViews = new WeakMap<Object3D, EulerAngles>();

/**
 * Module augmentation that gives every Three.js node the component-manipulation
 * API (Unity `GameObject` / Cocos `Node` style). A node reaches its components
 * through `_engine`, a back-reference the engine stamps when the node enters a
 * scene (see `Engine.indexObjects` / `registerComponent`). `Component` has no
 * `getComponent*` of its own — a component queries its siblings via `this.node`,
 * exactly as Unity's `Component.GetComponent` forwards to its `gameObject`.
 *
 * Importing this file for its side effect patches `Object3D.prototype`; the
 * engine does so, so anything that touches the engine gets the methods.
 *
 * **Scene attachment.** Every method here requires the node to belong to an
 * engine. A hand-built node (`new Group()`) that hasn't been added to a loaded
 * scene or spawned has no engine yet, so calls throw a clear error rather than
 * silently reading empty — the classic trap. Guard with {@link Object3D.isSceneAttached}
 * when a node's attachment is genuinely uncertain.
 *
 * Destroyed-but-not-yet-flushed components are omitted from every result here, so
 * the node queries agree with {@link Engine.findComponent}: once `c.destroy()`
 * runs, `node.getComponent(C)` no longer returns `c`, even within the same tick.
 */
declare module 'three' {
  interface Object3D {
    /**
     * @internal Owning engine, stamped when the node enters a scene. `undefined`
     * on a node that isn't part of any engine yet. Prefer the public
     * {@link Object3D.isSceneAttached} to test attachment.
     */
    _engine?: Engine;

    /**
     * The scene id authored as `id="…"` in the DSL — the handle
     * {@link Engine.findObject}, MCP telemetry/edits, and prefab-scoped
     * (`instanceId/innerId`) lookups address a node by. A dedicated field, not an
     * overload of Three.js's `name`, so `name` stays free for its own meaning
     * (e.g. a loaded glTF's mesh names). `undefined` on a node with no authored id.
     */
    sceneId?: string;

    /**
     * The DSL tag this node was authored as (`<Fullscreen>`, `<Container>`, `<Mesh>`, …),
     * stamped by {@link instantiateScene} on every node it builds. Distinct from
     * Three.js's own `Object3D.type` (which some tag builders — e.g.
     * `@scenoco-three/ui`'s elements, all plain `THREE.Mesh` subclasses — never
     * override, so it reads as generic `"Mesh"`), and from `.constructor.name`
     * (minified in a production build). This is what editor/tooling should show
     * as a node's kind; `undefined` on a hand-built node never instantiated from
     * a compiled scene (e.g. `new Group()` added directly to `engine.scene`).
     */
    sceneTag?: string;

    /**
     * This node's local rotation in **degrees** — a live view over `rotation`
     * (which stays radians), like Unity's `Transform.eulerAngles`. There is no
     * separate stored state: reads and writes convert on the fly, so `eulerAngles`
     * and `rotation` can never disagree. Manipulate rotation in whichever unit
     * suits — set `object.rotation.y = Math.PI/2` **or** `object.eulerAngles.y = 90`
     * (or `object.eulerAngles.set(0, 90, 0)`); each is visible through the other.
     */
    readonly eulerAngles: EulerAngles;

    /** Whether this node belongs to an engine's scene — i.e. the component API below is usable. */
    readonly isSceneAttached: boolean;

    /** First live component of the given type on this node, or null (Unity/Cocos style). */
    getComponent<T extends Component>(type: abstract new () => T): T | null;
    /** Every live component on this node (a fresh snapshot; `[]` when none). */
    getComponents(): readonly Component[];
    /**
     * First live component of the given type on this node or any descendant, or
     * null (Unity `GetComponentInChildren` — includes self). Depth-first.
     */
    getComponentInChildren<T extends Component>(type: abstract new () => T): T | null;
    /**
     * Every live component of the given type on this node and its descendants
     * (Unity `GetComponentsInChildren` — includes self). Returns `[]` when none.
     */
    getComponentsInChildren<T extends Component>(type: abstract new () => T): T[];

    /**
     * Attach a component to this node, by constructor or registered name
     * (Unity/Cocos `AddComponent`). Runs onLoad (and onEnable if enabled); start
     * runs on the next tick.
     */
    addComponent<T extends Component>(type: new () => T, props?: Partial<T>): T;
    addComponent(type: string, props?: Record<string, unknown>): Component;

    /**
     * Remove a component from this node (Cocos `Node.removeComponent`) — the
     * node-side equivalent of `component.destroy()`. **Deferred**, like every
     * SceNoCo destroy: the component is marked at once (every phase skips it from
     * here on) and torn down (onDisable/onDestroy) when the engine flushes at end
     * of tick, so removing one inside a hook is safe.
     */
    removeComponent(instance: Component): void;

    /**
     * This node's **own** material, cloned from the shared one on first call —
     * Unity's `Renderer.material` (vs `sharedMaterial`), which exists for exactly
     * this reason.
     *
     * Identical materials are interned at compile time, so fifty bricks authored
     * `<MeshStandardMaterial color="#fff"/>` all point at *one* live material.
     * Mutating it from a component (`this.node.material.color.set(this.color)`)
     * therefore recolours all fifty, and nothing reports it: the compiler is
     * happy, `tsc` is happy, and every instance's own `@property` values really
     * are correct when inspected. Only the picture is wrong.
     *
     * Call this before the first mutation and the node gets its own copy:
     *
     * ```ts
     * override onLoad(): void {
     *   this.node.uniqueMaterial<MeshStandardMaterial>().color.copy(this.color);
     * }
     * ```
     *
     * Idempotent — call it in `onLoad` and again later and you still have one
     * clone. The declarative counterpart is `unique="true"` on the attachment,
     * for when the *scene* is what knows a placement is individual.
     *
     * Throws when the node has no material at all (a `Group`, an empty node) —
     * silently handing back nothing would just move the invisible bug.
     */
    uniqueMaterial<T extends Material | Material[] = Material>(): T;
  }
}

/**
 * The engine that owns `node`, or `undefined`. A node gets its own `_engine`
 * stamp when it's indexed (scene load / instantiate) or when a component is
 * attached to it; a hand-built node added under `engine.scene` has none of its
 * own, so we walk up to the first ancestor that does (the scene root is stamped
 * by the engine). This is what lets `cube.addComponent(...)` work the moment the
 * cube is in the scene tree, without a separate registration step.
 */
function resolveEngine(node: Object3D): Engine | undefined {
  for (let o: Object3D | null = node; o; o = o.parent) {
    if (o._engine) return o._engine;
  }
  return undefined;
}

/**
 * The owning engine, or a loud, actionable error naming the method and the fix.
 * Every node component method routes through here so "used a node before it was
 * in the scene" fails the same clear way everywhere, instead of a silent null.
 */
function requireEngine(node: Object3D, method: string): Engine {
  const engine = resolveEngine(node);
  if (!engine) {
    throw new Error(
      `Object3D.${method}() requires the node to be in an engine's scene — add it under engine.scene ` +
        `(or load/instantiate it) first. Check node.isSceneAttached when attachment is uncertain.`,
    );
  }
  return engine;
}

Object.defineProperty(Object3D.prototype, 'isSceneAttached', {
  get(this: Object3D): boolean {
    return resolveEngine(this) !== undefined;
  },
  configurable: true,
});

Object.defineProperty(Object3D.prototype, 'eulerAngles', {
  get(this: Object3D): EulerAngles {
    let view = eulerViews.get(this);
    if (!view) {
      view = new EulerAngles(this);
      eulerViews.set(this, view);
    }
    return view;
  },
  configurable: true,
});

Object3D.prototype.getComponent = function getComponent<T extends Component>(
  this: Object3D,
  type: abstract new () => T,
): T | null {
  for (const c of requireEngine(this, 'getComponent').getComponents(this)) {
    if (!c._destroyed && c instanceof type) return c as T;
  }
  return null;
};

Object3D.prototype.getComponents = function getComponents(this: Object3D): readonly Component[] {
  return requireEngine(this, 'getComponents')
    .getComponents(this)
    .filter((c) => !c._destroyed);
};

Object3D.prototype.getComponentInChildren = function getComponentInChildren<T extends Component>(
  this: Object3D,
  type: abstract new () => T,
): T | null {
  const engine = requireEngine(this, 'getComponentInChildren');
  let found: T | null = null;
  this.traverse((object) => {
    if (found) return;
    for (const c of engine.getComponents(object)) {
      if (!c._destroyed && c instanceof type) {
        found = c as T;
        return;
      }
    }
  });
  return found;
};

Object3D.prototype.getComponentsInChildren = function getComponentsInChildren<T extends Component>(
  this: Object3D,
  type: abstract new () => T,
): T[] {
  const engine = requireEngine(this, 'getComponentsInChildren');
  const out: T[] = [];
  this.traverse((object) => {
    for (const c of engine.getComponents(object)) if (!c._destroyed && c instanceof type) out.push(c as T);
  });
  return out;
};

Object3D.prototype.addComponent = function addComponent<T extends Component>(
  this: Object3D,
  type: (new () => T) | string,
  props?: Partial<T>,
): T {
  return requireEngine(this, 'addComponent').addComponent(this, type as new () => T, props);
};

Object3D.prototype.removeComponent = function removeComponent(this: Object3D, instance: Component): void {
  requireEngine(this, 'removeComponent').destroyComponent(instance);
};

/** Nodes whose material has already been cloned, so repeat calls are free and don't pile up copies. */
const uniqueMaterials = new WeakSet<Object3D>();

Object3D.prototype.uniqueMaterial = function uniqueMaterial<T extends Material | Material[] = Material>(
  this: Object3D,
): T {
  const host = this as Object3D & { material?: Material | Material[] };
  const current = host.material;
  if (!current) {
    throw new Error(
      `uniqueMaterial(): <${this.sceneTag ?? this.type}>${this.sceneId ? ` id="${this.sceneId}"` : ''} has no material to clone. ` +
        `Only a node with a material attachment (a <Mesh>, and so on) has one.`,
    );
  }
  // Already ours — cloning again would orphan the copy the caller is holding.
  if (uniqueMaterials.has(this)) return current as T;
  // A multi-material mesh: every slot is shared, so every slot is cloned. Missing
  // it would leave the bug alive on all but the first submesh.
  host.material = Array.isArray(current) ? current.map((m) => m.clone()) : current.clone();
  uniqueMaterials.add(this);
  return host.material as T;
};
