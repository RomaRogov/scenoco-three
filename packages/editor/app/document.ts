import { Color, Euler, MathUtils, Vector2, Vector3, type Object3D } from 'three';
import {
  Registry,
  elementType,
  detachAttachment,
  getAttachmentDef,
  getNodeDef,
  isArrayType,
  isEnumType,
  type Component,
  type CompiledAsset,
  type CompiledComponent,
  type CompiledNode,
  type CompiledRef,
  type CompiledScene,
  type CompiledValue,
  type Engine,
  type EnumDef,
  type PropType,
  type PropertyType,
  type SceneGraph,
} from '@scenoco-three/core';
import { ValueType } from '@scenoco-three/core';
import type { NodeOrigin, SceneProvenance } from '@scenoco-three/compiler';
import type { MemberRef, AgentEdit, EditOp, EditTarget, NodeRef, StructuralOp } from '../src/protocol.js';
import { isEditorOnly } from './meta.js';
import { UndoStack } from './commands.js';

export type TransformChannel = 'position' | 'eulerAngles' | 'scale';
type Scalar = number | boolean | string | number[];
type AttrMap = Record<string, Scalar>;

/**
 * The internal op-log entry. Reparent/remove match the wire `StructuralOp` exactly;
 * an insert keeps the pasted subtree's live compiled `rootIndex` (the fragment is
 * re-derived from the current model on demand), so `structuralOps()` reflects edits
 * made to a pasted node after the paste.
 */
type StructuralRecord =
  | { op: 'moveNode'; target: NodeRef; parent: NodeRef; index?: number }
  | { op: 'removeNode'; target: NodeRef }
  | { op: 'insertNode'; parent: NodeRef; index?: number; rootIndex: number }
  | { op: 'removeMember'; target: MemberRef }
  | { op: 'moveMember'; target: MemberRef; index: number }
  /** `memberIndex` points into compiled.components/attachments; resolved on send. */
  | { op: 'insertMember'; node: NodeRef; block: 'Components' | 'Attachments'; memberIndex: number };

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
  /**
   * Private (copy-on-write) attachment index → the pooled index it was copied from.
   * A Map rather than a Set so `netEdits` can diff by *identity*: slot position is
   * not stable once attachments can be reordered or removed.
   */
  private readonly cowAttachments = new Map<number, number>();
  /** `src` edits (prefab instance / material) — no compiled home, tracked explicitly. */
  private readonly srcEdits = new Map<string, EditOp>();
  /**
   * Structural changes (reparent/remove/insert) as an ordered op-log — structure
   * can't be diffed like attributes, so it's recorded. Applied to the source XML by
   * the server's CST splicer on save (comment-preserving); undo/redo keep it in sync.
   * An `insertNode` record keeps the pasted subtree's live compiled `rootIndex`, not
   * a fixed fragment: the fragment is re-derived from the current model at
   * `structuralOps()` time, so later edits to a pasted node are captured on save.
   */
  private readonly structural: StructuralRecord[] = [];
  /**
   * Compiled indices of deleted nodes. The compiled model is kept **index-stable**
   * (never spliced, so `nodeIndexOf` stays valid) — a delete tombstones the node
   * here and detaches it live; `netEdits`/`structuralOps` skip tombstoned nodes.
   */
  private readonly removed = new Set<number>();
  /** Deleted components, by compiled component index (tombstoned, not spliced). */
  private readonly removedComponents = new Set<number>();
  /** Deleted attachment slots, keyed `nodeIndex:slot` — keeps slot numbers stable. */
  private readonly removedAttachments = new Set<string>();
  /** Attachments added in this session: edited in place, never diffed against `original`. */
  private readonly addedAttachments = new Set<number>();

  constructor(
    private readonly graph: SceneGraph,
    private readonly provenance?: SceneProvenance,
    /** The live engine — needed to spawn pasted subtrees (`spawnSubtree`); absent in pure tests/overlays. */
    private readonly engine?: Engine,
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
    return this.netEdits().length > 0 || this.structural.length > 0;
  }

  undoLast(): void {
    this.undo.undo();
  }
  redoLast(): void {
    this.undo.redo();
  }

  // ── transform edits ──────────────────────────────────────────────────────────

  /** Set a node's position/scale (world units) or eulerAngles (degrees, XYZ). */
  setTransform(node: Object3D, channel: TransformChannel, value: number[], opts?: { coalesce?: boolean }): void {
    if (!this.canEditTransform(node)) return;
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const t = this.compiled.nodes[i]!.transform;
    const prev = t[channel].slice();
    const next = value.slice();
    if (numbersEqual(prev, next)) return; // no-op (e.g. an unchanged channel after a drag)
    this.undo.run({
      label: `${channel} ${node.sceneId || node.type}`,
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
      label: `visible ${node.sceneId || node.type}`,
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

  // ── node attribute edits ──────────────────────────────────────────────────────

  /** The compiled value of a node tag's own attribute (`<PerspectiveCamera fov>`). */
  nodeAttr(node: Object3D, attr: string): Scalar | undefined {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return undefined;
    // Unset in the XML → the registry default, so the row shows the value the
    // node was actually built with rather than a blank.
    const value = this.compiled.nodes[i]!.attrs[attr] ?? getNodeDef(node.sceneTag ?? '')?.attrs[attr]?.default;
    return value as Scalar | undefined;
  }

  /**
   * True when the attribute carries a value the file has to state — i.e. it exists
   * and differs from the `@property` default.
   *
   * Presence in `compiled.attrs` is *not* the test: the compiler materialises every
   * default into the compiled node, and the patcher removes an attribute whose
   * value equals its default. So "in the XML" and "differs from the default" are
   * the same condition, and this is what drives the inspector's unset styling and
   * its × (clear) button.
   */
  isNodeAttrSet(node: Object3D, attr: string): boolean {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return false;
    const value = this.compiled.nodes[i]!.attrs[attr];
    if (value === undefined) return false;
    const fallback = getNodeDef(node.sceneTag ?? '')?.attrs[attr]?.default;
    return fallback === undefined || !valuesEqual(value, fallback);
  }

  /**
   * Remove a node attribute from the document — the inspector's "clear" action.
   * The attribute disappears from the XML on save, and the node falls back to the
   * `@property` default (or stays genuinely unset when there is none).
   */
  clearNodeAttr(node: Object3D, attr: string): void {
    if (this.nodeOrigin(node).kind !== 'scene') return; // prefab content is read-only
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const attrs = this.compiled.nodes[i]!.attrs;
    if (!(attr in attrs)) return; // already absent — nothing to undo
    const prev = structuredClone(attrs[attr]!);
    this.undo.run({
      label: `clear ${node.sceneTag ?? node.type}.${attr}`,
      apply: () => {
        delete attrs[attr];
      },
      invert: () => {
        attrs[attr] = structuredClone(prev);
      },
    });
  }

  /**
   * Set a node tag's own attribute — the `@property` fields a `@node` class
   * declares (`fov`, `near`, `intensity`, …), as opposed to transform, attachment
   * or component values.
   *
   * These are **construction** parameters: `NodeDef.build(attrs)` consumes them
   * when the object is created, and core exposes no re-apply seam, so there is
   * nothing to write through to on the live object. The edit is therefore recorded
   * in the compiled model (undoable, and saved to the XML), and takes effect when
   * the scene is reloaded — the same contract as `setNodeSrc`.
   */
  setNodeAttr(node: Object3D, attr: string, value: Scalar, opts?: { coalesce?: boolean }): void {
    if (this.nodeOrigin(node).kind !== 'scene') return; // prefab content is read-only
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const attrs = this.compiled.nodes[i]!.attrs;
    const had = attr in attrs;
    if (had && valuesEqual(attrs[attr], value)) return;
    const prev = had ? structuredClone(attrs[attr]!) : undefined;
    this.undo.run({
      label: `${node.sceneTag ?? node.type}.${attr}`,
      coalesceKey: opts?.coalesce ? `nodeattr:${i}:${attr}` : undefined,
      apply: () => {
        attrs[attr] = structuredClone(value);
      },
      invert: () => {
        if (had) attrs[attr] = structuredClone(prev!);
        else delete attrs[attr];
      },
    });
  }

  // ── component property edits ──────────────────────────────────────────────────

  /**
   * True when the property carries a value the file has to state — it exists and
   * differs from the `@property` default. Same rule as `isNodeAttrSet`: the patcher
   * elides a value equal to its default, so "written in the XML" and "differs from
   * the default" are one condition.
   */
  isComponentPropSet(component: Component, name: string): boolean {
    const ci = this.graph.componentIndexOf.get(component);
    if (ci === undefined) return false;
    const cc = this.compiled.components[ci]!;
    const value = cc.props[name];
    if (value === undefined) return false;
    const fallback = Registry.getComponent(cc.type)?.meta.properties.get(name)?.default;
    return fallback === undefined || !valuesEqual(value, fallback);
  }

  /**
   * Remove a component property from the document — the inspector's × action. The
   * attribute disappears from the XML on save and the live field returns to its
   * `@property` default, so the viewport matches what a fresh load would produce.
   */
  clearComponentProp(component: Component, name: string): void {
    const ci = this.graph.componentIndexOf.get(component);
    if (ci === undefined) return;
    const cc = this.compiled.components[ci]!;
    if ((this.provenance?.nodes[cc.node]?.kind ?? 'scene') !== 'scene') return; // prefab content read-only
    const meta = Registry.getComponent(cc.type)?.meta.properties.get(name);
    if (!meta || !(name in cc.props)) return;

    const field = component as unknown as Record<string, unknown>;
    const prevCompiled = structuredClone(cc.props[name]!);
    const prevRuntime = cloneRuntime(field[name]);
    // Back to the declared default; with no default there is nothing to restore to,
    // so the live field is left as-is and only the source attribute is dropped.
    const defaultRuntime = meta.default !== undefined ? toRuntime(meta.type, meta.default as Scalar) : undefined;
    this.undo.run({
      label: `clear ${cc.type}.${name}`,
      apply: () => {
        delete cc.props[name];
        if (defaultRuntime !== undefined) field[name] = cloneRuntime(defaultRuntime);
      },
      invert: () => {
        cc.props[name] = structuredClone(prevCompiled);
        field[name] = cloneRuntime(prevRuntime);
      },
    });
  }

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
  }

  // ── attachment edits (geometry / material / scene settings) ─────────────────────

  /** The attachment slots on a node, with editability + src provenance for the inspector. */
  attachmentsOf(node: Object3D): AttachmentView[] {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return [];
    const sceneNode = this.nodeOrigin(node).kind === 'scene';
    return this.compiled.nodes[i]!.attachments.flatMap((idx, slot) => {
      if (this.removedAttachments.has(`${i}:${slot}`)) return [];
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

    if (this.cowAttachments.has(curIdx) || this.addedAttachments.has(curIdx)) {
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
        this.cowAttachments.set(newIdx, curIdx);
        reattach(newAttrs as AttrMap);
      },
      invert: () => {
        cnode.attachments[slot] = curIdx;
        this.cowAttachments.delete(newIdx);
        reattach(src.attrs as AttrMap);
      },
    });
  }

  /**
   * True when the attachment attribute is written in this scene's XML — it exists
   * and differs from the attachment's declared default. Same rule as nodes and
   * components; an inline `<SphereGeometry radius="0.3">` lives in this file, so
   * it is editable and clearable exactly like anything else here.
   */
  isAttachmentAttrSet(node: Object3D, slot: number, attr: string): boolean {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return false;
    const idx = this.compiled.nodes[i]!.attachments[slot];
    if (idx === undefined) return false;
    const asset = this.compiled.attachments[idx]!;
    const value = asset.attrs[attr];
    if (value === undefined) return false;
    const fallback = getAttachmentDef(asset.tag)?.attrs[attr]?.default;
    return fallback === undefined || !valuesEqual(value, fallback);
  }

  /**
   * Remove an attachment attribute — the inspector's × action. Mirrors
   * `setAttachmentProp`, including copy-on-write: a slot still pointing at the
   * shared pooled asset gets its own copy *without* the attribute, so clearing on
   * one node never strips it from a sibling sharing that asset.
   */
  clearAttachmentAttr(node: Object3D, slot: number, attr: string): void {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const cnode = this.compiled.nodes[i]!;
    const curIdx = cnode.attachments[slot];
    if (curIdx === undefined) return;
    const src = this.compiled.attachments[curIdx]!;
    if (this.nodeOrigin(node).kind !== 'scene' || this.attachmentSrcOf(curIdx) !== null) return; // read-only
    if (!(attr in src.attrs)) return;
    const tag = src.tag;
    const reattach = (attrs: AttrMap) => getAttachmentDef(tag)?.make(attrs).attach({ node });

    if (this.cowAttachments.has(curIdx) || this.addedAttachments.has(curIdx)) {
      const asset = src;
      const prev = structuredClone(asset.attrs[attr]!);
      this.undo.run({
        label: `clear ${tag}.${attr}`,
        apply: () => {
          delete asset.attrs[attr];
          reattach(asset.attrs as AttrMap);
        },
        invert: () => {
          asset.attrs[attr] = structuredClone(prev);
          reattach(asset.attrs as AttrMap);
        },
      });
      return;
    }

    const newIdx = this.compiled.attachments.length;
    const newAttrs = structuredClone(src.attrs);
    delete newAttrs[attr];
    this.undo.run({
      label: `clear ${tag}.${attr}`,
      apply: () => {
        this.compiled.attachments[newIdx] = { tag, attrs: newAttrs };
        cnode.attachments[slot] = newIdx;
        this.cowAttachments.set(newIdx, curIdx);
        reattach(newAttrs as AttrMap);
      },
      invert: () => {
        cnode.attachments[slot] = curIdx;
        this.cowAttachments.delete(newIdx);
        reattach(src.attrs as AttrMap);
      },
    });
  }

  // ── managing components / attachments (structural) ────────────────────────────

  /**
   * The node's live components paired with the compiled index and the ordinal the
   * splicer addresses them by, skipping deleted ones. `canMoveUp/Down` come from the
   * position among the node's *surviving* components.
   */
  componentsOf(node: Object3D): { component: Component; index: number; ordinal: number; canMoveUp: boolean; canMoveDown: boolean }[] {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return [];
    const perTag = new Map<string, number>();
    const live = this.compiled.nodes[i]!.components
      .filter((ci) => !this.removedComponents.has(ci))
      .map((ci) => {
        const type = this.compiled.components[ci]!.type;
        const ordinal = perTag.get(type) ?? 0;
        perTag.set(type, ordinal + 1);
        return { index: ci, ordinal, type };
      });
    return live.flatMap((entry, pos) => {
      const component = this.graph.nodeByIndex[i] ? this.componentAt(entry.index) : undefined;
      return component
        ? [{ component, index: entry.index, ordinal: entry.ordinal, canMoveUp: pos > 0, canMoveDown: pos < live.length - 1 }]
        : [];
    });
  }

  /** The live component instance for a compiled index. */
  private componentAt(ci: number): Component | undefined {
    for (const [component, idx] of this.graph.componentIndexOf) if (idx === ci) return component;
    return undefined;
  }

  /** Editing a node's structure is only allowed for content authored in this scene. */
  canEditStructure(node: Object3D): boolean {
    return this.nodeOrigin(node).kind === 'scene';
  }

  /**
   * Delete a component: destroyed live (Unity-style deferred), tombstoned in the
   * compiled model, and spliced out of the XML on save.
   */
  removeComponent(node: Object3D, component: Component): void {
    if (!this.canEditStructure(node)) return;
    const ci = this.graph.componentIndexOf.get(component);
    const i = this.graph.nodeIndexOf.get(node);
    if (ci === undefined || i === undefined || this.removedComponents.has(ci)) return;
    const cc = this.compiled.components[ci]!;
    const ordinal = this.componentOrdinal(i, ci);
    const op: StructuralRecord = {
      op: 'removeMember',
      target: { node: this.nodeRef(node), block: 'Components', tag: cc.type, ordinal },
    };
    this.undo.run({
      label: `delete ${cc.type}`,
      apply: () => {
        this.removedComponents.add(ci);
        this.engine?.destroyComponent(component);
        this.structural.push(op);
      },
      invert: () => {
        this.removedComponents.delete(ci);
        this.structural.splice(this.structural.indexOf(op), 1);
      },
    });
  }

  /** Reorder a component among its node's surviving components (`delta` −1 / +1). */
  moveComponent(node: Object3D, component: Component, delta: -1 | 1): void {
    if (!this.canEditStructure(node)) return;
    const i = this.graph.nodeIndexOf.get(node);
    const ci = this.graph.componentIndexOf.get(component);
    if (i === undefined || ci === undefined) return;
    const list = this.compiled.nodes[i]!.components;
    const live = list.filter((c) => !this.removedComponents.has(c));
    const from = live.indexOf(ci);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= live.length) return;
    const cc = this.compiled.components[ci]!;
    const ordinal = this.componentOrdinal(i, ci);
    const op: StructuralRecord = {
      op: 'moveMember',
      target: { node: this.nodeRef(node), block: 'Components', tag: cc.type, ordinal },
      index: to,
    };
    const before = list.slice();
    const next = live.slice();
    next.splice(from, 1);
    next.splice(to, 0, ci);
    this.undo.run({
      label: `move ${cc.type}`,
      apply: () => {
        this.compiled.nodes[i]!.components = next.slice();
        this.structural.push(op);
      },
      invert: () => {
        this.compiled.nodes[i]!.components = before.slice();
        this.structural.splice(this.structural.indexOf(op), 1);
      },
    });
  }

  /** Ordinal of a component among same-typed siblings on its node (splicer addressing). */
  private componentOrdinal(nodeIndex: number, ci: number): number {
    const type = this.compiled.components[ci]!.type;
    let n = 0;
    for (const c of this.compiled.nodes[nodeIndex]!.components) {
      if (c === ci) return n;
      if (!this.removedComponents.has(c) && this.compiled.components[c]!.type === type) n++;
    }
    return n;
  }

  /**
   * Whether an attachment slot may be deleted. The registry decides: a `required`
   * group must keep at least one member, so removing a `Mesh`'s only geometry is
   * refused rather than producing a scene that no longer validates.
   */
  canRemoveAttachment(node: Object3D, slot: number): boolean {
    if (!this.canEditStructure(node)) return false;
    const views = this.attachmentsOf(node);
    const view = views.find((v) => v.slot === slot);
    if (!view) return false;
    const def = getAttachmentDef(view.tag);
    if (!def?.required) return true;
    return views.filter((v) => getAttachmentDef(v.tag)?.group === def.group).length > 1;
  }

  /** Delete an attachment (structural; the viewport reflects it after a reload). */
  removeAttachment(node: Object3D, slot: number): void {
    if (!this.canRemoveAttachment(node, slot)) return;
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const idx = this.compiled.nodes[i]!.attachments[slot];
    if (idx === undefined) return;
    const tag = this.compiled.attachments[idx]!.tag;
    const key = `${i}:${slot}`;
    const op: StructuralRecord = {
      op: 'removeMember',
      target: { node: this.nodeRef(node), block: 'Attachments', tag, ordinal: this.attachmentOrdinal(i, slot) },
    };
    this.undo.run({
      label: `delete ${tag}`,
      apply: () => {
        this.removedAttachments.add(key);
        this.reapplyAttachments(node, tag);
        this.structural.push(op);
      },
      invert: () => {
        this.removedAttachments.delete(key);
        this.reapplyAttachments(node);
        this.structural.splice(this.structural.indexOf(op), 1);
      },
    });
  }

  /**
   * Rebuild the live node from its surviving attachments: reset the removed one's
   * host property (`detachAttachment`), then re-`attach` everything still present.
   * Re-applying the whole set rather than patching keeps the result correct even
   * when a group holds more than one member.
   */
  private reapplyAttachments(node: Object3D, removedTag?: string): void {
    if (removedTag) detachAttachment(node, removedTag);
    for (const view of this.attachmentsOf(node)) {
      getAttachmentDef(view.tag)?.make(view.attrs as AttrMap).attach({ node });
    }
  }

  /** Reorder an attachment among its node's surviving attachments (`delta` −1 / +1). */
  moveAttachment(node: Object3D, slot: number, delta: -1 | 1): void {
    if (!this.canEditStructure(node)) return;
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined) return;
    const cnode = this.compiled.nodes[i]!;
    const liveSlots = cnode.attachments.map((_, s) => s).filter((s) => !this.removedAttachments.has(`${i}:${s}`));
    const from = liveSlots.indexOf(slot);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= liveSlots.length) return;
    const idx = cnode.attachments[slot]!;
    const tag = this.compiled.attachments[idx]!.tag;
    const op: StructuralRecord = {
      op: 'moveMember',
      target: { node: this.nodeRef(node), block: 'Attachments', tag, ordinal: this.attachmentOrdinal(i, slot) },
      index: to,
    };
    const before = cnode.attachments.slice();
    const order = liveSlots.slice();
    order.splice(from, 1);
    order.splice(to, 0, slot);
    const next = order.map((s) => before[s]!);
    this.undo.run({
      label: `move ${tag}`,
      apply: () => {
        cnode.attachments = next.slice();
        this.structural.push(op);
      },
      invert: () => {
        cnode.attachments = before.slice();
        this.structural.splice(this.structural.indexOf(op), 1);
      },
    });
  }

  /**
   * Add a component to a node: instantiated live, appended to the compiled model,
   * and spliced into the XML on save. Undo destroys the instance again.
   */
  addComponent(node: Object3D, type: string): Component | undefined {
    if (!this.canEditStructure(node)) return undefined;
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined || Registry.getComponent(type) === undefined) return undefined;
    const ci = this.compiled.components.length;
    const cnode = this.compiled.nodes[i]!;
    const op: StructuralRecord = { op: 'insertMember', node: this.nodeRef(node), block: 'Components', memberIndex: ci };
    let instance: Component | undefined;
    this.undo.run({
      label: `add ${type}`,
      apply: () => {
        this.compiled.components[ci] = { type, node: i, props: {} };
        cnode.components = [...cnode.components, ci];
        instance = node.addComponent(type);
        this.graph.componentIndexOf.set(instance, ci);
        this.structural.push(op);
      },
      invert: () => {
        if (instance) {
          this.graph.componentIndexOf.delete(instance);
          this.engine?.destroyComponent(instance);
        }
        cnode.components = cnode.components.filter((c) => c !== ci);
        this.structural.splice(this.structural.indexOf(op), 1);
      },
    });
    return instance;
  }

  /**
   * Add an attachment to a node: applied live, appended to the compiled model, and
   * spliced into the XML on save. Undo detaches it and re-applies the survivors.
   */
  addAttachment(node: Object3D, tag: string): void {
    if (!this.canEditStructure(node)) return;
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined || getAttachmentDef(tag) === undefined) return;
    const idx = this.compiled.attachments.length;
    const cnode = this.compiled.nodes[i]!;
    const op: StructuralRecord = { op: 'insertMember', node: this.nodeRef(node), block: 'Attachments', memberIndex: idx };
    this.undo.run({
      label: `add ${tag}`,
      apply: () => {
        this.compiled.attachments[idx] = { tag, attrs: {} };
        cnode.attachments = [...cnode.attachments, idx];
        // Tracked separately from copy-on-write: it has no counterpart in `original`,
        // and its attributes ride along inside the insertMember element rather than
        // as patch edits.
        this.addedAttachments.add(idx);
        this.reapplyAttachments(node);
        this.structural.push(op);
      },
      invert: () => {
        cnode.attachments = cnode.attachments.filter((a) => a !== idx);
        this.addedAttachments.delete(idx);
        this.reapplyAttachments(node, tag);
        this.structural.splice(this.structural.indexOf(op), 1);
      },
    });
  }

  /** Ordinal of an attachment among same-tag siblings on its node (splicer addressing). */
  private attachmentOrdinal(nodeIndex: number, slot: number): number {
    const cnode = this.compiled.nodes[nodeIndex]!;
    const tag = this.compiled.attachments[cnode.attachments[slot]!]!.tag;
    let n = 0;
    for (let s = 0; s < cnode.attachments.length; s++) {
      if (s === slot) return n;
      if (this.removedAttachments.has(`${nodeIndex}:${s}`)) continue;
      if (this.compiled.attachments[cnode.attachments[s]!]!.tag === tag) n++;
    }
    return n;
  }

  /** Edit a prefab-instance node's `src` (save-only — reopen to see the swapped content). */
  setNodeSrc(node: Object3D, src: string): void {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined || this.nodeOrigin(node).kind !== 'prefab-root') return;
    this.recordSrcEdit(`node:${i}:src`, this.nodeTarget(i), src);
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

  // ── structural edits (reparent / remove / paste) ───────────────────────────────

  /**
   * Reparent `node` under `newParent` (append, or at `index` among its node
   * children). Mirrors the move on the **live** Three.js scene (so the viewport +
   * tree update immediately) and records a `moveNode` op for the save-time splicer.
   * A no-op if it would put a node inside itself/a descendant.
   */
  moveNode(node: Object3D, newParent: Object3D, index?: number): void {
    const oldParent = node.parent;
    if (!oldParent || node === newParent || this.isAncestor(node, newParent)) return;
    const oldIndex = oldParent.children.indexOf(node);
    const op: StructuralRecord = {
      op: 'moveNode',
      target: this.nodeRef(node),
      parent: this.nodeRef(newParent),
      ...(index !== undefined ? { index } : {}),
    };
    this.undo.run({
      label: 'move node',
      apply: () => {
        newParent.add(node); // Three.add detaches from the old parent first
        this.structural.push(op);
      },
      invert: () => {
        oldParent.add(node);
        const cur = oldParent.children.indexOf(node);
        if (cur !== -1 && oldIndex >= 0 && oldIndex <= oldParent.children.length - 1) {
          oldParent.children.splice(cur, 1);
          oldParent.children.splice(oldIndex, 0, node);
        }
        const i = this.structural.lastIndexOf(op);
        if (i !== -1) this.structural.splice(i, 1);
      },
    });
  }

  /**
   * Delete `node` (and its subtree): detach it from the **live** scene and tombstone
   * its compiled index so `netEdits`/`structuralOps` skip it, and record a
   * `removeNode` op. Undoable — undo re-attaches at the original position. Only
   * scene-origin nodes are removable (prefab content is read-only). Detaching (vs.
   * `destroy`) keeps the object alive for undo; its inert editor components stay
   * registered, exactly like `moveNode`.
   */
  removeNode(node: Object3D): void {
    const i = this.graph.nodeIndexOf.get(node);
    const parent = node.parent;
    if (i === undefined || !parent || this.nodeOrigin(node).kind !== 'scene') return;
    const oldIndex = parent.children.indexOf(node);
    const op: StructuralRecord = { op: 'removeNode', target: this.nodeRef(node) };
    this.undo.run({
      label: 'delete node',
      apply: () => {
        node.removeFromParent();
        this.removed.add(i);
        this.structural.push(op);
      },
      invert: () => {
        parent.add(node);
        const cur = parent.children.indexOf(node);
        if (cur !== -1 && oldIndex >= 0 && oldIndex <= parent.children.length - 1) {
          parent.children.splice(cur, 1);
          parent.children.splice(oldIndex, 0, node);
        }
        this.removed.delete(i);
        const s = this.structural.lastIndexOf(op);
        if (s !== -1) this.structural.splice(s, 1);
      },
    });
  }

  /**
   * A self-contained `CompiledScene` fragment for the subtree rooted at `node`, for
   * the clipboard (copy/cut). `id`s are **stripped** so a paste can't collide with an
   * existing id in the live index or on save (add ids back via `setId`); internal
   * component→node/component references are remapped, references outside the subtree
   * are dropped. Pure — touches neither the engine nor the server. `null` if `node`
   * isn't a known scene node.
   */
  copyFragment(node: Object3D): CompiledScene | null {
    const root = this.graph.nodeIndexOf.get(node);
    if (root === undefined || this.removed.has(root)) return null;
    return this.fragmentFromIndex(root, true);
  }

  /**
   * Paste a `CompiledScene` fragment as a new subtree under `parent` (append, or at
   * `index`). Spawns it **live** via `Engine.spawnSubtree` (no server/recompile),
   * merges it into this document's compiled model + graph maps so the pasted nodes
   * are immediately selectable, movable, deletable, **and** attribute-editable, and
   * records an `insertNode` op. Undo removes + tears down the spawned subtree; redo
   * re-spawns it. Returns the spawned root (for selecting it); `undefined` without an
   * engine (pure tests/overlays).
   */
  pasteFragment(fragment: CompiledScene, parent: Object3D, index?: number): Object3D | undefined {
    const engine = this.engine;
    const parentIndex = this.graph.nodeIndexOf.get(parent);
    if (!engine || parentIndex === undefined) return undefined;
    const parentRef = this.nodeRef(parent);
    const sizes = { nodes: fragment.nodes.length, components: fragment.components.length, attachments: fragment.attachments.length };
    let record: { op: 'insertNode'; parent: NodeRef; index?: number; rootIndex: number } | undefined;
    let spawnedRoot: Object3D | undefined;
    this.undo.run({
      label: 'paste node',
      apply: () => {
        const live = engine.spawnSubtree(fragment, parent, index);
        spawnedRoot = live.root;
        const rootIndex = this.appendFragment(fragment, live, parentIndex);
        record = { op: 'insertNode', parent: parentRef, ...(index !== undefined ? { index } : {}), rootIndex };
        this.structural.push(record);
      },
      invert: () => {
        if (spawnedRoot) {
          spawnedRoot.removeFromParent(); // immediate; teardown (unregister/dispose) flushes end-of-tick
          engine.destroy(spawnedRoot);
          spawnedRoot = undefined;
        }
        this.trimFragment(parentIndex, sizes);
        if (record) {
          const s = this.structural.lastIndexOf(record);
          if (s !== -1) this.structural.splice(s, 1);
          record = undefined;
        }
      },
    });
    return spawnedRoot;
  }

  /** The ordered structural op-log to send on save (applied before attribute edits). */
  structuralOps(): StructuralOp[] {
    return this.structural.map((rec) => {
      if (rec.op === 'insertNode') {
        return { op: 'insertNode' as const, parent: rec.parent, ...(rec.index !== undefined ? { index: rec.index } : {}), fragment: this.fragmentFromIndex(rec.rootIndex, false) };
      }
      if (rec.op === 'insertMember') {
        // Read the member fresh: anything edited after it was added rides along,
        // the same way a pasted node's later edits do.
        const member =
          rec.block === 'Components'
            ? ({ kind: 'component', value: this.compiled.components[rec.memberIndex]! } as const)
            : ({ kind: 'attachment', value: this.compiled.attachments[rec.memberIndex]! } as const);
        return { op: 'insertMember' as const, node: rec.node, block: rec.block, member };
      }
      return rec;
    });
  }

  /** Address a node for the splicer: the scene root as `path:[]`, else by `id`, else structural path. */
  private nodeRef(node: Object3D): NodeRef {
    if (!node.parent) return { path: [] }; // the scene root (THREE.Scene)
    if (node.sceneId) return { id: node.sceneId };
    return { path: this.pathOf(node), tag: node.sceneTag ?? node.type };
  }

  /** Ordinals among node-kind siblings (editor-only helpers excluded) from the root. */
  private pathOf(node: Object3D): number[] {
    const path: number[] = [];
    for (let cur: Object3D = node; cur.parent; cur = cur.parent) {
      const sibs = cur.parent.children.filter((c) => !isEditorOnly(c));
      path.unshift(sibs.indexOf(cur));
    }
    return path;
  }

  private isAncestor(node: Object3D, maybe: Object3D): boolean {
    for (let o: Object3D | null = maybe; o; o = o.parent) if (o === node) return true;
    return false;
  }

  /**
   * Rename (or set) a scene node's `id`. Updates the live `sceneId` + compiled `id`;
   * undoable. No-op if empty, unchanged, a duplicate of another live node's id, or on
   * prefab content. The save edit is addressed by the **loaded** id (see `nodeTarget`),
   * so the rename resolves in the file, which still holds the old id until save.
   */
  setId(node: Object3D, newId: string): void {
    const i = this.graph.nodeIndexOf.get(node);
    if (i === undefined || this.nodeOrigin(node).kind !== 'scene') return;
    const id = newId.trim();
    const prev = this.compiled.nodes[i]!.id;
    if (!id || id === prev) return;
    if (this.compiled.nodes.some((n, j) => j !== i && !this.removed.has(j) && n.id === id)) return; // clash
    this.undo.run({
      label: `id ${node.sceneTag ?? node.type}`,
      apply: () => {
        this.compiled.nodes[i]!.id = id;
        node.sceneId = id;
      },
      invert: () => {
        if (prev !== undefined) this.compiled.nodes[i]!.id = prev;
        else delete this.compiled.nodes[i]!.id;
        node.sceneId = prev;
      },
    });
  }

  /**
   * Build a self-contained `CompiledScene` fragment for the subtree at compiled index
   * `root` (`root` node becomes fragment index 0). Attachments/components it uses are
   * cloned + reindexed; internal refs are remapped and external ones dropped. `stripIds`
   * clears ids (clipboard copy — avoids collisions); the save path keeps them (so ids
   * added to a pasted node survive). Reads only the compiled model — no engine/server.
   */
  private fragmentFromIndex(root: number, stripIds: boolean): CompiledScene {
    const order: number[] = [];
    const visit = (i: number): void => {
      order.push(i);
      for (const c of this.compiled.nodes[i]!.children) if (!this.removed.has(c)) visit(c);
    };
    visit(root);
    const nodeMap = new Map<number, number>();
    order.forEach((old, n) => nodeMap.set(old, n));

    const attachments: CompiledAsset[] = [];
    const attMap = new Map<number, number>();
    const componentSrc: number[] = [];
    const compMap = new Map<number, number>();
    for (const old of order) {
      const src = this.compiled.nodes[old]!;
      for (const ai of src.attachments) if (!attMap.has(ai)) { attMap.set(ai, attachments.length); attachments.push(structuredClone(this.compiled.attachments[ai]!)); }
      for (const ci of src.components) if (!compMap.has(ci)) { compMap.set(ci, componentSrc.length); componentSrc.push(ci); }
    }

    const nodes: CompiledNode[] = order.map((old, n) => {
      const src = this.compiled.nodes[old]!;
      const node: CompiledNode = {
        tag: src.tag,
        parent: n === 0 ? -1 : nodeMap.get(src.parent)!,
        children: src.children.filter((c) => !this.removed.has(c)).map((c) => nodeMap.get(c)!),
        transform: structuredClone(src.transform),
        attrs: structuredClone(src.attrs),
        attachments: src.attachments.map((a) => attMap.get(a)!),
        components: src.components.map((c) => compMap.get(c)!),
      };
      if (!stripIds && src.id !== undefined) node.id = src.id;
      return node;
    });

    const components: CompiledComponent[] = componentSrc.map((ci) => {
      const src = this.compiled.components[ci]!;
      const comp: CompiledComponent = { type: src.type, node: nodeMap.get(src.node)!, props: {} };
      if (!stripIds && src.id !== undefined) comp.id = src.id;
      if (src.config !== undefined) comp.config = structuredClone(src.config);
      for (const [name, value] of Object.entries(src.props)) {
        const remapped = remapRefs(value as CompiledValue, nodeMap, compMap);
        if (remapped !== DROP) comp.props[name] = remapped;
      }
      return comp;
    });

    return { root: 0, nodes, attachments, components };
  }

  /** Merge a spawned fragment into the compiled model + graph maps (append at the tail; index-stable). Returns the pasted root's compiled index. */
  private appendFragment(fragment: CompiledScene, live: { nodes: Object3D[]; components: { instance: Component }[] }, parentIndex: number): number {
    const nodeBase = this.compiled.nodes.length;
    const compBase = this.compiled.components.length;
    const attBase = this.compiled.attachments.length;
    for (const a of fragment.attachments) this.compiled.attachments.push(structuredClone(a));
    fragment.nodes.forEach((n, i) => {
      this.compiled.nodes.push({
        ...(n.id !== undefined ? { id: n.id } : {}),
        tag: n.tag,
        parent: i === fragment.root ? parentIndex : n.parent + nodeBase,
        children: n.children.map((c) => c + nodeBase),
        transform: structuredClone(n.transform),
        attrs: structuredClone(n.attrs),
        attachments: n.attachments.map((a) => a + attBase),
        components: n.components.map((c) => c + compBase),
      });
    });
    this.compiled.nodes[parentIndex]!.children.push(nodeBase + fragment.root);
    fragment.components.forEach((c) => {
      const props: Record<string, CompiledValue> = {};
      for (const [name, value] of Object.entries(c.props)) props[name] = rebaseRefs(value as CompiledValue, nodeBase, compBase);
      this.compiled.components.push({
        ...(c.id !== undefined ? { id: c.id } : {}),
        type: c.type,
        node: c.node + nodeBase,
        props,
        ...(c.config !== undefined ? { config: structuredClone(c.config) } : {}),
      });
    });
    live.nodes.forEach((obj, i) => {
      const gi = nodeBase + i;
      this.graph.nodeByIndex[gi] = obj;
      this.graph.nodeIndexOf.set(obj, gi);
    });
    live.components.forEach(({ instance }, i) => this.graph.componentIndexOf.set(instance, compBase + i));
    return nodeBase + fragment.root;
  }

  /** Undo a paste: drop the appended compiled entries + graph maps from the tail (fragment root is index 0). */
  private trimFragment(parentIndex: number, sizes: { nodes: number; components: number; attachments: number }): void {
    const nodeStart = this.compiled.nodes.length - sizes.nodes;
    const kids = this.compiled.nodes[parentIndex]!.children;
    const ki = kids.indexOf(nodeStart); // fragment.root === 0 → the first appended node
    if (ki !== -1) kids.splice(ki, 1);
    for (let gi = nodeStart; gi < this.compiled.nodes.length; gi++) {
      const obj = this.graph.nodeByIndex[gi];
      if (obj) this.graph.nodeIndexOf.delete(obj);
    }
    const compStart = this.compiled.components.length - sizes.components;
    for (const [inst, idx] of [...this.graph.componentIndexOf]) if (idx >= compStart) this.graph.componentIndexOf.delete(inst);
    this.compiled.nodes.length = nodeStart;
    this.graph.nodeByIndex.length = nodeStart;
    this.compiled.components.length = compStart;
    this.compiled.attachments.length -= sizes.attachments;
  }

  // ── persistence ───────────────────────────────────────────────────────────────

  /** The minimal set of changed attributes vs. the loaded source, for surgical save. */
  netEdits(): EditOp[] {
    const out: EditOp[] = [];
    this.compiled.nodes.forEach((node, i) => {
      const orig = this.original.nodes[i];
      if (!orig || this.removed.has(i)) return; // pasted (carried by the insert op) / deleted → skip
      const target = (): EditTarget => this.nodeTarget(i);
      if (node.id && (node.id ?? '') !== (orig.id ?? '')) out.push({ target: target(), attr: 'id', value: node.id });
      if (!numbersEqual(node.transform.position, orig.transform.position))
        out.push({ target: target(), attr: 'position', value: node.transform.position.slice() });
      if (!numbersEqual(node.transform.eulerAngles, orig.transform.eulerAngles))
        out.push({ target: target(), attr: 'eulerAngles', value: node.transform.eulerAngles.slice() });
      if (!numbersEqual(node.transform.scale, orig.transform.scale))
        out.push({ target: target(), attr: 'scale', value: node.transform.scale.slice() });
      if (node.transform.visible !== orig.transform.visible)
        out.push({ target: target(), attr: 'visible', value: node.transform.visible });
      // The node tag's own attributes (`<PerspectiveCamera fov>`), set via
      // `setNodeAttr`. They have no live representation to diff against, so the
      // compiled model vs. the loaded original is the only source.
      for (const [attr, val] of Object.entries(node.attrs)) {
        if (!isSavableScalar(val) || valuesEqual(val, orig.attrs[attr])) continue;
        out.push({ target: target(), attr, value: val as number | boolean | string | number[] });
      }
      // Cleared: present in the loaded source, gone from the document → remove it
      // from the XML. Without this the diff above simply never visits the key and
      // the old attribute would survive the save.
      for (const attr of Object.keys(orig.attrs)) {
        if (!(attr in node.attrs)) out.push({ target: target(), attr, value: null });
      }
    });
    this.compiled.components.forEach((comp, ci) => {
      const orig = this.original.components[ci];
      if (!orig || this.removed.has(comp.node)) return; // pasted / on a deleted node → skip
      for (const [name, value] of Object.entries(comp.props)) {
        if (!isSavableScalar(value) || valuesEqual(value, orig.props[name])) continue;
        out.push({ target: this.componentTarget(ci), attr: name, value: value as number | boolean | string | number[] });
      }
      // Cleared properties: in the loaded source, gone from the document.
      for (const name of Object.keys(orig.props)) {
        if (!(name in comp.props)) out.push({ target: this.componentTarget(ci), attr: name, value: null });
      }
    });
    // Attachment attrs: a slot whose pool index changed (copy-on-write) vs. its original asset.
    this.compiled.nodes.forEach((node, i) => {
      const orig = this.original.nodes[i];
      if (!orig || this.removed.has(i)) return;
      node.attachments.forEach((attIdx, slot) => {
        if (this.removedAttachments.has(`${i}:${slot}`)) return; // deleted → carried by the structural op
        // Only a copy-on-written attachment can differ from what was loaded, and its
        // origin is tracked explicitly — comparing `orig.attachments[slot]` would
        // pair the wrong assets once a slot has been reordered or removed.
        const origIdx = this.cowAttachments.get(attIdx);
        if (origIdx === undefined) return;
        const cur = this.compiled.attachments[attIdx]!;
        const base = this.original.attachments[origIdx]!;
        for (const [attr, val] of Object.entries(cur.attrs)) {
          if (!isSavableScalar(val) || valuesEqual(val, base.attrs[attr])) continue;
          out.push({ target: this.attachmentTarget(i, slot, cur.tag), attr, value: val as number | boolean | string | number[] });
        }
        // Cleared: in the loaded asset, gone from this node's private copy.
        for (const attr of Object.keys(base.attrs)) {
          if (!(attr in cur.attrs)) out.push({ target: this.attachmentTarget(i, slot, cur.tag), attr, value: null });
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
    this.structural.length = 0;
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
      else if (op.attr === 'position' || op.attr === 'eulerAngles' || op.attr === 'scale')
        this.setTransform(node, op.attr, op.value as number[]);
      // Anything else on a node target is one of the tag's own attributes.
      else if (op.value === null) this.clearNodeAttr(node, op.attr);
      else this.setNodeAttr(node, op.attr, op.value);
    } else if (t.kind === 'component') {
      const comp = this.componentByTarget(t.nodeId, t.type, t.ordinal);
      if (!comp) return;
      if (op.value === null) this.clearComponentProp(comp, op.attr);
      else this.setComponentProp(comp, op.attr, op.value);
    } else {
      const node = t.root ? this.graph.nodeByIndex[this.compiled.root] : this.nodeById(t.nodeId);
      if (!node) return;
      const slot = this.attachmentSlot(node, t.tag, t.ordinal);
      if (slot === undefined) return;
      if (op.attr === 'src') this.setAttachmentSrc(node, slot, op.value as string);
      else if (op.value === null) this.clearAttachmentAttr(node, slot, op.attr);
      else this.setAttachmentProp(node, slot, op.attr, op.value);
    }
  }

  // ── agent edits (MCP `edit_scene`) ────────────────────────────────────────────

  /**
   * Apply agent-requested edits through the same undoable mutators the inspector
   * uses, so they are undoable, dirty-flagging, and live in the viewport. A failed
   * edit reports its reason without aborting the rest of the batch.
   */
  applyAgentEdits(edits: AgentEdit[]): { applied: number; failed: { edit: AgentEdit; reason: string }[] } {
    let applied = 0;
    const failed: { edit: AgentEdit; reason: string }[] = [];
    for (const edit of edits) {
      const reason = this.applyAgentEdit(edit);
      if (reason) failed.push({ edit, reason });
      else applied++;
    }
    return { applied, failed };
  }

  /** Apply one agent edit; returns a failure reason, or undefined on success. */
  private applyAgentEdit(edit: AgentEdit): string | undefined {
    const node = this.nodeById(edit.node);
    if (!node) {
      const ids = this.compiled.nodes.map((n) => n.id).filter((id): id is string => !!id);
      return `no node with id "${edit.node}" — available ids: ${ids.join(', ') || '(none)'}`;
    }
    const ordinal = edit.ordinal ?? 0;

    if (edit.component) {
      if (!this.canEditComponents(node)) return `components on "${edit.node}" are read-only (prefab content)`;
      const comp = this.componentByTarget(edit.node, edit.component, ordinal);
      if (!comp) return `no <${edit.component}> (ordinal ${ordinal}) on "${edit.node}"`;
      const meta = Registry.getComponent(edit.component)?.meta.properties.get(edit.attr);
      if (!meta || isArrayType(meta.type)) {
        const names = [...(Registry.getComponent(edit.component)?.meta.properties.keys() ?? [])];
        return `<${edit.component}> has no editable property "${edit.attr}" — properties: ${names.join(', ') || '(none)'}`;
      }
      const value = coerceScalar(edit.value, elementType(meta.type));
      if (value === undefined) return `value ${JSON.stringify(edit.value)} does not fit property "${edit.attr}"`;
      this.setComponentProp(comp, edit.attr, value);
      return undefined;
    }

    if (edit.attachment) {
      const slot = this.attachmentSlot(node, edit.attachment, ordinal);
      if (slot === undefined) return `no <${edit.attachment}> (ordinal ${ordinal}) on "${edit.node}"`;
      if (edit.attr === 'src') {
        this.setAttachmentSrc(node, slot, String(edit.value));
        return undefined;
      }
      const meta = getAttachmentDef(edit.attachment)?.attrs[edit.attr];
      if (!meta || isArrayType(meta.type)) return `<${edit.attachment}> has no editable attr "${edit.attr}"`;
      const value = coerceScalar(edit.value, elementType(meta.type));
      if (value === undefined) return `value ${JSON.stringify(edit.value)} does not fit attr "${edit.attr}"`;
      this.setAttachmentProp(node, slot, edit.attr, value);
      return undefined;
    }

    // Node-level: transform channels, visible, or a prefab instance's src.
    if (edit.attr === 'src') {
      if (this.nodeOrigin(node).kind !== 'prefab-root') return `"src" is only editable on a prefab instance`;
      this.setNodeSrc(node, String(edit.value));
      return undefined;
    }
    if (!this.canEditTransform(node)) return `transform of "${edit.node}" is read-only (prefab content)`;
    if (edit.attr === 'visible') {
      if (typeof edit.value !== 'boolean') return `"visible" takes a boolean`;
      this.setVisible(node, edit.value);
      return undefined;
    }
    if (edit.attr === 'position' || edit.attr === 'eulerAngles' || edit.attr === 'scale') {
      const value = coerceVec(edit.value, 3);
      if (!value) return `"${edit.attr}" takes [x, y, z]`;
      this.setTransform(node, edit.attr, value);
      return undefined;
    }
    return `unknown node attr "${edit.attr}" — use position/eulerAngles/scale/visible (or src on a prefab instance)`;
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

  /**
   * A node's structural path: child ordinals (among node-kind elements only, which
   * compiled `children` mirror 1:1 in document order) from the compiled root.
   * `[]` = the root itself. The save fallback address for id-less nodes.
   */
  private nodePath(i: number): number[] {
    const path: number[] = [];
    let idx = i;
    for (let node = this.compiled.nodes[idx]!; node.parent >= 0; node = this.compiled.nodes[idx]!) {
      path.unshift(this.compiled.nodes[node.parent]!.children.indexOf(idx));
      idx = node.parent;
    }
    return path;
  }

  // Save targets address a node by its **loaded** id (`original`), not the current one:
  // the file still holds the old id until save, so a rename resolves (and its own `id`
  // edit rewrites it). `markSaved` resets `original`, so post-save edits use the new id.
  private savedId(i: number): string | undefined {
    return this.original.nodes[i]?.id;
  }

  private nodeTarget(i: number): EditTarget {
    const node = this.compiled.nodes[i]!;
    const id = this.savedId(i);
    return {
      kind: 'node',
      nodeIndex: i,
      ...(id ? { id } : {}),
      path: this.nodePath(i),
      tag: node.tag,
    };
  }

  private attachmentTarget(i: number, slot: number, tag: string): EditTarget {
    const node = this.compiled.nodes[i]!;
    const id = this.savedId(i);
    const ordinal = node.attachments.slice(0, slot + 1).filter((idx) => this.compiled.attachments[idx]!.tag === tag).length - 1;
    return {
      kind: 'attachment',
      nodeIndex: i,
      ...(id ? { nodeId: id } : {}),
      nodePath: this.nodePath(i),
      ...(i === this.compiled.root ? { root: true } : {}),
      tag,
      ordinal,
    };
  }

  private componentTarget(ci: number): EditTarget {
    const cc = this.compiled.components[ci]!;
    const node = this.compiled.nodes[cc.node]!;
    const id = this.savedId(cc.node);
    const sameType = node.components.filter((x) => this.compiled.components[x]!.type === cc.type);
    return {
      kind: 'component',
      componentIndex: ci,
      nodeIndex: cc.node,
      ...(id ? { nodeId: id } : {}),
      nodePath: this.nodePath(cc.node),
      type: cc.type,
      ordinal: sameType.indexOf(ci),
    };
  }
}

// ── value helpers ────────────────────────────────────────────────────────────────

function applyTransform(node: Object3D, channel: TransformChannel, v: number[]): void {
  // `eulerAngles` is degrees; the accessor writes through to `rotation` (radians).
  if (channel === 'eulerAngles') node.eulerAngles.fromArray(v);
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
    case ValueType.Vec2:
      return new Vector2().fromArray(value as number[]);
    case ValueType.Vec3:
      return new Vector3().fromArray(value as number[]);
    case ValueType.Euler: {
      // Compiled eulers are DEGREES; a runtime `Euler` is radians. Core's
      // `instantiate` converts here via `eulerFromDegrees` — omitting it stores the
      // degree number as radians and the node ends up 57× under-rotated.
      const d = value as number[];
      return new Euler(
        (d[0] ?? 0) * MathUtils.DEG2RAD,
        (d[1] ?? 0) * MathUtils.DEG2RAD,
        (d[2] ?? 0) * MathUtils.DEG2RAD,
      );
    }
    case ValueType.Color:
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

/**
 * Coerce an agent-supplied value into the compiled form the target's scalar type
 * expects — accepts the native JSON form, plus the friendly string spellings an
 * LLM tends to write ("3 1 0" for a vec, "#ff0000" for a color, "true" for a
 * bool, an enum member's name). Returns undefined when the value doesn't fit.
 */
function coerceScalar(value: string | number | boolean | number[], elem: PropType | { new (): unknown } | EnumDef): number | boolean | string | number[] | undefined {
  if (isEnumType(elem)) {
    if (typeof value === 'string' && elem.byName.has(value)) return elem.byName.get(value)!;
    if ((typeof value === 'string' || typeof value === 'number') && elem.byValue.has(value)) return value;
    return undefined;
  }
  switch (elem) {
    case ValueType.Float:
    case ValueType.Int: {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
      return Number.isFinite(n) ? (elem === ValueType.Int ? Math.round(n) : n) : undefined;
    }
    case ValueType.Bool:
      return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined;
    case ValueType.String:
      return typeof value === 'string' ? value : undefined;
    case ValueType.Color: {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const n = parseInt(value.replace(/^#/, ''), 16);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    }
    case ValueType.Vec2:
      return coerceVec(value, 2);
    case ValueType.Vec3:
    case ValueType.Euler:
      return coerceVec(value, 3);
    default:
      return undefined; // references/prefabs aren't editable over MCP
  }
}

/** A numeric vector of `length`, from a number[] or an "x y z" string. */
function coerceVec(value: string | number | boolean | number[], length: number): number[] | undefined {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[ ,]+/).map(Number)
      : undefined;
  if (!parts || parts.length !== length || !parts.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return parts;
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

// ── copy/paste ref remapping ─────────────────────────────────────────────────────

/** Sentinel: a component ref prop pointing outside a copied subtree — omitted from the fragment. */
const DROP = Symbol('drop-ref');

function isCompiledRef(v: unknown): v is CompiledRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && ('node' in v || 'component' in v || 'prefab' in v);
}

/**
 * Remap a component prop's references from global compiled indices to a fragment's
 * local ones (via the copy's node/component maps). A ref to a target outside the
 * copied subtree — or a `prefab` ref (its file path isn't kept in the compiled
 * model) — is dropped: a single ref returns `DROP`, an array filters it out.
 */
function remapRefs(value: CompiledValue, nodeMap: Map<number, number>, compMap: Map<number, number>): CompiledValue | typeof DROP {
  const one = (ref: CompiledRef): CompiledRef | null => {
    if ('node' in ref) { const n = nodeMap.get(ref.node); return n === undefined ? null : { node: n }; }
    if ('component' in ref) { const c = compMap.get(ref.component); return c === undefined ? null : { component: c }; }
    return null;
  };
  if (isCompiledRef(value)) return one(value) ?? DROP;
  if (Array.isArray(value) && value.length > 0 && isCompiledRef(value[0])) {
    return (value as CompiledRef[]).map(one).filter((r): r is CompiledRef => r !== null);
  }
  return value;
}

/** Shift a component prop's ref indices by a paste's append offsets (fragment-local → global). */
function rebaseRefs(value: CompiledValue, nodeBase: number, compBase: number): CompiledValue {
  const one = (ref: CompiledRef): CompiledRef =>
    'node' in ref ? { node: ref.node + nodeBase } : 'component' in ref ? { component: ref.component + compBase } : ref;
  if (isCompiledRef(value)) return one(value);
  if (Array.isArray(value) && value.length > 0 && isCompiledRef(value[0])) return (value as CompiledRef[]).map(one);
  return value;
}
