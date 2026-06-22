import { isScalarType, isArrayType, elementType, type PropertyType } from '../core/Registry.js';
import { isEnumType } from '../core/EnumRegistry.js';
import {
  ComponentFlag,
  NodeFlag,
  type Bundle,
  type BundleComponent,
  type BundleNode,
  type BundleTag,
  type BundleValue,
} from './bundle-format.js';
import type { NodeAttr } from './nodes.js';
import { attachmentAttrEntries, componentPropEntries, nodeAttrEntries, popcount } from './bundle-shared.js';
import type {
  CompiledAsset,
  CompiledComponent,
  CompiledNode,
  CompiledScene,
  CompiledTransform,
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
  const mask = data[1];
  return { tag, attrs: decodeAttrs(attachmentAttrEntries(tag), mask, data.slice(2), strings) };
}

function decodeNode(data: BundleNode, strings: string[]): CompiledNode {
  const tag = strings[data[0] as number]!;
  const flags = data[1] as number;
  const mask = data[2] as number;

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
  const mask = data[2] as number;

  const props: Record<string, CompiledValue> = {};
  let i = 3;
  let bit = 0;
  for (const [name, meta] of componentPropEntries(type)) {
    if (mask & (1 << bit)) {
      props[name] = decodePropValue(data[i++] as BundleValue, meta.type, strings);
    }
    bit++;
  }

  const component: CompiledComponent = { type, node: -1, props };
  if (flags & ComponentFlag.Id) component.id = strings[data[i++] as number]!;
  return component;
}

// ---- value helpers --------------------------------------------------------

function decodeAttrs(
  entries: [string, NodeAttr][],
  mask: number,
  values: BundleValue[],
  strings: string[],
): Record<string, CompiledScalar | CompiledScalar[]> {
  const out: Record<string, CompiledScalar | CompiledScalar[]> = {};
  let vi = 0;
  let bit = 0;
  for (const [name, meta] of entries) {
    if (mask & (1 << bit)) {
      out[name] = decodeAttrValue(values[vi++]!, meta.type, strings);
    } else {
      out[name] = meta.default !== undefined ? cloneDefault(meta.default) : isArrayType(meta.type) ? [] : 0;
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
  return type === 'string' ? strings[raw as number]! : (raw as CompiledScalar);
}

function decodePropValue(raw: BundleValue, type: PropertyType, strings: string[]): CompiledValue {
  if (isArrayType(type)) {
    return (raw as BundleValue[]).map((el) => decodePropValue(el, type[0], strings)) as CompiledValue;
  }
  // A prefab prop stores a plain index into the scene's prefabs[] pool; the
  // registered type disambiguates it from node/component refs.
  if (type === 'prefab') return { prefab: raw as number };
  if (isEnumType(type)) return type.valueKind === 'string' ? strings[raw as number]! : (raw as CompiledScalar);
  if (!isScalarType(type)) {
    const i = raw as number;
    return i < 0 ? { node: ~i } : { component: i };
  }
  if (type === 'string') return strings[raw as number]!;
  return raw as CompiledScalar;
}

function decodeTransform(arr: number[]): CompiledTransform {
  return {
    position: arr.slice(0, 3),
    rotation: arr.slice(3, 6),
    scale: arr.slice(6, 9),
    visible: arr[9] === 1,
  };
}

function identityTransform(): CompiledTransform {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true };
}

function cloneDefault(value: CompiledScalar | CompiledScalar[]): CompiledScalar | CompiledScalar[] {
  return Array.isArray(value) ? value.map((v) => (Array.isArray(v) ? [...v] : v)) : value;
}
