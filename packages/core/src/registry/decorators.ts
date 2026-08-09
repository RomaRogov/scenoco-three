import type { Object3D } from 'three';
import {
  Registry,
  ValueType,
  isArrayType,
  isScalarType,
  elementType,
  type CompiledDefault,
  type PropertyInput,
  type PropertyMeta,
  type PropType,
  type PropertyType,
} from './Registry.js';
import { Attachment } from '../nodes/base.js';
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
 * the type goes in `type`. The default is **not** authored here: it is the
 * field's own initializer, read automatically at registration time:
 *   @property({ type: ValueType.Float, description: 'Radians per second' }) speed = 1;
 *   @property({ type: SomeComponent, description: 'The target to follow' })   — typed reference
 *   @property({ type: [ValueType.Float], description: 'Per-lane weights' })            — array property
 *   @property({ type: [SomeComponent], description: 'Bricks to track' })       — array of references
 */
export function property(meta: PropertyInput) {
  const normalized = meta as PropertyMeta;
  assertDescription('property', typeof normalized.type === 'string' ? normalized.type : 'reference', normalized.description);
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
 * Compile a live field value into a `PropertyMeta.default`, accepting whatever
 * natural shape the field holds:
 *   • vec2/vec3/euler — an array `[x,y,z]`, a `THREE.Vector3`/`Vector2`/`Euler`, or `{x,y,z}`
 *   • color — a number `0xRRGGBB`, a `"#rrggbb"` string, or a `THREE.Color`
 *   • enum — the field already holds the native compiled value (e.g. `side = FrontSide`)
 *   • array-typed props (`['float']`) — echoed as-is, unnormalized
 * `node`/`prefab`/component-typed properties never get a compiled default — the
 * field there is JS-side unset/reference state, not a wire value.
 */
function deriveDefault(type: PropertyType, value: unknown): CompiledDefault | undefined {
  if (value === undefined) return undefined;
  const elem = elementType(type);
  if (!isEnumType(elem) && !isScalarType(elem)) return undefined;
  if (isArrayType(type) || isEnumType(elem)) return value as CompiledDefault;
  if (elem === ValueType.Vec2) return toVecArray(value, 2);
  if (elem === ValueType.Vec3) return toVecArray(value, 3);
  // Euler compiles to degrees. A THREE.Euler initializer is radians (convert);
  // an array/`{x,y,z}` initializer is authored as degrees (leave as-is).
  if (elem === ValueType.Euler) {
    const a = toVecArray(value, 3) as number[];
    return (value as { isEuler?: boolean }).isEuler ? a.map((rad) => (rad * 180) / Math.PI) : a;
  }
  if (elem === ValueType.Color) return toColorNumber(value);
  return value as CompiledDefault;
}

/** A vec value in any accepted form → a number array of length `n`. */
function toVecArray(d: unknown, n: number): CompiledDefault {
  if (Array.isArray(d)) return d;
  if (d !== null && typeof d === 'object') {
    const v = d as { x?: number; y?: number; z?: number };
    return n === 2 ? [v.x ?? 0, v.y ?? 0] : [v.x ?? 0, v.y ?? 0, v.z ?? 0];
  }
  return d as CompiledDefault; // unexpected scalar — leave as-is
}

/** A color value (number | "#rrggbb" | THREE.Color) → a `0xRRGGBB` number. */
function toColorNumber(d: unknown): CompiledDefault {
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    const n = parseInt(d.replace(/^#/, ''), 16);
    return Number.isNaN(n) ? d : n;
  }
  const c = d as { getHex?: () => number };
  return typeof c.getHex === 'function' ? c.getHex() : (d as CompiledDefault);
}

/**
 * Collect every @property (own + inherited) declared on a class, in order, with
 * each entry's `default` derived from a fresh, zero-arg probe instance of
 * `target` — the field's own initializer is the single source of truth. Safe:
 * every @property-bearing class declares no constructor of its own, so
 * `new target()` here — run once, at registration time, never per scene-instance
 * — has no scene/engine/timer side effects (the same pattern `node()` already
 * uses below to probe its produced Three.js class).
 *
 * Builds fresh `PropertyMeta` objects rather than mutating `bag[key]` in place:
 * an inherited, non-redeclared property's `PropertyMeta` is shared by reference
 * across a subclass hierarchy (`property()` prototype-chains a subclass's bag
 * onto its parent's), so mutating it here would let one subclass's derived
 * default leak into a sibling's registry metadata.
 */
function collectProperties(target: CtorWithProps): Map<string, PropertyMeta> {
  const bag = target[PROPS];
  const properties = new Map<string, PropertyMeta>();
  if (!bag) return properties;
  const probe = new (target as unknown as new () => Record<string, unknown>)();
  for (const key in bag) {
    const meta = bag[key]!;
    const compiled = deriveDefault(meta.type, probe[key]);
    properties.set(key, compiled === undefined ? { ...meta } : { ...meta, default: compiled });
  }
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
    // `target` is not read here: `@target(...)` may be written *above* `@component`,
    // and legacy decorators apply bottom-up, so it has not run yet. The registry
    // resolves it from the class on access instead.
    Registry.registerComponent(
      { name: options.name, description: options.description, properties: collectProperties(target as CtorWithProps) },
      target,
    );
  };
}

/**
 * Constrain a component to a node type — `@target(Mesh)` above `@component`, the
 * runtime counterpart of `class X extends Component<Mesh>` (the generic is erased
 * before the registry ever runs). Subclass-aware: `@target(Mesh)` also accepts
 * `SkinnedMesh`.
 *
 * Almost no component needs this. A component works on any node, exactly as a
 * MonoBehaviour works on any GameObject; reach for it only when the body reads a
 * host-specific member such as `this.node.material`.
 *
 * Order-independent: the registry reads the stamped static on access, so this may
 * sit above or below `@component`.
 */
export function target(...nodes: AttachClass[]) {
  return function (ctor: ComponentCtor): void {
    if (nodes.length === 0) throw new Error('@target() needs at least one node class');
    (ctor as unknown as { target?: AttachTarget }).target = nodes.length === 1 ? nodes[0]! : nodes;
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
  /**
   * Node class(es) this attaches to, subclass-aware. Omit when extending a family
   * base (`GeometryAttachment`, …), which declares it once for the whole family.
   */
  target?: AttachTarget;
  /**
   * Cardinality bucket. Normally omitted: it is derived from the family — the
   * nearest `Attachment` subclass in the prototype chain — so `GeometryAttachment`
   * gives `geometry`, and an attachment with no family base is its own group.
   */
  group?: string;
  /** The target needs at least one attachment of this group. Family default. */
  required?: boolean;
  /** At most one attachment of this group per target. Family default, else true. */
  unique?: boolean;
  /** Structured child tags this attachment accepts (e.g. `['Uniform']` for shaders). */
  children?: string[];
}

/** Registers an attachment tag — a leaf that configures its target node. */
export function attachment(options: AttachmentOptions) {
  return function (target: new () => { attach(ctx: AttachContext): void }): void {
    assertDescription('attachment', options.name, options.description);
    const { attrs, names } = readAttrs(target as CtorWithProps, options.name);
    // The family the class belongs to. Statics follow the prototype chain, so a
    // concrete attachment reads its base's `target`/`required` for free. Explicit
    // options still win, so an attachment with no family base is unaffected.
    const family = familyOf(target);
    const group = options.group ?? groupNameOf(family, target, options.name);
    const attachTarget = options.target ?? family.target;
    if (attachTarget === undefined) {
      throw new Error(
        `@attachment("${options.name}") has no target — declare one, or extend a family base class (e.g. GeometryAttachment).`,
      );
    }
    registerAttachment({
      tag: options.name,
      description: options.description,
      attrs,
      target: attachTarget,
      group,
      required: options.required ?? family.required ?? false,
      unique: options.unique ?? family.unique ?? true,
      ...(family.reset ? { reset: family.reset } : {}),
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

/** Statics a family base may declare; inherited by every member of the family. */
interface FamilyStatics {
  target?: AttachTarget;
  required?: boolean;
  unique?: boolean;
  reset?(node: Object3D): void;
}

/**
 * The attachment's *family*: the nearest class below `Attachment` in its prototype
 * chain. `BoxGeometryNode extends GeometryAttachment extends Attachment` → the
 * family is `GeometryAttachment`; an attachment extending `Attachment` directly is
 * its own family. This is what makes the group derivable instead of declared.
 */
function familyOf(ctor: Function): FamilyStatics & { name: string } {
  let cur = ctor;
  while (Object.getPrototypeOf(cur) !== Attachment && Object.getPrototypeOf(cur) !== Function.prototype) {
    cur = Object.getPrototypeOf(cur) as Function;
  }
  return cur as unknown as FamilyStatics & { name: string };
}

/**
 * The group string for a family: `GeometryAttachment` → `geometry`. A class that is
 * its own family uses its XML tag instead (`Background` → `background`), which
 * reproduces the singleton groups those attachments already had.
 */
function groupNameOf(family: { name: string }, ctor: Function, tag: string): string {
  if (family === (ctor as unknown as { name: string })) return tag.toLowerCase();
  return family.name.replace(/Attachment$/, '').toLowerCase();
}

// ---- systems ----------------------------------------------------------------

/** A class a system's query is tested against (component or Object3D family). */
type SystemQueryType = abstract new (...args: never[]) => object;

export interface SystemOptions {
  /** Component type whose presence auto-starts the system; feeds `system.components`. */
  components?: SystemQueryType;
  /** Object3D class whose presence in the scene auto-starts the system; feeds `system.nodes`. */
  nodes?: AttachClass;
  /**
   * Step this system in editor mode too (the system-side `@executeInEditor`):
   * for systems whose effect must be visible while editing (UI layout, …).
   * Default false — a system normally steps only in play mode.
   */
  executeInEditor?: boolean;
}

/**
 * Registers an ECS-hybrid system. Two query forms:
 *   @system(SomeComponent)                                — component query (shorthand)
 *   @system({ nodes: SomeObject3D, executeInEditor: true }) — node query
 * The engine auto-runs the system while its query type is present in the scene.
 */
export function system(query: SystemQueryType | SystemOptions) {
  return function (target: new () => unknown): void {
    const opts: SystemOptions = typeof query === 'function' ? { components: query } : query;
    if (!opts.components && !opts.nodes) {
      throw new Error(`@system on "${target.name}" needs a query — pass a component class or { nodes: SomeObject3DClass }`);
    }
    registerSystem({
      ctor: target,
      ...(opts.components ? { componentType: opts.components } : {}),
      ...(opts.nodes ? { nodeType: opts.nodes } : {}),
      ...(opts.executeInEditor ? { executeInEditor: true } : {}),
    });
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
    // Preserve array-ness: nodes/attachments may carry scalar/enum-array attrs.
    const attrType = (isArrayType(meta.type) ? [elem] : elem) as NodeAttr['type'];
    attrs[name] = {
      type: attrType,
      ...(meta.default !== undefined ? { default: meta.default as NodeAttr['default'] } : {}),
      ...(meta.required ? { required: true } : {}),
      description: meta.description,
      ...(meta.asset !== undefined ? { asset: meta.asset } : {}),
      ...(meta.charset !== undefined ? { charset: meta.charset } : {}),
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
