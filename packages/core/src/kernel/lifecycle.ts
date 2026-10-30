/**
 * A behaviour's life: woken (`awake`), live (`onEnable`, then the frame's hooks once `start` has
 * run) while its node is under a running root and it is enabled, and destroyed at the end of the
 * frame `destroy` was called in. `wake` brings a node in line now rather than at the next frame.
 */
import { Behaviour } from './Behaviour.js';
import { resolveRefs } from './init.js';
import { behavioursOf, hosts, runtimeOf } from './registry.js';
import type { Runtime } from './runtime.js';
import type { System, SystemType } from './System.js';
import type { Node } from './types.js';

/** @internal how far a runtime lets behaviours go: none at all, or up to and including a hook. */
export type Reach = 'none' | 'awake' | 'onEnable' | 'start' | 'frame';
const REACH: readonly Reach[] = ['none', 'awake', 'onEnable', 'start', 'frame'];

/** @internal */
export function reaches(runtime: Runtime, hook: Exclude<Reach, 'none'>): boolean {
  return REACH.indexOf(runtime.reach) >= REACH.indexOf(hook);
}


/** @internal Bring one host's behaviours in line with where its node is now, as seen by `runtime`. */
export function reconcileHost(host: Node, runtime: Runtime): void {
  const list = behavioursOf.get(host);
  if (!list) return;
  const where = runtimeOf(host);
  for (const b of list.slice()) {
    if (b._pendingDestroy || (where !== runtime && b._live !== runtime)) continue;
    // Held short of a hook, a behaviour waits there: the next reconcile past the limit goes on.
    if (where === runtime && !reaches(runtime, 'awake')) continue;
    if (where === runtime && !b._awoken) {
      b._awoken = true;
      resolveRefs(b);
      b.awake?.();
      if (b._pendingDestroy) continue;
    }
    if (where === runtime && !reaches(runtime, 'onEnable')) continue;
    setLive(b, where === runtime && b._enabled ? runtime : null);
  }
}

/** @internal live in `runtime`, or in none: `onEnable` and `onDisable` as it changes. */
export function setLive(b: Behaviour, runtime: Runtime | null): void {
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

// --- destruction ----------------------------------------------------------------------------

const destroyQueue: (Node | Behaviour)[] = [];

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
