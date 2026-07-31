import type { Object3D } from 'three';
import type { CompiledScalar, ScalarType } from '../scene/types.js';
import type { CompiledUniform } from '../scene/compiled.js';
import type { AssetCache, AssetKind } from '../assets/AssetCache.js';
import type { EnumDef } from './EnumRegistry.js';
import { duplicateRegistrationError, ValueType } from './Registry.js';

/**
 * The tag registry — the extensible counterpart to the component `Registry`.
 *
 * Two kinds of tag live here:
 *  - **Nodes** (`@node`): scene-graph `Object3D` tags (`<Mesh>`, `<SpotLight>`, …).
 *  - **Attachments** (`@attachment`): leaf config that attaches to and configures a
 *    node — geometry/material on a mesh, fog/background on the scene. One concept
 *    replaces the old geometry/material/setting kinds.
 *
 * Built-ins live one-per-file under `src/nodes/**` and self-register on import via
 * the class decorators (see core/decorators.ts); projects register their own the
 * same way (the compiler discovers those decorators like it discovers `@component`).
 */

export type NodeKind = 'scene' | 'object3d';

export interface NodeAttr {
  /** Scalar/enum type, or a one-element tuple `[ScalarType | EnumDef]` for an array attr. */
  type: ScalarType | EnumDef | [ScalarType | EnumDef];
  /** Default in compiled form (number, boolean, number[], 0xRRGGBB; or an array of those). */
  default?: CompiledScalar | CompiledScalar[];
  required?: boolean;
  /** Mandatory one-line summary of the attribute (read by people, agents, and RAG). */
  description: string;
  /** Marks a `string` attr as an asset reference (texture/model URL) — see `AssetKind`. */
  asset?: AssetKind;
}

/** What a node may contain (attachments are governed separately, by target). */
export interface ChildRules {
  /** May contain child Object3D node tags. */
  object3d: boolean;
  /** May contain a single <Components> block. */
  components: boolean;
}

export interface NodeDef {
  tag: string;
  kind: NodeKind;
  /** Mandatory one-line summary of the node tag (read by people, agents, and RAG). */
  description: string;
  /** Type-specific attributes (transform attrs are shared, see TRANSFORM_ATTRS). */
  attrs: Record<string, NodeAttr>;
  children: ChildRules;
  /** Build the bare Three.js object (transforms are applied separately). */
  build(attrs: Record<string, CompiledScalar | CompiledScalar[]>): Object3D;
  /** The Object3D subclass this node builds — used to match attachment targets. */
  produces?: AttachClass;
}

/** A node's runtime Object3D constructor (for attachment target matching). */
export type AttachClass = abstract new (...args: never[]) => Object3D;

/**
 * Where an attachment may attach: an Object3D class, or several. Subclass-aware —
 * a target of `Mesh` also accepts `SkinnedMesh`. Classes only, never tag strings:
 * a class is checked by the compiler, a string typo silently matches nothing.
 */
export type AttachTarget = AttachClass | AttachClass[];

/**
 * What an attachment is given when the scene loads: just its host node. A
 * Scene-targeted attachment (fog/background) receives the Scene as `node`, so it
 * configures the live Three.js object directly — no separate scene/renderer handle.
 */
export interface AttachContext<TNode extends Object3D = Object3D> {
  node: TNode;
  /**
   * Loaded assets for the scene being instantiated — an attachment reads a
   * texture/model it declared (`@property({ asset })`) via `ctx.assets?.get(url)`.
   * Populated by the preload providers before `loadSceneAsync` instantiates;
   * `undefined` for synchronous `loadScene` / standalone instantiation.
   */
  assets?: AssetCache;
}

/** A live attachment instance (created by the def, holds @property fields). */
export interface AttachmentInstance {
  attach(ctx: AttachContext): void;
}

export interface AttachmentDef {
  tag: string;
  /** Mandatory one-line summary of the attachment tag (read by people, agents, and RAG). */
  description: string;
  attrs: Record<string, NodeAttr>;
  /** The node(s) this attaches to. */
  target: AttachTarget;
  /** Cardinality bucket on the target (e.g. 'geometry', 'material', 'fog'). */
  group: string;
  /** The target needs at least one attachment of this group. */
  required: boolean;
  /** At most one attachment of this group per target (default true). */
  unique: boolean;
  /** Structured child tags this attachment accepts (e.g. `<ShaderMaterial>` → `['Uniform']`). */
  children?: string[];
  /** Restore the host property this attachment's family owns — the inverse of `attach`. */
  reset?(node: Object3D): void;
  /** Make a fresh instance, assign its attrs, and hand over any custom-shader uniforms. */
  make(attrs: Record<string, CompiledScalar | CompiledScalar[]>, uniforms?: CompiledUniform[]): AttachmentInstance;
}

export interface SystemDef {
  ctor: new () => unknown;
  /** The component type the engine feeds this system's `components` query (single-type query, v1). */
  componentType?: abstract new (...args: never[]) => object;
  /** The Object3D class the engine feeds this system's `nodes` query — for systems driven by scene objects rather than components (e.g. UI layout). */
  nodeType?: AttachClass;
  /** Step this system in editor mode too — for systems whose effect must be visible while editing (UI layout, …). Default false. */
  executeInEditor?: boolean;
}

/**
 * Transform attributes shared by every Object3D-family node. Rotation is authored
 * as `eulerAngles` in **degrees** (Unity/Blender/A-Frame convention); the runtime
 * exposes both `Object3D.eulerAngles` (degrees) and `Object3D.rotation` (radians).
 * There is deliberately no `rotation` DSL attribute — a single, unit-unambiguous
 * authoring name.
 */
export const TRANSFORM_ATTRS: Record<string, NodeAttr> = {
  // Descriptions avoid double quotes: they land in XSD <xs:documentation>, where
  // a quote is escaped to &quot; and reads badly in IDE hover.
  position: { type: ValueType.Vec3, default: [0, 0, 0], description: 'Local position, e.g. y: 1.5; z: -3 (omitted axes are 0)' },
  eulerAngles: {
    type: ValueType.Euler,
    default: [0, 0, 0],
    description: 'Local rotation in degrees, e.g. y: 90 (omitted axes are 0)',
  },
  scale: { type: ValueType.Vec3, default: [1, 1, 1], description: 'Local scale, e.g. x: 2; y: 2; z: 2 (omitted axes are 0, so write all three)' },
  visible: { type: ValueType.Bool, default: true, description: 'Whether the object renders' },
};

// ---- node registry ----------------------------------------------------------

const nodeDefs = new Map<string, NodeDef>();

export function registerNode(def: NodeDef): void {
  if (nodeDefs.has(def.tag)) throw duplicateRegistrationError('Node tag', def.tag);
  nodeDefs.set(def.tag, def);
}
export function unregisterNode(tag: string): boolean {
  return nodeDefs.delete(tag);
}
export function getNodeDef(tag: string): NodeDef | undefined {
  return nodeDefs.get(tag);
}
export function nodeTags(): string[] {
  return [...nodeDefs.keys()];
}
export function allNodeDefs(): NodeDef[] {
  return [...nodeDefs.values()];
}
/** True for tags that carry a transform (Scene + Object3D family). All nodes do. */
export function isSpatial(tag: string): boolean {
  return nodeDefs.has(tag);
}

// ---- attachment registry ----------------------------------------------------

const attachmentDefs = new Map<string, AttachmentDef>();

export function registerAttachment(def: AttachmentDef): void {
  if (attachmentDefs.has(def.tag)) throw duplicateRegistrationError('Attachment tag', def.tag);
  attachmentDefs.set(def.tag, def);
}
export function unregisterAttachment(tag: string): boolean {
  return attachmentDefs.delete(tag);
}
export function getAttachmentDef(tag: string): AttachmentDef | undefined {
  return attachmentDefs.get(tag);
}
export function attachmentTags(): string[] {
  return [...attachmentDefs.keys()];
}
export function allAttachmentDefs(): AttachmentDef[] {
  return [...attachmentDefs.values()];
}

/** Does an attachment's target accept this node? (class-assignable or tag match) */
export function attachmentAcceptsNode(def: AttachmentDef, node: NodeDef): boolean {
  const classes = Array.isArray(def.target) ? def.target : [def.target];
  return node.produces !== undefined && classes.some((c) => isProducedBy(node.produces!, c));
}

/** `produces` is `target` or a subclass of it. */
function isProducedBy(produces: AttachClass, target: AttachClass): boolean {
  return produces === target || produces.prototype instanceof target;
}

/**
 * Does a component's optional node-type constraint accept this node? Subclass-aware,
 * exactly like `attachmentAcceptsNode`. An unconstrained component (no `static
 * target`) accepts every node — that is the normal case.
 */
export function componentAcceptsNode(target: AttachTarget | undefined, node: NodeDef): boolean {
  if (target === undefined) return true;
  const classes = Array.isArray(target) ? target : [target];
  return node.produces !== undefined && classes.some((c) => isProducedBy(node.produces!, c));
}

/** Attachment tags a node may contain (for the XSD/docs and validator). */
export function attachmentsForNode(node: NodeDef): AttachmentDef[] {
  return allAttachmentDefs().filter((d) => attachmentAcceptsNode(d, node));
}

// ---- system registry --------------------------------------------------------

const systemDefs: SystemDef[] = [];

export function registerSystem(def: SystemDef): void {
  systemDefs.push(def);
}
export function unregisterSystem(ctor: new () => unknown): boolean {
  const i = systemDefs.findIndex((d) => d.ctor === ctor);
  if (i === -1) return false;
  systemDefs.splice(i, 1);
  return true;
}
export function allSystemDefs(): readonly SystemDef[] {
  return systemDefs;
}

// ---- shared helper ----------------------------------------------------------

/** Default child rules for a node: holds child nodes + a <Components> block. */
export const spatialChildren = (overrides: Partial<ChildRules> = {}): ChildRules => ({
  object3d: true,
  components: true,
  ...overrides,
});
