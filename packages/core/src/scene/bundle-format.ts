/**
 * SceNoCo scene bundle — the optimized, XML-free format the runtime loads.
 *
 * Design follows the Cocos Creator compiled-bundle principles, adapted to the
 * fact that SceNoCo's type system is *known to the runtime* (the registry), so
 * we never ship class/schema definitions — only a string pool and per-instance
 * data. Optimizations applied:
 *
 *  - **Fixed-index arrays**, not keyed objects (no key strings on the wire).
 *  - **Frequency-sorted string pool**: tags, ids, and string values are interned
 *    once; instances reference them by integer (small ints in any varint codec).
 *  - **Default-value elision via bitmask**: only attributes that differ from the
 *    registry default are stored; a per-tag mask says which. A node at defaults
 *    carries almost no data.
 *  - **TRS special-case**: an identity transform is omitted entirely.
 *  - **Bitwise-NOT reference encoding**: a reference prop stores `i` for
 *    component[i] or `~i` for node[i] — one integer, no wrapper (unambiguous
 *    because the registry knows which props are references).
 *
 * v1 is JSON; the array-positional shape makes a later msgpack/binary wrapper a
 * drop-in. The decoder lives in the runtime; the encoder in the compiler.
 */

import type { CompiledScalar } from './types.js';

/**
 * A JSON-native wire value used positionally inside bundle records. Nested arrays
 * carry array-valued properties: each element is encoded with the per-element rule
 * (string→intern index, ref→signed int, scalar→passthrough).
 */
export type BundleValue = CompiledScalar | BundleValue[];

/**
 * What a bundle is for: a `scene` is loaded as the whole scene
 * (`engine.loadScene`); a `prefab` is a reusable subtree spawned at runtime
 * (`engine.instantiate`). Absent (older 3-element bundles) means `scene`.
 */
export type BundleKind = 'scene' | 'prefab';

export type Bundle = [
  version: number,
  strings: string[],
  scene: BundleAsset,
  kind?: BundleKind,
  /**
   * A scene's DOM UI overlay — the raw HTML of its sibling `*.ui.html`, mounted
   * over the canvas on load (see `Engine.overlay`). Appended only when the scene
   * has one; `kind` is then written explicitly so this stays at index 4.
   */
  ui?: string,
];

/** The bundle's kind, defaulting to `scene` for bundles that predate the marker. */
export function bundleKind(bundle: Bundle): BundleKind {
  return bundle[3] ?? 'scene';
}

/** The scene's DOM UI overlay HTML, if it declared a sibling `*.ui.html`. */
export function bundleUi(bundle: Bundle): string | undefined {
  return bundle[4];
}

export type BundleAsset = [
  nodes: BundleNode[],
  /** Content-addressed attachment pool (geometry/material/fog/…). */
  attachments: BundleTag[],
  components: BundleComponent[],
  root: number,
  /**
   * Embedded prefab sub-bundles, referenced by `prefab` props (one index each).
   * Appended only when the scene uses a prefab prop, so prefab-free bundles keep
   * their 4-element asset shape unchanged.
   */
  prefabs?: Bundle[],
];

/** Attachment: `[tagStringIndex, attrMask, ...nonDefaultValues]`. */
export type BundleTag = [number, number, ...BundleValue[]];

/**
 * Node: `[tagStringIndex, flags, attrMask, ...nonDefaultAttrValues, ...extras]`.
 * `extras` appear in flag-bit order: id, transform, attachments, components,
 * children (only those whose flag bit is set).
 */
export type BundleNode = BundleValue[];

/**
 * Component: `[typeStringIndex, flags, propMask, ...propValues, id?]`.
 * Only the `id` flag bit is used in `flags`; `propMask` selects which of the
 * component's registered properties are present.
 */
export type BundleComponent = BundleValue[];

// v3 unifies the old geometries/materials/settings pools into one `attachments`
// pool, and a node references its attachments by an index list.
export const BUNDLE_VERSION = 3;

/** Node flag bits (presence of optional sections). */
export const NodeFlag = {
  Id: 1 << 0,
  Transform: 1 << 1,
  Attachments: 1 << 2,
  Components: 1 << 3,
  Children: 1 << 4,
} as const;

/** Component flag bits. */
export const ComponentFlag = {
  Id: 1 << 0,
  /** Carries a build-time `config` blob compiled from the component's `src=` document (e.g. a particle system). */
  Config: 1 << 1,
} as const;
