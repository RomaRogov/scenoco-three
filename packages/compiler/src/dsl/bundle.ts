import {
  isScalarType,
  BUNDLE_VERSION,
  ComponentFlag,
  NodeFlag,
  componentPropEntries,
  nodeAttrEntries,
  attachmentAttrEntries,
  valueEquals,
  type Bundle,
  type BundleAsset,
  type BundleComponent,
  type BundleKind,
  type BundleNode,
  type BundleTag,
  type BundleValue,
  type CompiledAsset,
  type CompiledComponent,
  type CompiledNode,
  type CompiledRef,
  type CompiledScene,
  type CompiledTransform,
} from '@scenoco-three/core/internal';
import type { CompiledScalar } from './types.js';

/**
 * Encode a CompiledScene into the optimized bundle (string pool + default
 * elision + TRS special-case + bitwise-NOT refs). Build-time only; the runtime
 * decoder reverses it. See bundle-format.ts for the wire layout.
 */
export function bundleScene(compiled: CompiledScene, kind: BundleKind = 'scene'): Bundle {
  const pool = buildStringPool(compiled);
  const intern = (s: string) => pool.index.get(s)!;

  const attachments = compiled.attachments.map((a) => encodeTag(a, intern));
  const components = compiled.components.map((c) => encodeComponent(c, intern));
  const nodes = compiled.nodes.map((n) => encodeNode(n, intern));

  // Embedded prefabs are self-contained sub-bundles (their own string pool), so
  // they nest cleanly; the slot is appended only when the scene uses one.
  const asset: BundleAsset = compiled.prefabs?.length
    ? [nodes, attachments, components, compiled.root, compiled.prefabs.map((p) => bundlePrefab(p))]
    : [nodes, attachments, components, compiled.root];
  // The `kind` slot is appended only for prefabs, so scene bundles stay at 3 elements.
  return kind === 'prefab' ? [BUNDLE_VERSION, pool.strings, asset, 'prefab'] : [BUNDLE_VERSION, pool.strings, asset];
}

/** Encode a prefab CompiledScene for runtime `engine.instantiate`. */
export function bundlePrefab(compiled: CompiledScene): Bundle {
  return bundleScene(compiled, 'prefab');
}

// ---- string pool ----------------------------------------------------------

function buildStringPool(compiled: CompiledScene): { strings: string[]; index: Map<string, number> } {
  const counts = new Map<string, number>();
  const add = (s: string | undefined) => {
    if (s !== undefined) counts.set(s, (counts.get(s) ?? 0) + 1);
  };

  const addStringAttrs = (entries: [string, { type: string }][], attrs: Record<string, CompiledScalar>) => {
    for (const [name, meta] of entries) {
      if (meta.type === 'string') add(attrs[name] as string | undefined);
    }
  };

  for (const n of compiled.nodes) {
    add(n.tag);
    add(n.id);
    addStringAttrs(nodeAttrEntries(n.tag), n.attrs);
  }
  for (const a of compiled.attachments) {
    add(a.tag);
    addStringAttrs(attachmentAttrEntries(a.tag), a.attrs);
  }
  for (const c of compiled.components) {
    add(c.type);
    add(c.id);
    for (const [name, meta] of componentPropEntries(c.type)) {
      if (meta.type === 'string' && name in c.props) add(c.props[name] as string);
    }
  }

  // Most-used strings first → smallest indices (cheapest in any varint codec).
  // Tie-break alphabetically so the bundle is deterministic.
  const strings = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([s]) => s);
  return { strings, index: new Map(strings.map((s, i) => [s, i])) };
}

// ---- records --------------------------------------------------------------

function encodeTag(asset: CompiledAsset, intern: (s: string) => number): BundleTag {
  const { mask, values } = encodeAttrs(attachmentAttrEntries(asset.tag), asset.attrs, intern);
  return [intern(asset.tag), mask, ...values];
}

function encodeNode(n: CompiledNode, intern: (s: string) => number): BundleNode {
  const { mask, values } = encodeAttrs(nodeAttrEntries(n.tag), n.attrs, intern);

  let flags = 0;
  const extras: BundleValue[] = [];
  if (n.id !== undefined) {
    flags |= NodeFlag.Id;
    extras.push(intern(n.id));
  }
  const trs = encodeTransform(n.transform);
  if (trs) {
    flags |= NodeFlag.Transform;
    extras.push(trs);
  }
  if (n.attachments.length > 0) {
    flags |= NodeFlag.Attachments;
    extras.push(n.attachments);
  }
  if (n.components.length > 0) {
    flags |= NodeFlag.Components;
    extras.push(n.components);
  }
  if (n.children.length > 0) {
    flags |= NodeFlag.Children;
    extras.push(n.children);
  }
  return [intern(n.tag), flags, mask, ...values, ...extras];
}

function encodeComponent(c: CompiledComponent, intern: (s: string) => number): BundleComponent {
  let mask = 0;
  const values: BundleValue[] = [];
  let bit = 0;
  for (const [name, meta] of componentPropEntries(c.type)) {
    if (name in c.props) {
      mask |= 1 << bit;
      values.push(encodePropValue(c.props[name]!, meta.type, intern));
    }
    bit++;
  }

  let flags = 0;
  const out: BundleComponent = [intern(c.type), 0, mask, ...values];
  if (c.id !== undefined) {
    flags |= ComponentFlag.Id;
    out.push(intern(c.id));
  }
  out[1] = flags;
  return out;
}

// ---- value helpers --------------------------------------------------------

function encodeAttrs(
  entries: [string, { type: string; default?: CompiledScalar }][],
  attrs: Record<string, CompiledScalar>,
  intern: (s: string) => number,
): { mask: number; values: BundleValue[] } {
  let mask = 0;
  const values: BundleValue[] = [];
  let bit = 0;
  for (const [name, meta] of entries) {
    const value = attrs[name];
    if (value !== undefined && !valueEquals(value, meta.default)) {
      mask |= 1 << bit;
      values.push(meta.type === 'string' ? intern(value as string) : value);
    }
    bit++;
  }
  return { mask, values };
}

/** Reference props use bitwise-NOT: component → `i`, node → `~i`. */
function encodePropValue(
  value: CompiledScalar | CompiledRef,
  type: string | object,
  intern: (s: string) => number,
): BundleValue {
  // A prefab prop stores a plain prefabs[] index (the registered type, not the
  // sign, tells the decoder it is a prefab — no collision with node/component).
  if (type === 'prefab') return (value as { prefab: number }).prefab;
  if (!isScalarType(type as never)) {
    const ref = value as CompiledRef;
    return 'component' in ref ? ref.component : ~(ref as { node: number }).node;
  }
  if (type === 'string') return intern(value as string);
  return value as CompiledScalar;
}

function encodeTransform(t: CompiledTransform): number[] | null {
  const isIdentity =
    t.position.every((v) => v === 0) &&
    t.rotation.every((v) => v === 0) &&
    t.scale.every((v) => v === 1) &&
    t.visible;
  if (isIdentity) return null;
  return [...t.position, ...t.rotation, ...t.scale, t.visible ? 1 : 0];
}
