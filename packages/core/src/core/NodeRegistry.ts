import type { Object3D, Scene, WebGLRenderer } from 'three';
import type { CompiledScalar, ScalarType } from '../dsl/types.js';

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
  type: ScalarType;
  /** Default in compiled form (number, boolean, number[], 0xRRGGBB). */
  default?: CompiledScalar;
  required?: boolean;
  description?: string;
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
  description?: string;
  /** Type-specific attributes (transform attrs are shared, see TRANSFORM_ATTRS). */
  attrs: Record<string, NodeAttr>;
  children: ChildRules;
  /** Build the bare Three.js object (transforms are applied separately). */
  build(attrs: Record<string, CompiledScalar>): Object3D;
  /** The Object3D subclass this node builds — used to match attachment targets. */
  produces?: AttachClass;
}

/** A node's runtime Object3D constructor (for attachment target matching). */
export type AttachClass = abstract new (...args: never[]) => Object3D;

/** Where an attachment may attach: an Object3D class (subclass-aware) or a node tag. */
export type AttachTarget = AttachClass | AttachClass[] | string;

/** What an attachment is given when the scene loads. `node` is the host. */
export interface AttachContext<TNode extends Object3D = Object3D> {
  node: TNode;
  scene: Scene;
  renderer?: WebGLRenderer;
}

/** A live attachment instance (created by the def, holds @property fields). */
export interface AttachmentInstance {
  attach(ctx: AttachContext): void;
}

export interface AttachmentDef {
  tag: string;
  description?: string;
  attrs: Record<string, NodeAttr>;
  /** The node(s) this attaches to. */
  target: AttachTarget;
  /** Cardinality bucket on the target (e.g. 'geometry', 'material', 'fog'). */
  group: string;
  /** The target needs at least one attachment of this group. */
  required: boolean;
  /** At most one attachment of this group per target (default true). */
  unique: boolean;
  /** Make a fresh instance and assign its attrs. */
  make(attrs: Record<string, CompiledScalar>): AttachmentInstance;
}

export interface SystemDef {
  ctor: new () => unknown;
  /** The component type the engine feeds this system (single-type query, v1). */
  componentType: abstract new (...args: never[]) => object;
}

/** Transform attributes shared by every Object3D-family node (degrees for rotation). */
export const TRANSFORM_ATTRS: Record<string, NodeAttr> = {
  position: { type: 'vec3', default: [0, 0, 0], description: 'Local position x y z' },
  rotation: { type: 'euler', default: [0, 0, 0], description: 'Local rotation in degrees x y z' },
  scale: { type: 'vec3', default: [1, 1, 1], description: 'Local scale x y z' },
  visible: { type: 'bool', default: true, description: 'Whether the object renders' },
};

// ---- node registry ----------------------------------------------------------

const nodeDefs = new Map<string, NodeDef>();

export function registerNode(def: NodeDef): void {
  if (nodeDefs.has(def.tag)) throw new Error(`Node tag <${def.tag}> is already registered`);
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
  if (attachmentDefs.has(def.tag)) throw new Error(`Attachment tag <${def.tag}> is already registered`);
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
  const t = def.target;
  if (typeof t === 'string') return node.tag === t;
  const classes = Array.isArray(t) ? t : [t];
  return node.produces !== undefined && classes.some((c) => isProducedBy(node.produces!, c));
}

/** `produces` is `target` or a subclass of it. */
function isProducedBy(produces: AttachClass, target: AttachClass): boolean {
  return produces === target || produces.prototype instanceof target;
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
