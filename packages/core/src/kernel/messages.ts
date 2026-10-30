/**
 * Unity's messages: `SendMessage` to the behaviours on a node, the names a package declares it
 * sends, and the check that says out loud when a hook is misspelled or a message is never sent.
 */
import { Behaviour } from './Behaviour.js';
import { behavioursOf } from './registry.js';
import type { Node } from './types.js';

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

const HOOKS = ['awake', 'onEnable', 'start', 'fixedUpdate', 'update', 'lateUpdate', 'onDisable', 'onDestroy', 'onValidate'];
/** Unity messages nothing sends until an extension declares them — a method by one of these names would silently never run. */
const NOT_SENT = new Set(['onTriggerEnter', 'onTriggerExit', 'onTriggerStay', 'onCollisionEnter', 'onCollisionExit', 'onCollisionStay', 'onControllerColliderHit', 'onTriggerEnter2D', 'onTriggerExit2D', 'onTriggerStay2D', 'onCollisionEnter2D', 'onCollisionExit2D', 'onCollisionStay2D', 'onJointBreak2D', 'onMouseDown', 'onMouseUp']);
const checked = new WeakSet<Function>();

/** @internal A Unity habit that compiles and then does nothing gets said out loud, once per class. */
export function checkHooks(type: Function): void {
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
