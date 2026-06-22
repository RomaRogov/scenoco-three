import { Color, Euler, Vector2, Vector3, type Object3D } from 'three';
import {
  Registry,
  elementType,
  isArrayType,
  type Component,
  type CompiledScene,
  type EnumDef,
  type PropType,
  type PropertyType,
  type SceneGraph,
} from '@scenoco-three/core';
import type { EditOp, EditTarget } from '../src/protocol.js';
import { UndoStack } from './commands.js';

export type TransformChannel = 'position' | 'rotation' | 'scale';

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
  private readonly original: CompiledScene;
  private readonly undo: UndoStack;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly graph: SceneGraph) {
    this.compiled = graph.compiled;
    this.original = structuredClone(graph.compiled);
    this.undo = new UndoStack(() => this.emit());
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
    return out;
  }

  /** Mark the current state as the saved baseline (keeps the undo stack). */
  markSaved(): void {
    this.compiled.nodes.forEach((n, i) => (this.original.nodes[i]!.transform = structuredClone(n.transform)));
    this.compiled.components.forEach((c, i) => (this.original.components[i]!.props = structuredClone(c.props)));
    this.emit();
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
