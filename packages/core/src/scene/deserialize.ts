import { isScalarType, isArrayType, elementType, type PropertyType } from '../registry/Registry.js';
import { ValueType } from '../registry/Registry.js';
import { isEnumType } from '../registry/EnumRegistry.js';
import {
  ComponentFlag,
  NodeFlag,
  type Bundle,
  type BundleComponent,
  type BundleNode,
  type BundleTag,
  type BundleValue,
} from './bundle-format.js';
import type { NodeAttr } from '../registry/NodeRegistry.js';
import {
  attachmentAttrEntries,
  componentPropEntries,
  maskHas,
  nodeAttrEntries,
  popcount,
  type BundleMask,
} from './bundle-shared.js';
import type {
  CompiledAsset,
  CompiledComponent,
  CompiledNode,
  CompiledScene,
  CompiledTransform,
  CompiledUniform,
  CompiledValue,
} from './compiled.js';
import type { CompiledScalar } from './types.js';

/**
 * Decode a bundle into a CompiledScene. This is the runtime's only "loader" —
 * it contains no XML and no parser, just array indexing against the registry
 * schema. The redundant back-pointers (`node.parent`, `component.node`) are
 * reconstructed from the children/components arrays rather than stored.
 */
export function deserializeBundle(bundle: Bundle): CompiledScene {
  const [, strings, asset] = bundle;
  const [nodeData, attachmentData, componentData, root, prefabData] = asset;

  const attachments = attachmentData.map((a) => decodeTag(a, strings));
  const components = componentData.map((c) => decodeComponent(c, strings));
  const nodes = nodeData.map((n) => decodeNode(n, strings));
  // Embedded prefabs are self-contained sub-bundles; decode each recursively.
  const prefabs = prefabData?.map((p) => deserializeBundle(p));

  // Rebuild parent pointers and component ownership from the forward arrays.
  nodes.forEach((node, i) => {
    for (const child of node.children) nodes[child]!.parent = i;
    for (const c of node.components) components[c]!.node = i;
  });

  return { root, nodes, attachments, components, ...(prefabs ? { prefabs } : {}) };
}

function decodeTag(data: BundleTag, strings: string[]): CompiledAsset {
  const tag = strings[data[0]]!;
  const mask = data[1] as BundleMask;
  const attrCount = popcount(mask);
  const attrs = decodeAttrs(attachmentAttrEntries(tag), mask, data.slice(2, 2 + attrCount), strings);
  const asset: CompiledAsset = { tag, attrs };
  // A trailing nested array (only on shader attachments) carries the uniforms.
  const uniforms = data[2 + attrCount];
  if (Array.isArray(uniforms)) asset.uniforms = uniforms.map((u) => decodeUniform(u as BundleValue[], strings));
  return asset;
}

function decodeUniform(u: BundleValue[], strings: string[]): CompiledUniform {
  const type = strings[u[1] as number]!;
  return { name: strings[u[0] as number]!, type, value: type === 'sampler2D' ? strings[u[2] as number]! : (u[2] as CompiledScalar) };
}

function decodeNode(data: BundleNode, strings: string[]): CompiledNode {
  const tag = strings[data[0] as number]!;
  const flags = data[1] as number;
  const mask = data[2] as BundleMask;

  const entries = nodeAttrEntries(tag);
  let i = 3;
  const attrCount = popcount(mask);
  const attrs = decodeAttrs(entries, mask, data.slice(i, i + attrCount), strings);
  i += attrCount;

  const node: CompiledNode = {
    tag,
    parent: -1,
    children: [],
    transform: identityTransform(),
    attrs,
    attachments: [],
    components: [],
  };

  if (flags & NodeFlag.Id) node.id = strings[data[i++] as number]!;
  if (flags & NodeFlag.Transform) node.transform = decodeTransform(data[i++] as number[]);
  if (flags & NodeFlag.Attachments) node.attachments = data[i++] as number[];
  if (flags & NodeFlag.Components) node.components = data[i++] as number[];
  if (flags & NodeFlag.Children) node.children = data[i++] as number[];
  return node;
}

function decodeComponent(data: BundleComponent, strings: string[]): CompiledComponent {
  const type = strings[data[0] as number]!;
  const flags = data[1] as number;
  const mask = data[2] as BundleMask;

  const props: Record<string, CompiledValue> = {};
  let i = 3;
  let bit = 0;
  for (const [name, meta] of componentPropEntries(type)) {
    if (maskHas(mask, bit)) {
      props[name] = decodePropValue(data[i++] as BundleValue, meta.type, strings);
    }
    bit++;
  }

  const component: CompiledComponent = { type, node: -1, props };
  if (flags & ComponentFlag.Id) component.id = strings[data[i++] as number]!;
  if (flags & ComponentFlag.Config) component.config = JSON.parse(strings[data[i++] as number]!);
  return component;
}

// ---- value helpers --------------------------------------------------------

function decodeAttrs(
  entries: [string, NodeAttr][],
  mask: BundleMask,
  values: BundleValue[],
  strings: string[],
): Record<string, CompiledScalar | CompiledScalar[]> {
  const out: Record<string, CompiledScalar | CompiledScalar[]> = {};
  let vi = 0;
  let bit = 0;
  for (const [name, meta] of entries) {
    if (maskHas(mask, bit)) {
      out[name] = decodeAttrValue(values[vi++]!, meta.type, strings);
    } else if (meta.default !== undefined) {
      // No-default attrs stay absent (mirrors compileAttrs) — the builder's
      // field keeps its initializer rather than a materialized zero value.
      out[name] = cloneDefault(meta.default);
    }
    bit++;
  }
  return out;
}

/** Decode a node/attachment attr value (string→pool lookup), mapping element-wise for arrays. */
function decodeAttrValue(raw: BundleValue, type: NodeAttr['type'], strings: string[]): CompiledScalar | CompiledScalar[] {
  if (isArrayType(type)) {
    return (raw as BundleValue[]).map((el) => decodeAttrValue(el, type[0], strings) as CompiledScalar);
  }
  if (isEnumType(type)) return type.valueKind === 'string' ? strings[raw as number]! : (raw as CompiledScalar);
  return type === ValueType.String ? strings[raw as number]! : (raw as CompiledScalar);
}

function decodePropValue(raw: BundleValue, type: PropertyType, strings: string[]): CompiledValue {
  if (isArrayType(type)) {
    return (raw as BundleValue[]).map((el) => decodePropValue(el, type[0], strings)) as CompiledValue;
  }
  // A prefab prop stores a plain index into the scene's prefabs[] pool; the
  // registered type disambiguates it from node/component refs.
  if (type === ValueType.Prefab) return { prefab: raw as number };
  if (isEnumType(type)) return type.valueKind === 'string' ? strings[raw as number]! : (raw as CompiledScalar);
  if (!isScalarType(type)) {
    const i = raw as number;
    return i < 0 ? { node: ~i } : { component: i };
  }
  if (type === ValueType.String) return strings[raw as number]!;
  return raw as CompiledScalar;
}

function decodeTransform(arr: number[]): CompiledTransform {
  return {
    position: arr.slice(0, 3),
    eulerAngles: arr.slice(3, 6),
    scale: arr.slice(6, 9),
    visible: arr[9] === 1,
  };
}

function identityTransform(): CompiledTransform {
  return { position: [0, 0, 0], eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true };
}

function cloneDefault(value: CompiledScalar | CompiledScalar[]): CompiledScalar | CompiledScalar[] {
  return Array.isArray(value) ? value.map((v) => (Array.isArray(v) ? [...v] : v)) : value;
}
