import {
  getNodeDef,
  getAttachmentDef,
  isScalarType,
  Registry,
  TRANSFORM_ATTRS,
  valueEquals,
  type CompiledAsset,
  type CompiledComponent,
  type CompiledNode,
  type CompiledRef,
  type CompiledScalar,
  type CompiledScene,
  type CompiledValue,
  type NodeAttr,
} from '@scenoco-three/core/internal';
import { codecs, type ScalarType } from './types.js';

/**
 * Serialize a CompiledScene back to canonical, re-compilable XML — the inverse
 * of the compiler (minus validation). Used to write programmatic/agent edits
 * back to file form.
 *
 * The output is the **flat** form: prefab instances and material `src=` files
 * have already been expanded/inlined by the compiler, so they appear as ordinary
 * nodes and inline materials. Only non-default attributes are emitted. A
 * reference (`{ node|component: index }`) is written as `#id`; if its target had
 * no id, a stable unique one is synthesized so the reference survives the round
 * trip.
 */
export function serializeScene(scene: CompiledScene): string {
  const ids = assignIds(scene);
  const lines: string[] = [];
  emitNode(scene, scene.root, 0, ids, lines);
  return lines.join('\n') + '\n';
}

interface SceneIds {
  node: (index: number) => string; // defined only for ids'd / referenced nodes
  component: (index: number) => string;
  nodeHas: (index: number) => boolean;
  componentHas: (index: number) => boolean;
}

/** Resolve every node/component to an id, synthesizing unique ones for referenced-but-unnamed targets. */
function assignIds(scene: CompiledScene): SceneIds {
  const refNodes = new Set<number>();
  const refComponents = new Set<number>();
  for (const c of scene.components) {
    for (const v of Object.values(c.props)) {
      if (!isRef(v)) continue;
      if ('node' in v) refNodes.add(v.node);
      else if ('component' in v) refComponents.add(v.component);
    }
  }

  const taken = new Set<string>();
  for (const n of scene.nodes) if (n.id !== undefined) taken.add(n.id);
  for (const c of scene.components) if (c.id !== undefined) taken.add(c.id);

  const synth = (base: string): string => {
    let id = base;
    let i = 1;
    while (taken.has(id)) id = `${base}_${i++}`;
    taken.add(id);
    return id;
  };

  const nodeIds = new Map<number, string>();
  scene.nodes.forEach((n, i) => {
    if (n.id !== undefined) nodeIds.set(i, n.id);
    else if (refNodes.has(i)) nodeIds.set(i, synth(n.tag.toLowerCase()));
  });
  const componentIds = new Map<number, string>();
  scene.components.forEach((c, i) => {
    if (c.id !== undefined) componentIds.set(i, c.id);
    else if (refComponents.has(i)) componentIds.set(i, synth(c.type.toLowerCase()));
  });

  return {
    node: (i) => nodeIds.get(i)!,
    component: (i) => componentIds.get(i)!,
    nodeHas: (i) => nodeIds.has(i),
    componentHas: (i) => componentIds.has(i),
  };
}

function emitNode(scene: CompiledScene, index: number, depth: number, ids: SceneIds, out: string[]): void {
  const node = scene.nodes[index]!;
  const pad = '  '.repeat(depth);
  const attrs = nodeAttrs(node, index, ids);

  const hasAttachments = node.attachments.length > 0;
  const hasComponents = node.components.length > 0;
  const hasChildren = node.children.length > 0;
  if (!hasAttachments && !hasComponents && !hasChildren) {
    out.push(`${pad}<${node.tag}${attrs} />`);
    return;
  }

  out.push(`${pad}<${node.tag}${attrs}>`);
  const inner = '  '.repeat(depth + 1);
  for (const ai of node.attachments) out.push(`${inner}${attachmentTag(scene.attachments[ai]!)}`);
  if (hasComponents) {
    out.push(`${inner}<Components>`);
    for (const ci of node.components) out.push(`${inner}  ${componentTag(scene.components[ci]!, ci, ids)}`);
    out.push(`${inner}</Components>`);
  }
  for (const child of node.children) emitNode(scene, child, depth + 1, ids, out);
  out.push(`${pad}</${node.tag}>`);
}

// ---- attribute builders -----------------------------------------------------

function nodeAttrs(node: CompiledNode, index: number, ids: SceneIds): string {
  const parts: string[] = [];
  if (ids.nodeHas(index)) parts.push(attr('id', ids.node(index)));

  const t = node.transform;
  if (!isZero(t.position)) parts.push(attr('position', codecs.vec3.serialize(t.position)));
  if (!isZero(t.rotation)) parts.push(attr('rotation', codecs.euler.serialize(t.rotation)));
  if (!isOne(t.scale)) parts.push(attr('scale', codecs.vec3.serialize(t.scale)));
  if (!t.visible) parts.push(attr('visible', 'false'));

  appendDefaultedAttrs(parts, getNodeDef(node.tag)?.attrs ?? {}, node.attrs);
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function attachmentTag(asset: CompiledAsset): string {
  const parts: string[] = [];
  appendDefaultedAttrs(parts, getAttachmentDef(asset.tag)?.attrs ?? {}, asset.attrs);
  return `<${asset.tag}${parts.length > 0 ? ' ' + parts.join(' ') : ''} />`;
}

function componentTag(component: CompiledComponent, index: number, ids: SceneIds): string {
  const meta = Registry.getComponent(component.type)!.meta;
  const parts: string[] = [];
  if (ids.componentHas(index)) parts.push(attr('id', ids.component(index)));

  for (const [name, value] of Object.entries(component.props)) {
    const propMeta = meta.properties.get(name);
    if (!propMeta) continue;
    if (isRef(value)) {
      // A prefab prop embeds the compiled prefab; its original file path is not
      // retained, so it cannot be reconstructed as a `prefab="…"` attribute here.
      if ('prefab' in value) continue;
      const target = 'node' in value ? ids.node(value.node) : ids.component(value.component);
      parts.push(attr(name, `#${target}`));
    } else if (isScalarType(propMeta.type)) {
      parts.push(attr(name, codecs[propMeta.type].serialize(value)));
    }
  }
  return `<${component.type}${parts.length > 0 ? ' ' + parts.join(' ') : ''} />`;
}

/** Emit each attr whose value differs from the registry default. */
function appendDefaultedAttrs(
  parts: string[],
  defs: Record<string, NodeAttr>,
  values: Record<string, CompiledScalar>,
): void {
  for (const [name, meta] of Object.entries(defs)) {
    const value = values[name];
    if (value === undefined || valueEquals(value, meta.default)) continue;
    parts.push(attr(name, codecs[meta.type as ScalarType].serialize(value)));
  }
}

// ---- small helpers ----------------------------------------------------------

const attr = (name: string, value: string) => `${name}="${escapeXml(value)}"`;
const isRef = (v: CompiledValue): v is CompiledRef => typeof v === 'object' && v !== null && !Array.isArray(v);
const isZero = (v: number[]) => v.every((x) => x === 0);
const isOne = (v: number[]) => v.every((x) => x === 1);

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
