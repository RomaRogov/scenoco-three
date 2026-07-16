import type { Object3D } from 'three';
import {
  Registry,
  ValueType,
  isArrayType,
  elementType,
  type CompiledDefault,
  type PropertyInput,
  type PropertyMeta,
  type PropType,
  type PropertyType,
} from './Registry.js';
import type { ComponentCtor } from './Registry.js';
// Re-exported so node/attachment files import `ValueType` from the same module as
// the decorators they already use (`'../../registry/decorators.js'`).
export { ValueType };
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
import type { CompiledScalar } from '../scene/types.js';
import type { CompiledUniform } from '../scene/compiled.js';

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
  /** Mandatory one-line summary of the component (read by people, agents, and RAG). */
  description: string;
  /**
   * Execution order (Unity's Script Execution Order): in every lifecycle phase
   * (`onLoad`, `start`, `update`, `fixedUpdate`, `lateUpdate`), components run in
   * ascending `order`; equal orders keep instantiation order. Default 0.
   */
  order?: number;
}

/**
 * Declares an XML-exposed property on a field (Cocos `@property` style). Used by
 * components, nodes, and attachments. A `description` is **mandatory** (it is the
 * primary signal for review/agents/RAG), so the object form is always required —
 * the type goes in `type`:
 *   @property({ type: ValueType.Float, default: 1, description: 'Radians per second' })
 *   @property({ type: SomeComponent, description: 'The target to follow' })   — typed reference
 *   @property({ type: [ValueType.Float], description: 'Per-lane weights' })            — array property
 *   @property({ type: [SomeComponent], description: 'Bricks to track' })       — array of references
 */
export function property(meta: PropertyInput) {
  const input: PropertyInput = meta;
  assertDescription('property', typeof input.type === 'string' ? input.type : 'reference', input.description);
  normalizeDefault(input);
  // `default` is now in compiled form (Vec3Like / color-string normalized away).
  const normalized = input as PropertyMeta;
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

/**
 * Normalize a `@property` default into its compiled form (in place), so authors
 * can write whichever shape is natural and it just works:
 *   • vec2/vec3/euler — an array `[x,y,z]`, a `THREE.Vector3`/`Vector2`/`Euler`, or `{x,y,z}`
 *   • color — a number `0xRRGGBB`, a `"#rrggbb"` string, or a `THREE.Color`
 *   • enum — a member name string
 * Idempotent; array-typed props (`['float']`) are left untouched.
 */
function normalizeDefault(meta: PropertyInput): void {
  const elem = elementType(meta.type);
  const d = meta.default;
  if (d === undefined) return;
  if (isEnumType(elem)) {
    if (typeof d === 'string' && elem.byName.has(d)) meta.default = elem.byName.get(d) as CompiledDefault;
    return;
  }
  if (isArrayType(meta.type)) return;
  if (elem === ValueType.Vec2) meta.default = toVecArray(d, 2);
  else if (elem === ValueType.Vec3 || elem === ValueType.Euler) meta.default = toVecArray(d, 3);
  else if (elem === ValueType.Color) meta.default = toColorNumber(d);
}

/** A vec default in any accepted form → a number array of length `n`. */
function toVecArray(d: PropertyInput['default'], n: number): CompiledDefault {
  if (Array.isArray(d)) return d;
  if (d !== null && typeof d === 'object') {
    const v = d as { x?: number; y?: number; z?: number };
    return n === 2 ? [v.x ?? 0, v.y ?? 0] : [v.x ?? 0, v.y ?? 0, v.z ?? 0];
  }
  return d as CompiledDefault; // unexpected scalar — leave as authored
}

/** A color default (number | "#rrggbb" | THREE.Color) → a `0xRRGGBB` number. */
function toColorNumber(d: PropertyInput['default']): CompiledDefault {
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    const n = parseInt(d.replace(/^#/, ''), 16);
    return Number.isNaN(n) ? d : n;
  }
  const c = d as { getHex?: () => number };
  return typeof c.getHex === 'function' ? c.getHex() : (d as CompiledDefault);
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
    assertDescription('component', options.name, options.description);
    // Stamp the execution order as a static, read by the engine (O(1), not
    // shadowed by instances). Inherited by subclasses through the ctor chain.
    if (options.order !== undefined) (target as unknown as { executionOrder?: number }).executionOrder = options.order;
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
  /** Mandatory one-line summary of the node tag (read by people, agents, and RAG). */
  description: string;
  /** Override the default child rules (object3d children + <Components>). */
  children?: Partial<ChildRules>;
  /** `'scene'` only for the root; everything else (the default) is `'object3d'`. */
  kind?: 'scene' | 'object3d';
  /**
   * Whether this node accepts attachments (geometry/material/…). Default true.
   * Set `false` for a node that extends a Three.js class like `Mesh` but manages
   * its own rendering (e.g. a UI element) — it then matches no attachment target,
   * so it requires no `<geometry>`/`<material>` and rejects them if authored.
   */
  attachments?: boolean;
}

/** Registers an Object3D-family node tag (lights, cameras, meshes, groups, …). */
export function node(options: NodeOptions) {
  return function (target: new () => { build(): Object3D }): void {
    assertDescription('node', options.name, options.description);
    const { attrs, names } = readAttrs(target as CtorWithProps, options.name);
    const build = (a: Record<string, CompiledScalar | CompiledScalar[]>): Object3D => {
      const inst = new target();
      assign(inst, names, a);
      return inst.build();
    };
    // Probe the produced Three.js class (for attachment target matching). Build
    // with no attrs so fields keep their initializers. Skipped when the node
    // opts out of attachments (a Mesh-extending node that renders itself).
    let produces: AttachClass | undefined;
    if (options.attachments !== false) {
      try {
        produces = build({}).constructor as AttachClass;
      } catch {
        produces = undefined;
      }
    }
    registerNode({
      tag: options.name,
      kind: options.kind ?? 'object3d',
      description: options.description,
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
  /** Mandatory one-line summary of the attachment tag (read by people, agents, and RAG). */
  description: string;
  /** Node(s) this attaches to: an Object3D class (subclass-aware) or a node tag. */
  target: AttachTarget;
  /** Cardinality bucket on the target (e.g. 'geometry', 'material', 'fog'). */
  group: string;
  /** The target needs at least one attachment of this group. Default false. */
  required?: boolean;
  /** At most one attachment of this group per target. Default true. */
  unique?: boolean;
  /** Structured child tags this attachment accepts (e.g. `['Uniform']` for shaders). */
  children?: string[];
}

/** Registers an attachment tag — a leaf that configures its target node. */
export function attachment(options: AttachmentOptions) {
  return function (target: new () => { attach(ctx: AttachContext): void }): void {
    assertDescription('attachment', options.name, options.description);
    const { attrs, names } = readAttrs(target as CtorWithProps, options.name);
    registerAttachment({
      tag: options.name,
      description: options.description,
      attrs,
      target: options.target,
      group: options.group,
      required: options.required ?? false,
      unique: options.unique ?? true,
      ...(options.children ? { children: options.children } : {}),
      make: (a, uniforms) => {
        const inst = new target();
        assign(inst, names, a);
        // Hand structured child data (shader uniforms) to instances that want it.
        (inst as { setUniforms?: (u?: CompiledUniform[]) => void }).setUniforms?.(uniforms);
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
    if (!isEnumType(elem) && (typeof elem !== 'string' || elem === ValueType.Node || elem === ValueType.Prefab)) {
      throw new Error(
        `<${tag}> @property "${name}" must use a scalar type (float/int/bool/string/vec2/vec3/euler/color), an enum, or an array of one ([float] …); references are for components only`,
      );
    }
    normalizeDefault(meta);
    // Preserve array-ness: nodes/attachments may carry scalar/enum-array attrs.
    const attrType = (isArrayType(meta.type) ? [elem] : elem) as NodeAttr['type'];
    attrs[name] = {
      type: attrType,
      ...(meta.default !== undefined ? { default: meta.default as NodeAttr['default'] } : {}),
      ...(meta.required ? { required: true } : {}),
      description: meta.description,
      ...(meta.asset !== undefined ? { asset: meta.asset } : {}),
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

/**
 * A `description` is mandatory on every registered thing (component/node/attachment/
 * property). The TS types already require it; this is the runtime backstop (loud,
 * actionable failure at registration) that guarantees the registry invariant for
 * non-TS consumers and `// @ts-ignore` paths, so review/agent/RAG tooling can rely
 * on a description always being present.
 */
function assertDescription(kind: string, name: string, description: string | undefined): void {
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`${kind} "${name}" is missing a required, non-empty "description"`);
  }
}
