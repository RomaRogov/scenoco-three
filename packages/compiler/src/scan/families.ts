import type { TagFamily } from '../model.js';

/**
 * Which base class puts a class in which family, nearest-first — the one classification three.js
 * does not have, and the only place it is written down.
 */
const FAMILIES: ReadonlyArray<readonly [string, TagFamily]> = [
  ['Object3D', 'node'],
  ['BufferGeometry', 'geometry'],
  ['Material', 'material'],
  ['Texture', 'texture'],
  // `Fog` and `FogExp2` are unrelated classes, so both are named.
  ['Fog', 'fog'],
  ['FogExp2', 'fog'],
];

/** The family of a class, from its own name and its base chain — `Texture` is a texture itself. */
export function familyOf(name: string, chain: readonly string[]): TagFamily | undefined {
  return FAMILIES.find(([base]) => base === name || chain.includes(base))?.[1];
}

/** A family whose values are objects a node is built *from*, rather than members of the tree. */
export function isAttachable(family: TagFamily): boolean {
  return family !== 'node';
}
