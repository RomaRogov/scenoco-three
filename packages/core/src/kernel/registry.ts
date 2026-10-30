/**
 * Which behaviours are on which node, and which runtime runs under which root — kept beside the
 * scene graph, never on it — and every lookup through them: Unity's `GetComponent` family and
 * `FindObjectOfType`.
 */
import type { Behaviour } from './Behaviour.js';
import type { Runtime } from './runtime.js';
import type { BehaviourType, Node } from './types.js';

// The registry lives beside the scene graph, never on it: nothing on a node is patched, so
// whatever moves nodes — `add`, `attach`, `children.push`, a library — cannot get past it.
/** @internal */
export const behavioursOf = new WeakMap<Node, Behaviour[]>();
/** @internal Nodes holding at least one behaviour. Membership is re-checked from here every frame. */
export const hosts = new Set<Node>();
const runtimes = new Map<Node, Runtime>();

function rootOf(node: Node): Node {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

/** The runtime whose root this node is under, or null while it is in no running scene. */
export function runtimeOf(node: Node): Runtime | null {
  return runtimes.get(rootOf(node)) ?? null;
}

/** @internal `root` is run by `runtime` from now on. */
export function claimRoot(root: Node, runtime: Runtime): void {
  if (runtimes.has(root)) throw new Error('This root already has a Runtime — dispose that one first.');
  runtimes.set(root, runtime);
}

/** @internal `root` is run by nothing any more. */
export function releaseRoot(root: Node): void {
  runtimes.delete(root);
}

/** @internal attach without waking — `instantiate` wires a whole copy before anything wakes. */
export function attachDormant(node: Node, b: Behaviour): void {
  b._node = node as never;
  let list = behavioursOf.get(node);
  if (!list) behavioursOf.set(node, (list = []));
  list.push(b);
  hosts.add(node);
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
