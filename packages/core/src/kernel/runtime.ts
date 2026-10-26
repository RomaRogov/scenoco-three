import { Behaviour } from './Behaviour.js';
import type { System, SystemType } from './System.js';
import type { BehaviourInit, BehaviourType, ConstructableBehaviour, FitsNode, Node, NodeOf } from './types.js';

// The registry lives beside the scene graph, never on it: nothing on a node is patched, so
// whatever moves nodes — `add`, `attach`, `children.push`, a library — cannot get past it.
const behavioursOf = new WeakMap<Node, Behaviour[]>();
/** Nodes holding at least one behaviour. Membership is re-checked from here every frame. */
const hosts = new Set<Node>();
const runtimes = new Map<Node, Runtime>();
const destroyQueue: (Node | Behaviour)[] = [];

function rootOf(node: Node): Node {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

/** The runtime whose root this node is under, or null while it is in no running scene. */
export function runtimeOf(node: Node): Runtime | null {
  return runtimes.get(rootOf(node)) ?? null;
}

export interface RuntimeOptions {
  /** Seconds per `fixedUpdate`. Unity's default, 0.02. */
  fixedDelta?: number;
  /** The longest frame `update` is told about, so a stall does not become a teleport. */
  maxDelta?: number;
}

/**
 * Runs the behaviours under one root. It does not own a loop: call `update(dt)` from yours.
 *
 * A behaviour is live — receiving hooks — while its node is under `root` and it is enabled.
 * That is checked when a behaviour is added, and again at the top of every `update`.
 */
export class Runtime {
  /** The runtime created last — where `instantiate` puts things when no parent is given. */
  static current: Runtime | null = null;

  readonly root: Node;
  readonly fixedDelta: number;
  readonly maxDelta: number;
  /** Game seconds so far, at the start of this frame — `Time.time`. */
  time = 0;
  /** Real seconds so far — `Time.unscaledTime`. */
  unscaledTime = 0;
  frame = 0;
  /** How fast game time runs — `Time.timeScale`. */
  timeScale = 1;
  /** This frame's seconds, scaled; `fixedDelta` while `fixedUpdate` runs — `Time.deltaTime`. */
  deltaTime = 0;
  /** This frame's real seconds — `Time.unscaledDeltaTime`. */
  unscaledDeltaTime = 0;
  /** True while `update` runs the frame, so a host can tell game code from a DOM handler. */
  updating = false;

  /** @internal */ readonly live = new Set<Behaviour>();
  /** @internal */ readonly pendingStart: Behaviour[] = [];
  private readonly systems: System[] = [];
  private accumulator = 0;

  /**
   * How far the clock is between the last `fixedUpdate` and the next, 0..1 — what a system that
   * steps in `fixedUpdate` blends by in `update`, so motion stays smooth at any frame rate.
   */
  get interpolationAlpha(): number {
    return this.accumulator / this.fixedDelta;
  }

  constructor(root: Node, options: RuntimeOptions = {}) {
    if (runtimes.has(root)) throw new Error('This root already has a Runtime — dispose that one first.');
    this.root = root;
    this.fixedDelta = options.fixedDelta ?? 0.02;
    this.maxDelta = options.maxDelta ?? 1 / 3;
    runtimes.set(root, this);
    Runtime.current = this;
  }

  /** One frame: start, fixedUpdate (as many as are due), update, coroutines, lateUpdate, destroy. */
  update(realDt: number): void {
    const unscaled = Math.min(Math.max(realDt, 0), this.maxDelta);
    const dt = unscaled * this.timeScale;
    this.unscaledDeltaTime = unscaled;
    this.deltaTime = dt;
    this.time += dt;
    this.unscaledTime += unscaled;
    this.updating = true;
    try {
      this.tick(dt, unscaled);
    } finally {
      this.updating = false;
    }
    this.frame++;
  }

  private tick(dt: number, unscaled: number): void {
    for (const host of hosts) reconcileHost(host, this);

    for (const b of this.pendingStart.splice(0)) {
      if (this.isLive(b) && !b._started) {
        b._started = true;
        resolveRefs(b);
        b._refs = null;
        b.start?.();
      }
    }

    // Scaled, as in Unity: at timeScale 0 no fixedUpdate runs, and physics holds still.
    this.accumulator += dt;
    this.deltaTime = this.fixedDelta;
    while (this.accumulator >= this.fixedDelta) {
      this.accumulator -= this.fixedDelta;
      for (const b of this.snapshot()) if (this.ticks(b)) b.fixedUpdate?.(this.fixedDelta);
      for (const s of this.systems) s.fixedUpdate?.(this.fixedDelta);
    }
    this.deltaTime = dt;
    for (const b of this.snapshot()) if (this.ticks(b)) b.update?.(dt);
    for (const s of this.systems) s.update?.(dt);
    for (const b of this.snapshot()) {
      if (!this.ticks(b) || !b._coroutines) continue;
      // Over a copy, removing only what finished: a coroutine may start another mid-step
      // (`yield this.startCoroutine(…)`), and rebuilding the list would drop the newcomer.
      for (const c of b._coroutines.slice()) {
        if (!this.ticks(b)) break; // destroyed or disabled by an earlier one
        if (c.step(dt, unscaled)) continue;
        const i = b._coroutines?.indexOf(c) ?? -1;
        if (i !== -1) b._coroutines!.splice(i, 1);
      }
    }
    for (const b of this.snapshot()) if (this.ticks(b)) b.lateUpdate?.(dt);
    for (const s of this.systems) s.lateUpdate?.(dt);

    flushDestroyed();
  }

  /** This runtime's system of that class, made — and woken — on first ask. */
  requireSystem<T extends System>(type: SystemType<T>): T {
    const found = this.getSystem(type);
    if (found) return found;
    const created = new type();
    created.runtime = this;
    this.systems.push(created);
    created.awake?.();
    return created;
  }

  getSystem<T extends System>(type: SystemType<T>): T | null {
    return (this.systems.find((s) => s instanceof type) as T | undefined) ?? null;
  }

  /** Stop running: every live behaviour gets `onDisable`, every system `onDestroy`. */
  dispose(): void {
    for (const b of [...this.live]) setLive(b, null);
    for (const s of this.systems.splice(0)) s.onDestroy?.();
    runtimes.delete(this.root);
    if (Runtime.current === this) Runtime.current = null;
  }

  private snapshot(): Behaviour[] {
    return [...this.live];
  }

  private isLive(b: Behaviour): boolean {
    return b._live === this && !b._pendingDestroy;
  }

  /** Live and started: one made mid-frame — by a handler, by `instantiate` — waits for its `start`, as in Unity. */
  private ticks(b: Behaviour): boolean {
    return b._started && this.isLive(b);
  }
}

/** Bring one host's behaviours in line with where its node is now, as seen by `runtime`. */
function reconcileHost(host: Node, runtime: Runtime): void {
  const list = behavioursOf.get(host);
  if (!list) return;
  const where = runtimeOf(host);
  for (const b of list.slice()) {
    if (b._pendingDestroy || (where !== runtime && b._live !== runtime)) continue;
    if (where === runtime && !b._awoken) {
      b._awoken = true;
      resolveRefs(b);
      b.awake?.();
      if (b._pendingDestroy) continue;
    }
    setLive(b, where === runtime && b._enabled ? runtime : null);
  }
}

function setLive(b: Behaviour, runtime: Runtime | null): void {
  const was = b._live as Runtime | null;
  if (was === runtime) return;
  if (was) {
    was.live.delete(b);
    b._live = null;
    b.stopAllCoroutines();
    b.onDisable?.();
  }
  if (runtime) {
    b._live = runtime;
    runtime.live.add(b);
    b.onEnable?.();
    if (!b._started) runtime.pendingStart.push(b);
  }
}

/**
 * A package's per-scene service: the running scene's `System` of this class, made on first ask.
 * How a `Rigidbody` reaches its physics world from `awake` on. Game code has no use for it.
 */
export function service<T extends System>(node: Node, type: SystemType<T>): T {
  const runtime = runtimeOf(node);
  if (!runtime) throw new Error(`${type.name} needs a running scene — reach it from awake or later.`);
  return runtime.requireSystem(type);
}

/** Reconcile a node and everything under it now, rather than at the next frame. */
export function wake(node: Node): void {
  const runtime = runtimeOf(node);
  if (!runtime) return;
  const visit = (n: Node): void => {
    if (hosts.has(n)) reconcileHost(n, runtime);
    for (const child of n.children) visit(child);
  };
  visit(node);
}

/** @internal `enabled` changed. */
export function refreshBehaviour(b: Behaviour): void {
  if (!b._node || !b._awoken) return;
  const runtime = runtimeOf(b._node);
  setLive(b, runtime && b._enabled && !b._pendingDestroy ? runtime : null);
}

// --- attaching ------------------------------------------------------------------------------

/**
 * Construct a behaviour, apply its settings, attach it. If the node is already in a running scene,
 * `awake` and `onEnable` run before this returns — Unity's `AddComponent` — and `start` next frame.
 */
export function addComponent<T extends Behaviour, N extends Node>(
  node: N,
  type: (ConstructableBehaviour<T> | T) & FitsNode<N, T>,
  init?: BehaviourInit<T>,
): T {
  const b = addDormant(node as unknown as NodeOf<T>, type, init);
  wake(node);
  return b;
}

/** @internal `addComponent` without waking: JSX wakes once the commit has set every ref. */
export function addDormant<T extends Behaviour>(node: Node, type: ConstructableBehaviour<T> | T, init?: object): T {
  const b = typeof type === 'function' ? new type() : type;
  if (!(b instanceof Behaviour)) {
    throw new TypeError(`addComponent takes a Behaviour class — got ${String(type)}.`);
  }
  if (b._node) throw new Error(`This ${b.constructor.name} is already attached to another node.`);
  checkHooks(b.constructor);
  attachDormant(node, b);
  if (init) assignInit(b, init);
  return b;
}

// --- messages -------------------------------------------------------------------------------

/**
 * Unity's `SendMessage`: call `name` on every running behaviour on this node that has it. How an
 * extension — physics, input, audio — reaches behaviours without the kernel knowing it exists.
 */
export function sendMessage(node: Node, name: string, ...args: unknown[]): void {
  for (const b of behavioursOf.get(node)?.slice() ?? []) {
    const method = (b as unknown as Record<string, unknown>)[name];
    if (b._live && !b._pendingDestroy && typeof method === 'function') method.apply(b, args);
  }
}

/** Unity's `BroadcastMessage`: `sendMessage` to this node and everything under it. */
export function broadcastMessage(node: Node, name: string, ...args: unknown[]): void {
  sendMessage(node, name, ...args);
  for (const child of node.children.slice()) broadcastMessage(child, name, ...args);
}

/** An extension says which messages it sends, so a method named for one is no longer reported. */
export function declareMessages(names: readonly string[]): void {
  for (const name of names) NOT_SENT.delete(name);
}

const HOOKS = ['awake', 'onEnable', 'start', 'fixedUpdate', 'update', 'lateUpdate', 'onDisable', 'onDestroy'];
/** Unity messages nothing sends until an extension declares them — a method by one of these names would silently never run. */
const NOT_SENT = new Set(['onTriggerEnter', 'onTriggerExit', 'onTriggerStay', 'onCollisionEnter', 'onCollisionExit', 'onCollisionStay', 'onMouseDown', 'onMouseUp']);
const checked = new WeakSet<Function>();

/** A Unity habit that compiles and then does nothing gets said out loud, once per class. */
function checkHooks(type: Function): void {
  if (checked.has(type)) return;
  checked.add(type);
  const names = new Set<string>();
  for (let p = type.prototype; p && p !== Behaviour.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) names.add(name);
  }
  for (const hook of HOOKS) {
    const pascal = hook[0]!.toUpperCase() + hook.slice(1);
    if (names.has(pascal)) {
      throw new Error(`${type.name}.${pascal}() would never be called: hooks are camelCase here — ${hook}().`);
    }
  }
  for (const message of NOT_SENT) {
    const pascal = message[0]!.toUpperCase() + message.slice(1);
    if (names.has(message) || names.has(pascal)) {
      console.warn(
        `${type.name}.${names.has(message) ? message : pascal}() is a Unity message nothing sends here — ` +
          'nothing will call it. Physics messages come from a physics extension, once it is imported.',
      );
    }
  }
}

/** @internal attach without waking — `instantiate` wires a whole copy before anything wakes. */
export function attachDormant(node: Node, b: Behaviour): void {
  b._node = node as never;
  let list = behavioursOf.get(node);
  if (!list) behavioursOf.set(node, (list = []));
  list.push(b);
  hosts.add(node);
}

/**
 * Apply settings the way three.js and R3F do: an array into a vector (`fromArray`), a string into a
 * colour (`set`), a same-class value copied into the field's own instance, anything else assigned.
 */
export function assignInit(b: Behaviour, init: object): void {
  const target = b as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(init)) {
    if (isRef(value)) {
      if (isRef(target[key])) {
        const name = b.constructor.name;
        throw new Error(`<${name} ${key}={…}>: a ref given to a field arrives as the object it points at, so the field holds the object, not a ref. In ${name}, declare it as ${key}: Mesh | null = null (the object's own class) and read this.${key} directly.`);
      }
      // Not set yet while the scene is still being built: read at `awake`, and again at `start`.
      (b._refs ??= new Map()).set(key, value);
      target[key] = value.current;
      continue;
    }
    const current = target[key] as Record<string, unknown> | null | undefined;
    if (current && typeof current === 'object' && !('uuid' in current)) {
      if (Array.isArray(value) && typeof current.fromArray === 'function') {
        (current.fromArray as (a: unknown[]) => void)(value);
        continue;
      }
      if ((typeof value === 'string' || typeof value === 'number') && current.isColor === true) {
        (current.set as (v: unknown) => void)(value);
        continue;
      }
      if (value && typeof value === 'object' && value.constructor === current.constructor && typeof current.copy === 'function') {
        (current.copy as (v: unknown) => void)(value);
        continue;
      }
    }
    target[key] = value;
  }
}

/** A React ref, or any `{ current }` holder: a link to something that may not exist yet. */
function isRef(value: unknown): value is { current: unknown } {
  if (!value || typeof value !== 'object' || !('current' in value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return (proto === Object.prototype || proto === null) && Object.keys(value).length === 1;
}

/** Read every linked field from its ref. Kept until `start`, so a ref set late is still picked up. */
export function resolveRefs(b: Behaviour): void {
  if (!b._refs) return;
  const target = b as unknown as Record<string, unknown>;
  for (const [key, ref] of b._refs) if (ref.current != null) target[key] = ref.current;
}

/** The behaviours attached to a node, in attach order. */
export function behavioursOn(node: Node): readonly Behaviour[] {
  return behavioursOf.get(node) ?? [];
}

// --- lookups --------------------------------------------------------------------------------

function isA<T extends Behaviour>(b: Behaviour, type: BehaviourType<T>): b is T {
  return b instanceof type && !b._destroyed && !b._pendingDestroy;
}

function assertType(type: unknown): void {
  if (typeof type !== 'function') {
    const name = typeof type === 'string' ? type : 'Behaviour';
    throw new TypeError(`A behaviour is looked up by its class — getComponent(${name}) — not by ${JSON.stringify(type)}.`);
  }
}

export function getComponent<T extends Behaviour>(node: Node, type: BehaviourType<T>): T | null {
  assertType(type);
  for (const b of behavioursOf.get(node) ?? []) if (isA(b, type)) return b;
  return null;
}

export function getComponents<T extends Behaviour>(node: Node, type: BehaviourType<T>): T[] {
  assertType(type);
  return (behavioursOf.get(node) ?? []).filter((b): b is T => isA(b, type));
}

/** This node first, then depth-first below it. */
export function getComponentInChildren<T extends Behaviour>(node: Node, type: BehaviourType<T>): T | null {
  const own = getComponent(node, type);
  if (own) return own;
  for (const child of node.children) {
    const found = getComponentInChildren(child, type);
    if (found) return found;
  }
  return null;
}

export function getComponentsInChildren<T extends Behaviour>(node: Node, type: BehaviourType<T>, out: T[] = []): T[] {
  out.push(...getComponents(node, type));
  for (const child of node.children) getComponentsInChildren(child, type, out);
  return out;
}

/** This node first, then each parent up to the root. */
export function getComponentInParent<T extends Behaviour>(node: Node, type: BehaviourType<T>): T | null {
  for (let current: Node | null = node; current; current = current.parent) {
    const found = getComponent(current, type);
    if (found) return found;
  }
  return null;
}

/** The first behaviour of this class anywhere in a running scene — Unity's `FindObjectOfType`. */
export function findObjectOfType<T extends Behaviour>(type: BehaviourType<T>): T | null {
  assertType(type);
  for (const host of hosts) {
    if (!runtimeOf(host)) continue;
    const found = getComponent(host, type);
    if (found) return found;
  }
  return null;
}

/** Every behaviour of this class in a running scene — Unity's `FindObjectsOfType`. */
export function findObjectsOfType<T extends Behaviour>(type: BehaviourType<T>): T[] {
  assertType(type);
  const out: T[] = [];
  for (const host of hosts) if (runtimeOf(host)) out.push(...getComponents(host, type));
  return out;
}

// --- destruction ----------------------------------------------------------------------------

/**
 * Unity's `Destroy`: a behaviour, or a node with everything on and under it. Hooks stop at once;
 * `onDisable`/`onDestroy` run, and the node leaves its parent, at the end of the frame.
 */
export function destroy(target: Node | Behaviour): void {
  if (target instanceof Behaviour) {
    if (target._pendingDestroy || target._destroyed) return;
    target._pendingDestroy = true;
  } else {
    forEachBehaviour(target, (b) => (b._pendingDestroy = true));
  }
  destroyQueue.push(target);
}

function forEachBehaviour(node: Node, fn: (b: Behaviour) => void): void {
  // Over a copy: teardown takes each behaviour out of this very list.
  for (const b of behavioursOf.get(node)?.slice() ?? []) fn(b);
  for (const child of node.children) forEachBehaviour(child, fn);
}

const nodeHooks: ((node: Node) => void)[] = [];

/** @internal run after a destroyed node has left its parent — how the scene frees what it built. */
export function afterNodeDestroyed(hook: (node: Node) => void): void {
  if (!nodeHooks.includes(hook)) nodeHooks.push(hook);
}

/** @internal runs at the end of every `Runtime.update`. */
export function flushDestroyed(): void {
  while (destroyQueue.length) {
    for (const target of destroyQueue.splice(0)) {
      if (target instanceof Behaviour) teardown(target);
      else {
        forEachBehaviour(target, teardown);
        target.removeFromParent();
        for (const hook of nodeHooks) hook(target);
      }
    }
  }
}

function teardown(b: Behaviour): void {
  if (b._destroyed) return;
  setLive(b, null);
  if (b._awoken) b.onDestroy?.();
  b.stopAllCoroutines();
  for (const unsubscribe of b._subscriptions ?? []) unsubscribe();
  b._subscriptions = null;
  b._destroyed = true;
  const node = b._node;
  b._node = null;
  if (!node) return;
  const list = behavioursOf.get(node);
  if (!list) return;
  list.splice(list.indexOf(b), 1);
  if (list.length === 0) {
    behavioursOf.delete(node);
    hosts.delete(node);
  }
}
