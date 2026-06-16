import type { Object3D } from 'three';
import { Registry, type PropertyMeta } from './Registry.js';
import type { ComponentCtor } from './Registry.js';
import {
  registerAttachment,
  registerNode,
  registerSystem,
  spatialChildren,
  type AttachClass,
  type AttachContext,
  type AttachTarget,
  type ChildRules,
  type NodeAttr,
} from './NodeRegistry.js';
import type { CompiledScalar, ScalarType } from '../dsl/types.js';

// SceNoCo uses legacy (experimentalDecorators) decorators, like Cocos Creator.
// Rationale: as of 2026 the TC39 standard decorators are still not lowered by
// oxc (Vite 8 / Rolldown), so a library shipping them breaks consumers' builds.
//
// One authoring idiom for every registered, schema-bearing thing — a class with
// `@property` fields plus a class decorator declaring its role:
//   @component — behaviour on a node (lifecycle, MonoBehaviour-style)
//   @node      — a scene-graph Object3D tag
//   @attachment(target) — a leaf that configures a node (geometry/material/setting)
//   @system(Component)  — an ECS-hybrid batch processor for a component type

/** Key under which @property accumulates metadata on the constructor. */
const PROPS = Symbol.for('scenoco:properties');

type PropsBag = Record<string, PropertyMeta>;
type CtorWithProps = (new () => unknown) & { [PROPS]?: PropsBag };

export interface ComponentOptions {
  /** XML tag name inside <Components>. */
  name: string;
  description?: string;
}

/**
 * Declares an XML-exposed property on a field (Cocos `@property` style). Used by
 * components, nodes, and attachments. Two forms:
 *   @property({ type: 'float', default: 1 })  — primitive/math property
 *   @property(SomeComponent)                  — typed reference (components only)
 */
export function property(meta: PropertyMeta | ComponentCtor) {
  const normalized: PropertyMeta = typeof meta === 'function' ? { type: meta } : meta;
  return function (proto: object, key: string | symbol): void {
    if (typeof proto === 'function') {
      throw new Error(`@property cannot decorate static field "${String(key)}"`);
    }
    if (typeof key !== 'string') {
      throw new Error('@property fields must have string (non-symbol) names');
    }
    const ctor = proto.constructor as CtorWithProps;
    let bag = ctor[PROPS];
    if (!Object.hasOwn(ctor, PROPS)) {
      bag = Object.create(bag ?? null) as PropsBag;
      Object.defineProperty(ctor, PROPS, { value: bag, configurable: true });
    }
    bag![key] = normalized;
  };
}

/** Collect every @property (own + inherited) declared on a class, in order. */
function collectProperties(target: CtorWithProps): Map<string, PropertyMeta> {
  const bag = target[PROPS];
  const properties = new Map<string, PropertyMeta>();
  for (const key in bag) properties.set(key, bag[key]!);
  return properties;
}

/** Registers a Component subclass under its XML tag name (Cocos `@ccclass` style). */
export function component(options: ComponentOptions) {
  return function <T extends ComponentCtor>(target: T): void {
    assertTagName(options.name);
    Registry.registerComponent(
      { name: options.name, description: options.description, properties: collectProperties(target as CtorWithProps) },
      target,
    );
  };
}

// ---- node tags --------------------------------------------------------------

export interface NodeOptions {
  /** XML element name (mirrors the Three.js class). */
  name: string;
  description?: string;
  /** Override the default child rules (object3d children + <Components>). */
  children?: Partial<ChildRules>;
  /** `'scene'` only for the root; everything else (the default) is `'object3d'`. */
  kind?: 'scene' | 'object3d';
}

/** Registers an Object3D-family node tag (lights, cameras, meshes, groups, …). */
export function node(options: NodeOptions) {
  return function (target: new () => { build(): Object3D }): void {
    const { attrs, names } = readAttrs(target as CtorWithProps, options.name);
    const build = (a: Record<string, CompiledScalar>): Object3D => {
      const inst = new target();
      assign(inst, names, a);
      return inst.build();
    };
    // Probe the produced Three.js class (for attachment target matching). Build
    // with no attrs so fields keep their initializers.
    let produces: AttachClass | undefined;
    try {
      produces = build({}).constructor as AttachClass;
    } catch {
      produces = undefined;
    }
    registerNode({
      tag: options.name,
      kind: options.kind ?? 'object3d',
      ...(options.description !== undefined ? { description: options.description } : {}),
      attrs,
      children: spatialChildren(options.children),
      build,
      ...(produces ? { produces } : {}),
    });
  };
}

// ---- attachments ------------------------------------------------------------

export interface AttachmentOptions {
  /** XML element name. */
  name: string;
  description?: string;
  /** Node(s) this attaches to: an Object3D class (subclass-aware) or a node tag. */
  target: AttachTarget;
  /** Cardinality bucket on the target (e.g. 'geometry', 'material', 'fog'). */
  group: string;
  /** The target needs at least one attachment of this group. Default false. */
  required?: boolean;
  /** At most one attachment of this group per target. Default true. */
  unique?: boolean;
}

/** Registers an attachment tag — a leaf that configures its target node. */
export function attachment(options: AttachmentOptions) {
  return function (target: new () => { attach(ctx: AttachContext): void }): void {
    const { attrs, names } = readAttrs(target as CtorWithProps, options.name);
    registerAttachment({
      tag: options.name,
      ...(options.description !== undefined ? { description: options.description } : {}),
      attrs,
      target: options.target,
      group: options.group,
      required: options.required ?? false,
      unique: options.unique ?? true,
      make: (a) => {
        const inst = new target();
        assign(inst, names, a);
        return inst;
      },
    });
  };
}

// ---- systems ----------------------------------------------------------------

/** Registers an ECS-hybrid system that processes all components of `componentType`. */
export function system(componentType: abstract new (...args: never[]) => object) {
  return function (target: new () => unknown): void {
    registerSystem({ ctor: target, componentType });
  };
}

// ---- shared internals -------------------------------------------------------

/** Read a tag's `@property` fields into the registry's NodeAttr shape. */
function readAttrs(target: CtorWithProps, tag: string): { attrs: Record<string, NodeAttr>; names: string[] } {
  assertTagName(tag);
  const props = collectProperties(target);
  const attrs: Record<string, NodeAttr> = {};
  for (const [name, meta] of props) {
    if (typeof meta.type !== 'string' || meta.type === 'node') {
      throw new Error(
        `<${tag}> @property "${name}" must use a scalar type (float/int/bool/string/vec2/vec3/euler/color); references are for components only`,
      );
    }
    attrs[name] = {
      type: meta.type as ScalarType,
      ...(meta.default !== undefined ? { default: meta.default as CompiledScalar } : {}),
      ...(meta.required ? { required: true } : {}),
      ...(meta.description !== undefined ? { description: meta.description } : {}),
    };
  }
  return { attrs, names: [...props.keys()] };
}

/** Assign compiled attr values onto a fresh instance, skipping undefined (keeps initializers). */
function assign(inst: object, names: string[], attrs: Record<string, CompiledScalar>): void {
  const target = inst as Record<string, unknown>;
  for (const name of names) {
    const v = attrs[name];
    if (v !== undefined) target[name] = v;
  }
}

function assertTagName(name: string): void {
  if (name.includes('/')) {
    throw new Error(`Tag/component name "${name}" may not contain "/" (reserved for prefab scope paths)`);
  }
}
