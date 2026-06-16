import { Registry, type PropertyMeta } from '../core/Registry.js';
import { getAttachmentDef, getNodeDef, type NodeAttr } from './nodes.js';
import type { CompiledScalar } from './types.js';

/**
 * Schema helpers shared by the bundle encoder and decoder, so both agree on the
 * attribute/property *order* (which the bitmasks index into) and on which
 * values are interned strings. Both derive the schema from the same registries.
 */

/** Ordered [name, meta] of a node tag's type-specific attributes. */
export function nodeAttrEntries(tag: string): [string, NodeAttr][] {
  return Object.entries(getNodeDef(tag)!.attrs);
}

/** Ordered [name, meta] of an attachment tag's attributes. */
export function attachmentAttrEntries(tag: string): [string, NodeAttr][] {
  return Object.entries(getAttachmentDef(tag)!.attrs);
}

/** Ordered [name, meta] of a component type's properties. */
export function componentPropEntries(type: string): [string, PropertyMeta][] {
  return [...Registry.getComponent(type)!.meta.properties];
}

/** Number of set bits — how many values a mask selects. */
export function popcount(n: number): number {
  let count = 0;
  for (let v = n >>> 0; v !== 0; v >>= 1) count += v & 1;
  return count;
}

/** Structural equality for compiled scalar values (numbers, bools, vec arrays). */
export function valueEquals(a: CompiledScalar | undefined, b: CompiledScalar | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}
