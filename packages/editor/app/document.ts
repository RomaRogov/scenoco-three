import { Color, Euler, Vector2, Vector3, type Object3D } from 'three';
import {
  Registry,
  elementType,
  getAttachmentDef,
  isArrayType,
  type Component,
  type CompiledScene,
  type EnumDef,
  type PropType,
  type PropertyType,
  type SceneGraph,
} from '@scenoco-three/core';
import type { NodeOrigin, SceneProvenance } from '@scenoco-three/compiler';
import type { EditOp, EditTarget } from '../dist/protocol.js';
import { UndoStack } from './commands.js';

export type TransformChannel = 'position' | 'rotation' | 'scale';
type Scalar = number | boolean | string | number[];
type AttrMap = Record<string, Scalar>;

/** A node's attachment slot as the inspector needs it. */
export interface AttachmentView {
  slot: number;
  tag: string;
  attrs: AttrMap;
  /** Inline attr props are editable (authored scene node, not src-loaded). */
  editable: boolean;
  /** `src=` file the attachment was loaded from (props read-only, src editable), else null. */
  src: string | null;
}

/**
 * The editable model of the loaded scene and the single funnel for every change.
 *
 * Each mutator builds an undoable command that writes to **both** the live
 * Three.js object (so the viewport updates) **and** the compiled scene (the
 * serialization source of truth). Net edits to save are derived by diffing the
 * live compiled scene against a snapshot taken at load — so undo/redo, which
 * rewinds the compiled scene, is reflected automatically with no extra bookkeeping.
 */
export class SceneDocument {
  private readonly compiled: CompiledScene;
  /** Pristine copy at load — diffed against `compiled` to produce save edits. */
  private original: CompiledScene;
  private readonly undo: UndoStack;
  private readonly listeners = new Set<() => void>();
  /** Attachment pool indices this document created via copy-on-write (mutate in place). */
  private readonly cowAttachments = new Set<number>();
  /** `src` edits (prefab instance / material) — no compiled home, tracked explicitly. */
  private readonly srcEdits = new Map<string, EditOp>();

  constructor(
    private readonly graph: SceneGraph,
    private readonly provenance?: SceneProvenance,
  ) {
    this.compiled = graph.compiled;
    this.original = structuredClone(graph.compiled);
    this.undo = new UndoStack(() => this.emit());
  }

  // ── editability (driven by provenance) ─────────────────────────────────────────

  /** Where a node came from — authored scene, a prefab instance root, or prefab-internal. */
  nodeOrigin(node: Object3D): NodeOrigin {
    const i = this.graph.nodeIndexOf.get(node);
    return (i !== undefined && this.provenance?.nodes[i]) || { kind: 'scene' };
  }
  /** Transform is editable on authored nodes and prefab-instance roots (their own override). */
  canEditTransform(node: Object3D): boolean {
    const k = this.nodeOrigin(node).kind;
    return k === 'scene' || k === 'prefab-root';
  }
  /** Components are editable only on authored scene nodes. */
  canEditComponents(node: Object3D): boolean {
    return this.nodeOrigin(node).kind === 'scene';
  }
  /** The prefab `src` of a prefab-instance root, else undefined. */
  prefabSrc(node: Object3D): string | undefined {
    const o = this.nodeOrigin(node);
    return o.kind === 'prefab-root' ? o.src : undefined;
  }
  private attachmentSrcOf(poolIndex: number): string | null {
    return this.provenance?.attachments[poolIndex] ?? null;
  }

  // ── subscription ───────────────────────────────────────────────────────────

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  get canUndo(): boolean {
    return this.undo.canUndo;
  }
  get canRedo(): boolean {
    return this.undo.canRedo;
  }
  /** Any unsaved change (cheap: scenes are small). */
  get isDirty(): boolean {
    return this.netEdits().length > 0;
  }

  undoLast(): void {
    this.undo.undo();
  }
  redoLast(): void {
    this.undo.redo();
  }

  // ── transform edits ──────────────────────────────────────────────────────────

  /** Set a node's position/scale (world units) or rotation (radians, XYZ). */
  setTransform(node: Object3D, channel: TransformChannel, value: number[], opts?: { coalesce?: boolean }): void {
    if (!this.canEditTransform(node)) return;
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const t = this.compiled.nodes[i]!.transform;
    const prev = t[channel].slice();
    const next = value.slice();
    if (numbersEqual(prev, next)) return; // no-op (e.g. an unchanged channel after a drag)
    this.undo.run({
      label: `${channel} ${node.name || node.type}`,
      coalesceKey: opts?.coalesce ? `node:${i}:${channel}` : undefined,
      apply: () => {
        t[channel] = next.slice();
        applyTransform(node, channel, next);
      },
      invert: () => {
        t[channel] = prev.slice();
        applyTransform(node, channel, prev);
      },
    });
  }

  setVisible(node: Object3D, value: boolean): void {
    if (!this.canEditTransform(node)) return;
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const t = this.compiled.nodes[i]!.transform;
    const prev = t.visible;
    if (prev === value) return;
    this.undo.run({
      label: `visible ${node.name || node.type}`,
      apply: () => {
        t.visible = value;
        node.visible = value;
      },
      invert: () => {
        t.visible = prev;
        node.visible = prev;
      },
    });
  }

  // ── component property edits ──────────────────────────────────────────────────

  /** Set a scalar/vector/color/bool/string `@property` in compiled form. */
  setComponentProp(
    component: Component,
    name: string,
    value: number | boolean | string | number[],
    opts?: { coalesce?: boolean },
  ): void {
    const ci = this.graph.componentIndexOf.get(component);
    if (ci === undefined) return;
    const cc = this.compiled.components[ci]!;
    if ((this.provenance?.nodes[cc.node]?.kind ?? 'scene') !== 'scene') return; // prefab content read-only
    const meta = Registry.getComponent(cc.type)?.meta.properties.get(name);
    if (!meta) return;
    const elem = elementType(meta.type);

    const field = component as unknown as Record<string, unknown>;
    const had = name in cc.props;
    if (had && valuesEqual(cc.props[name], value)) return; // no-op
    const prevCompiled = had ? structuredClone(cc.props[name]!) : undefined;
    const prevRuntime = cloneRuntime(field[name]);
    const nextRuntime = toRuntime(meta.type, value);
    this.undo.run({
      label: `${cc.type}.${name}`,
      coalesceKey: opts?.coalesce ? `comp:${ci}:${name}` : undefined,
      apply: () => {
        cc.props[name] = structuredClone(value);
        field[name] = cloneRuntime(nextRuntime);
      },
      invert: () => {
        if (had) cc.props[name] = structuredClone(prevCompiled!);
        else delete cc.props[name];
        field[name] = cloneRuntime(prevRuntime);
      },
    });
    void elem; // reserved: array-element handling lands with array editing
  }

  // ── attachment edits (geometry / material / scene settings) ─────────────────────

  /** The attachment slots on a node, with editability + src provenance for the inspector. */
  attachmentsOf(node: Object3D): AttachmentView[] {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return [];
    const sceneNode = this.nodeOrigin(node).kind === 'scene';
    return this.compiled.nodes[i]!.attachments.map((idx, slot) => {
      const asset = this.compiled.attachments[idx]!;
      const src = this.attachmentSrcOf(idx);
      return { slot, tag: asset.tag, attrs: asset.attrs as AttrMap, editable: sceneNode && src === null, src };
    });
  }

  /** Current compiled value of an attachment attr (fresh — editors read it per change). */
  attachmentAttr(node: Object3D, slot: number, attr: string): Scalar | undefined {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return undefined;
    const idx = this.compiled.nodes[i]!.attachments[slot];
    return idx === undefined ? undefined : (this.compiled.attachments[idx]!.attrs[attr] as Scalar | undefined);
  }

  /**
   * Set an inline attachment attribute, **copy-on-write**: the first edit clones the
   * pooled `CompiledAsset` into a private entry (so sibling nodes sharing it are
   * untouched); later edits mutate the private copy in place. The live resource is
   * rebuilt from the attachment's own builder, so it's unshared automatically.
   */
  setAttachmentProp(node: Object3D, slot: number, attr: string, value: Scalar, opts?: { coalesce?: boolean }): void {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const cnode = this.compiled.nodes[i]!;
    const curIdx = cnode.attachments[slot];
    if (curIdx === undefined) return;
    const src = this.compiled.attachments[curIdx]!;
    if (this.nodeOrigin(node).kind !== 'scene' || this.attachmentSrcOf(curIdx) !== null) return; // read-only
    const tag = src.tag;
    const reattach = (attrs: AttrMap) => getAttachmentDef(tag)?.make(attrs).attach({ node });

    if (this.cowAttachments.has(curIdx)) {
      // Already our private copy — mutate in place.
      const asset = src;
      const had = attr in asset.attrs;
      if (had && valuesEqual(asset.attrs[attr], value)) return;
      const prev = had ? structuredClone(asset.attrs[attr]!) : undefined;
      this.undo.run({
        label: `${tag}.${attr}`,
        coalesceKey: opts?.coalesce ? `att:${curIdx}:${attr}` : undefined,
        apply: () => {
          asset.attrs[attr] = structuredClone(value);
          reattach(asset.attrs as AttrMap);
        },
        invert: () => {
          if (had) asset.attrs[attr] = structuredClone(prev!);
          else delete asset.attrs[attr];
          reattach(asset.attrs as AttrMap);
        },
      });
      return;
    }

    if (valuesEqual(src.attrs[attr], value)) return; // no-op against the shared value
    const newIdx = this.compiled.attachments.length;
    const newAttrs = { ...structuredClone(src.attrs), [attr]: structuredClone(value) };
    this.undo.run({
      label: `${tag}.${attr}`,
      coalesceKey: opts?.coalesce ? `att:slot:${i}:${slot}:${attr}` : undefined,
      apply: () => {
        this.compiled.attachments[newIdx] = { tag, attrs: newAttrs };
        cnode.attachments[slot] = newIdx;
        this.cowAttachments.add(newIdx);
        reattach(newAttrs as AttrMap);
      },
      invert: () => {
        cnode.attachments[slot] = curIdx;
        this.cowAttachments.delete(newIdx);
        reattach(src.attrs as AttrMap);
      },
    });
  }

  /** Edit a prefab-instance node's `src` (save-only — reopen to see the swapped content). */
  setNodeSrc(node: Object3D, src: string): void {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined || this.nodeOrigin(node).kind !== 'prefab-root') return;
    const cnode = this.compiled.nodes[i]!;
    this.recordSrcEdit(`node:${i}:src`, { kind: 'node', nodeIndex: i, ...(cnode.id ? { id: cnode.id } : {}) }, src);
  }

  /** Edit a src-loaded attachment's `src` (save-only — reopen to see the swapped content). */
  setAttachmentSrc(node: Object3D, slot: number, src: string): void {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const idx = this.compiled.nodes[i]!.attachments[slot];
    if (idx === undefined || this.attachmentSrcOf(idx) === null) return;
    this.recordSrcEdit(`att:${i}:${slot}:src`, this.attachmentTarget(i, slot, this.compiled.attachments[idx]!.tag), src);
  }

  private recordSrcEdit(key: string, target: EditTarget, src: string): void {
    const prev = this.srcEdits.get(key);
    this.undo.run({
      label: `src ${key}`,
      coalesceKey: `src:${key}`,
      apply: () => void this.srcEdits.set(key, { target, attr: 'src', value: src }),
      invert: () => {
        if (prev) this.srcEdits.set(key, prev);
        else this.srcEdits.delete(key);
      },
    });
  }

  // ── persistence ───────────────────────────────────────────────────────────────

  /** The minimal set of changed attributes vs. the loaded source, for surgical save. */
  netEdits(): EditOp[] {
    const out: EditOp[] = [];
    this.compiled.nodes.forEach((node, i) => {
      const orig = this.original.nodes[i]!;
      const target = (): EditTarget => ({ kind: 'node', nodeIndex: i, ...(node.id ? { id: node.id } : {}) });
      if (!numbersEqual(node.transform.position, orig.transform.position))
        out.push({ target: target(), attr: 'position', value: node.transform.position.slice() });
      if (!numbersEqual(node.transform.rotation, orig.transform.rotation))
        out.push({ target: target(), attr: 'rotation', value: node.transform.rotation.slice() });
      if (!numbersEqual(node.transform.scale, orig.transform.scale))
        out.push({ target: target(), attr: 'scale', value: node.transform.scale.slice() });
      if (node.transform.visible !== orig.transform.visible)
        out.push({ target: target(), attr: 'visible', value: node.transform.visible });
    });
    this.compiled.components.forEach((comp, ci) => {
      const orig = this.original.components[ci]!;
      for (const [name, value] of Object.entries(comp.props)) {
        if (!isSavableScalar(value) || valuesEqual(value, orig.props[name])) continue;
        out.push({ target: this.componentTarget(ci), attr: name, value: value as number | boolean | string | number[] });
      }
    });
    // Attachment attrs: a slot whose pool index changed (copy-on-write) vs. its original asset.
    this.compiled.nodes.forEach((node, i) => {
      const orig = this.original.nodes[i]!;
      node.attachments.forEach((attIdx, slot) => {
        const origIdx = orig.attachments[slot];
        if (origIdx === undefined || attIdx === origIdx) return;
        const cur = this.compiled.attachments[attIdx]!;
        const base = this.original.attachments[origIdx]!;
        for (const [attr, val] of Object.entries(cur.attrs)) {
          if (!isSavableScalar(val) || valuesEqual(val, base.attrs[attr])) continue;
          out.push({ target: this.attachmentTarget(i, slot, cur.tag), attr, value: val as number | boolean | string | number[] });
        }
      });
    });
    // `src` edits (prefab instance / material) have no compiled home — tracked explicitly.
    out.push(...this.srcEdits.values());
    return out;
  }

  /** Mark the current state as the saved baseline (keeps the undo stack). */
  markSaved(): void {
    this.original = structuredClone(this.compiled);
    this.srcEdits.clear();
    this.emit();
  }

  /**
   * Re-apply a set of edits onto this (freshly loaded) document — used to preserve
   * the user's unsaved changes after a `src=` dependency reload. Resolution is by
   * id/tag/ordinal (best-effort): edits whose target no longer exists are dropped.
   */
  applyEdits(ops: EditOp[]): void {
    for (const op of ops) this.applyEdit(op);
  }

  private applyEdit(op: EditOp): void {
    const t = op.target;
    if (t.kind === 'node') {
      const node = this.nodeById(t.id);
      if (!node) return;
      if (op.attr === 'src') this.setNodeSrc(node, op.value as string);
      else if (op.attr === 'visible') this.setVisible(node, op.value as boolean);
      else if (op.attr === 'position' || op.attr === 'rotation' || op.attr === 'scale')
        this.setTransform(node, op.attr, op.value as number[]);
    } else if (t.kind === 'component') {
      const comp = this.componentByTarget(t.nodeId, t.type, t.ordinal);
      if (comp) this.setComponentProp(comp, op.attr, op.value);
    } else {
      const node = t.root ? this.graph.nodeByIndex[this.compiled.root] : this.nodeById(t.nodeId);
      if (!node) return;
      const slot = this.attachmentSlot(node, t.tag, t.ordinal);
      if (slot === undefined) return;
      if (op.attr === 'src') this.setAttachmentSrc(node, slot, op.value as string);
      else this.setAttachmentProp(node, slot, op.attr, op.value);
    }
  }

  private nodeById(id?: string): Object3D | undefined {
    if (!id) return undefined;
    const i = this.compiled.nodes.findIndex((n) => n.id === id);
    return i >= 0 ? this.graph.nodeByIndex[i] : undefined;
  }
  private componentByTarget(nodeId: string | undefined, type: string, ordinal: number): Component | undefined {
    if (!nodeId) return undefined;
    const ni = this.compiled.nodes.findIndex((n) => n.id === nodeId);
    if (ni < 0) return undefined;
    const ci = this.compiled.nodes[ni]!.components.filter((x) => this.compiled.components[x]!.type === type)[ordinal];
    if (ci === undefined) return undefined;
    for (const [inst, idx] of this.graph.componentIndexOf) if (idx === ci) return inst;
    return undefined;
  }
  private attachmentSlot(node: Object3D, tag: string, ordinal: number): number | undefined {
    const ni = this.graph.nodeIndexOf.get(node);
    if (ni === undefined) return undefined;
    const atts = this.compiled.nodes[ni]!.attachments;
    let count = 0;
    for (let slot = 0; slot < atts.length; slot++) {
      if (this.compiled.attachments[atts[slot]!]!.tag !== tag) continue;
      if (count === ordinal) return slot;
      count++;
    }
    return undefined;
  }

  private attachmentTarget(i: number, slot: number, tag: string): EditTarget {
    const node = this.compiled.nodes[i]!;
    const ordinal = node.attachments.slice(0, slot + 1).filter((idx) => this.compiled.attachments[idx]!.tag === tag).length - 1;
    return {
      kind: 'attachment',
      nodeIndex: i,
      ...(node.id ? { nodeId: node.id } : {}),
      ...(i === this.compiled.root ? { root: true } : {}),
      tag,
      ordinal,
    };
  }

  private componentTarget(ci: number): EditTarget {
    const cc = this.compiled.components[ci]!;
    const node = this.compiled.nodes[cc.node]!;
    const sameType = node.components.filter((x) => this.compiled.components[x]!.type === cc.type);
    return {
      kind: 'component',
      componentIndex: ci,
      nodeIndex: cc.node,
      ...(node.id ? { nodeId: node.id } : {}),
      type: cc.type,
      ordinal: sameType.indexOf(ci),
    };
  }
}

// ── value helpers ────────────────────────────────────────────────────────────────

function applyTransform(node: Object3D, channel: TransformChannel, v: number[]): void {
  if (channel === 'rotation') node.rotation.set(v[0]!, v[1]!, v[2]!);
  else node[channel].fromArray(v);
}

/** Compiled scalar → the Three.js-typed value a component field holds (mirrors instantiate). */
function toRuntime(type: PropertyType, value: number | boolean | string | number[]): unknown {
  const elem = elementType(type);
  if (isArrayType(type)) return (value as number[]).map((v) => toRuntimeScalar(elem, v));
  return toRuntimeScalar(elem, value as number | boolean | string | number[]);
}
function toRuntimeScalar(elem: PropType | { new (): unknown } | EnumDef, value: unknown): unknown {
  switch (elem) {
    case 'vec2':
      return new Vector2().fromArray(value as number[]);
    case 'vec3':
      return new Vector3().fromArray(value as number[]);
    case 'euler': {
      const e = value as number[];
      return new Euler(e[0]!, e[1]!, e[2]!);
    }
    case 'color':
      return new Color(value as number);
    default:
      return value;
  }
}

/** Clone a runtime value so undo snapshots don't alias live Three.js objects. */
function cloneRuntime(v: unknown): unknown {
  if (v == null) return v;
  const o = v as { isVector3?: boolean; isVector2?: boolean; isColor?: boolean; isEuler?: boolean; clone?: () => unknown };
  if (o.isVector2 || o.isVector3 || o.isColor) return o.clone!();
  if (o.isEuler) {
    const e = v as Euler;
    return new Euler(e.x, e.y, e.z, e.order);
  }
  return Array.isArray(v) ? v.map(cloneRuntime) : v;
}

const isSavableScalar = (v: unknown): boolean =>
  typeof v === 'number' ||
  typeof v === 'boolean' ||
  typeof v === 'string' ||
  (Array.isArray(v) && v.every((x) => typeof x === 'number'));

function numbersEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return numbersEqual(a as number[], b as number[]);
  return a === b;
}
