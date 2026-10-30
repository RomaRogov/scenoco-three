/**
 * Putting a behaviour on a node — Unity's `AddComponent` — and what it was given there.
 */
import { Behaviour } from './Behaviour.js';
import { assignInit } from './init.js';
import { wake } from './lifecycle.js';
import { checkHooks } from './messages.js';
import { attachDormant } from './registry.js';
import type { BehaviourInit, ConstructableBehaviour, DrivesNode, FitsNode, Node, NodeOf } from './types.js';

/**
 * Construct a behaviour, apply its settings, attach it. If the node is already in a running scene,
 * `awake` and `onEnable` run before this returns — Unity's `AddComponent` — and `start` next frame.
 */
export function addComponent<T extends Behaviour, N extends Node>(node: N, type: ConstructableBehaviour<T> & DrivesNode<N>, init?: BehaviourInit<T>): T;
// The same check, as a conditional type whose failure is the message tsc prints: reached only when the
// call above does not fit.
export function addComponent<T extends Behaviour, N extends Node>(
  node: N,
  type: (ConstructableBehaviour<T> | T) & FitsNode<N, T>,
  init?: BehaviourInit<T>,
): T;
export function addComponent<T extends Behaviour, N extends Node>(
  node: N,
  type: ConstructableBehaviour<T> | T,
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
  if (init) {
    assignInit(b, init);
    written.set(b, Object.keys(init));
  }
  return b;
}

/** The fields each behaviour was given where it was made. */
const written = new WeakMap<object, string[]>();

/**
 * The fields a behaviour was given where it was made — its TSX element's attributes, or the object
 * `addComponent` was handed: `<BoxCollider size={…} />` wrote `size`. For a component that sizes
 * itself from its node when a field was left out.
 */
export function writtenOf(behaviour: object): readonly string[] {
  return written.get(behaviour) ?? [];
}
