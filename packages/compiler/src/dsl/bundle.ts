import {
  isScalarType,
  isEnumType,
  isArrayType,
  elementType,
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
  type CompiledUniform,
  type NodeAttr,
  type PropertyType,
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

  // Count every string that will be interned, including elements of string arrays.
  const isStringEncoded = (t: unknown) => t === 'string' || (isEnumType(t) && t.valueKind === 'string');
  const addStrings = (type: PropertyType, value: unknown) => {
    if (isArrayType(type)) {
      if (isStringEncoded(elementType(type)) && Array.isArray(value)) for (const el of value) add(el as string);
    } else if (isStringEncoded(type)) {
      add(value as string | undefined);
    }
  };
  const addStringAttrs = (entries: [string, NodeAttr][], attrs: Record<string, CompiledScalar | CompiledScalar[]>) => {
    for (const [name, meta] of entries) addStrings(meta.type, attrs[name]);
  };

  for (const n of compiled.nodes) {
    add(n.tag);
    add(n.id);
    addStringAttrs(nodeAttrEntries(n.tag), n.attrs);
  }
  for (const a of compiled.attachments) {
    add(a.tag);
    addStringAttrs(attachmentAttrEntries(a.tag), a.attrs);
    for (const u of a.uniforms ?? []) {
      add(u.name);
      add(u.type);
      if (u.type === 'sampler2D') add(u.value as string);
    }
  }
  for (const c of compiled.components) {
    add(c.type);
    add(c.id);
    for (const [name, meta] of componentPropEntries(c.type)) {
      if (name in c.props) addStrings(meta.type, c.props[name]);
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
  const tag: BundleTag = [intern(asset.tag), mask, ...values];
  // Shader uniforms (if any) trail the attr values as one nested array.
  if (asset.uniforms?.length) tag.push(asset.uniforms.map((u) => encodeUniform(u, intern)));
  return tag;
}

/** A uniform → `[nameIndex, typeIndex, value]` (sampler2D path interned, else raw). */
function encodeUniform(u: CompiledUniform, intern: (s: string) => number): BundleValue {
  const value = u.type === 'sampler2D' ? intern(u.value as string) : (u.value as CompiledScalar);
  return [intern(u.name), intern(u.type), value];
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
  entries: [string, NodeAttr][],
  attrs: Record<string, CompiledScalar | CompiledScalar[]>,
  intern: (s: string) => number,
): { mask: number; values: BundleValue[] } {
  let mask = 0;
  const values: BundleValue[] = [];
  let bit = 0;
  for (const [name, meta] of entries) {
    const value = attrs[name];
    if (value !== undefined && !valueEquals(value, meta.default)) {
      mask |= 1 << bit;
      values.push(encodeAttrValue(value, meta.type, intern));
    }
    bit++;
  }
  return { mask, values };
}

/** Encode a node/attachment attr value (string→pool index), mapping element-wise for arrays. */
function encodeAttrValue(
  value: CompiledScalar | CompiledScalar[],
  type: NodeAttr['type'],
  intern: (s: string) => number,
): BundleValue {
  if (isArrayType(type)) {
    return (value as CompiledScalar[]).map((el) => encodeAttrValue(el, type[0], intern));
  }
  if (isEnumType(type)) return type.valueKind === 'string' ? intern(value as string) : (value as CompiledScalar);
  return type === 'string' ? intern(value as string) : (value as CompiledScalar);
}

/**
 * Encode a component prop value. Reference props use bitwise-NOT (component → `i`,
 * node → `~i`); prefab → pool index; string → pool index; array → element-wise.
 */
function encodePropValue(
  value: CompiledScalar | CompiledRef | (CompiledScalar | CompiledRef)[],
  type: PropertyType,
  intern: (s: string) => number,
): BundleValue {
  if (isArrayType(type)) {
    return (value as (CompiledScalar | CompiledRef)[]).map((el) => encodePropValue(el, type[0], intern));
  }
  if (type === 'prefab') return (value as { prefab: number }).prefab;
  if (isEnumType(type)) return type.valueKind === 'string' ? intern(value as string) : (value as CompiledScalar);
  if (!isScalarType(type)) {
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
