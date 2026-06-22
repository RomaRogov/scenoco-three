import type { Object3D } from 'three';
import { Registry, isArrayType, elementType, type PropertyMeta, type PropType, type PropertyType } from './Registry.js';
import type { ComponentCtor } from './Registry.js';
import { isEnumType, type EnumDef } from './EnumRegistry.js';
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
import type { CompiledScalar } from '../dsl/types.js';

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
 * components, nodes, and attachments. Forms:
 *   @property({ type: 'float', default: 1 })  — primitive/math property
 *   @property(SomeComponent)                  — typed reference (components only)
 *   @property({ type: ['float'] })            — array property, written "[1,2,3]"
 *   @property([SomeComponent])                 — array of typed references
 */
export function property(meta: PropertyMeta | ComponentCtor | EnumDef | [PropType | ComponentCtor | EnumDef]) {
  const normalized: PropertyMeta =
    typeof meta === 'function' || Array.isArray(meta) || isEnumType(meta) ? { type: meta as PropertyType } : meta;
  normalizeEnumDefault(normalized);
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

/** If an enum prop's default is authored as a member name, resolve it to the native value (in place). */
function normalizeEnumDefault(meta: PropertyMeta): void {
  const elem = elementType(meta.type);
  if (isEnumType(elem) && typeof meta.default === 'string' && elem.byName.has(meta.default)) {
    meta.default = elem.byName.get(meta.default) as PropertyMeta['default'];
  }
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

/** Flag set on component constructors decorated with `@executeInEditor`. */
const EXECUTE_IN_EDITOR = Symbol.for('scenoco:executeInEditor');

/**
 * Class decorator (Unity `[ExecuteInEditMode]`): opt a component into running its
 * lifecycle/update hooks while the engine is in **editor mode**. By default, an
 * editor-mode engine instantiates the scene but never invokes component hooks (no
 * gameplay/physics) — decorate a component with `@executeInEditor` when its effect
 * must be visible in the editor (procedural geometry, layout/spawner tools, …).
 *
 *   @executeInEditor
 *   @component({ name: 'GridLayout' })
 *   class GridLayout extends Component { … }
 */
export function executeInEditor(target: ComponentCtor): void {
  (target as unknown as Record<symbol, boolean>)[EXECUTE_IN_EDITOR] = true;
}

/** True if an instance's component class is marked `@executeInEditor`. */
export function runsInEditor(instance: object): boolean {
  return (instance.constructor as unknown as Record<symbol, boolean>)[EXECUTE_IN_EDITOR] === true;
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
    const build = (a: Record<string, CompiledScalar | CompiledScalar[]>): Object3D => {
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
    const elem = elementType(meta.type);
    if (!isEnumType(elem) && (typeof elem !== 'string' || elem === 'node' || elem === 'prefab')) {
      throw new Error(
        `<${tag}> @property "${name}" must use a scalar type (float/int/bool/string/vec2/vec3/euler/color), an enum, or an array of one ([float] …); references are for components only`,
      );
    }
    normalizeEnumDefault(meta);
    // Preserve array-ness: nodes/attachments may carry scalar/enum-array attrs.
    const attrType = (isArrayType(meta.type) ? [elem] : elem) as NodeAttr['type'];
    attrs[name] = {
      type: attrType,
      ...(meta.default !== undefined ? { default: meta.default as NodeAttr['default'] } : {}),
      ...(meta.required ? { required: true } : {}),
      ...(meta.description !== undefined ? { description: meta.description } : {}),
    };
  }
  return { attrs, names: [...props.keys()] };
}

/** Assign compiled attr values onto a fresh instance, skipping undefined (keeps initializers). */
function assign(inst: object, names: string[], attrs: Record<string, CompiledScalar | CompiledScalar[]>): void {
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
