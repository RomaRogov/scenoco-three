import { Registry, type PropertyMeta } from '../core/Registry.js';
import { getAttachmentDef, getNodeDef, type NodeAttr } from './nodes.js';

/**
 * Schema helpers shared by the bundle encoder and decoder, so both agree on the
 * attribute/property *order* (which the bitmasks index into) and on which
 * values are interned strings. Both derive the schema from the same registries.
 */

/**
 * A bundle references a tag/component that isn't registered in this process. The
 * decoder can't proceed without its schema, so fail with a message that names the
 * tag and how to register it — rather than the opaque `Cannot read properties of
 * undefined (reading 'attrs')` a bare deref would throw (the symptom an editor or
 * any host sees when a scene uses a tag whose module was never imported).
 */
function unregistered(kind: 'node' | 'attachment' | 'component', tag: string): never {
  throw new Error(
    `Cannot decode bundle: ${kind} "${tag}" is not registered. Import the module that ` +
      `declares it before loading the scene — a project file (via component discovery) or a ` +
      `tag package (pass it to the Vite plugin's registerPackages / the editor's --packages).`,
  );
}

/** Ordered [name, meta] of a node tag's type-specific attributes. */
export function nodeAttrEntries(tag: string): [string, NodeAttr][] {
  const def = getNodeDef(tag);
  if (!def) unregistered('node', tag);
  return Object.entries(def.attrs);
}

/** Ordered [name, meta] of an attachment tag's attributes. */
export function attachmentAttrEntries(tag: string): [string, NodeAttr][] {
  const def = getAttachmentDef(tag);
  if (!def) unregistered('attachment', tag);
  return Object.entries(def.attrs);
}

/** Ordered [name, meta] of a component type's properties. */
export function componentPropEntries(type: string): [string, PropertyMeta][] {
  const entry = Registry.getComponent(type);
  if (!entry) unregistered('component', type);
  return [...entry.meta.properties];
}

/** Number of set bits — how many values a mask selects. */
export function popcount(n: number): number {
  let count = 0;
  for (let v = n >>> 0; v !== 0; v >>= 1) count += v & 1;
  return count;
}

/** Structural equality for compiled values (numbers, bools, vec arrays, and nested arrays). */
export function valueEquals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valueEquals(x, b[i]));
  }
  return a === b;
}
