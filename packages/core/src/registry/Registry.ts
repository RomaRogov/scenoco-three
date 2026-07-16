import type { AssetKind } from '../assets/AssetCache.js';
import type { Component } from '../runtime/Component.js';
import type { EnumDef } from './EnumRegistry.js';

export type ComponentCtor = new () => Component;

/**
 * Primitive/math property wire types. Each maps to a canonical XML attribute
 * format (defined in scene/types.ts) and an XSD encoding:
 *   float/int/bool/string — native XSD types
 *   vec2/vec3 — space-separated numbers, A-Frame/X3D style: "0 2.5 -5"
 *   euler     — degrees, space-separated: "0 90 0"
 *   color     — "#rrggbb" or a CSS color name
 *   node      — Object3D reference by scene path: "Turbine_01/Blade"
 *   prefab    — a `.prefab.xml` file reference, resolved at build time to an
 *               embedded prefab bundle; the field receives a spawnable PrefabRef
 *
 * A property may instead be typed with a Component class (Unity/Cocos-style
 * typed reference); its XML value is a node path resolved to that node's
 * component of the declared type.
 */
/**
 * The built-in property value types (Cocos Creator `ValueType` flavor) — the one
 * spelling you author with: `@property({ type: ValueType.Vec3 })`. Each member's
 * value **is** the canonical wire kind (`ValueType.Float === 'float'`), so using
 * the enum and switching on it in the compiler resolve to the exact strings the
 * codecs / XSD / serializer already key on — the enum de-magic-strings the code
 * without changing a single serialized byte. Component-class references and enums
 * (`enumOf`) are authored directly, not through this.
 */
export const ValueType = {
  Float: 'float',
  Int: 'int',
  Bool: 'bool',
  String: 'string',
  Vec2: 'vec2',
  Vec3: 'vec3',
  Euler: 'euler',
  Color: 'color',
  Node: 'node',
  Prefab: 'prefab',
} as const;

/** The canonical wire kind of a built-in property type — the value side of {@link ValueType}. */
export type PropType = (typeof ValueType)[keyof typeof ValueType];

/**
 * A property's element type, or a one-element tuple wrapping it to mark an
 * **array** property (Cocos `@property([Type])` style): `['float']`, `['node']`,
 * `[SomeComponent]`. The element type carries all the parse/ref semantics; the
 * tuple only signals multiplicity.
 */
export type PropertyType =
  | PropType
  | ComponentCtor
  | EnumDef
  | [PropType | ComponentCtor | EnumDef];

/** A vec2/vec3/euler-shaped default — a `THREE.Vector2`/`Vector3`/`Euler` or a plain `{x,y,z}`. */
export type Vec3Like = { x: number; y: number; z?: number };

/** A compiled default value (the normalized form stored in `PropertyMeta`). */
export type CompiledDefault = number | boolean | string | number[] | (number | boolean | string | number[])[];

export interface PropertyMeta {
  type: PropertyType;
  /** Default in **compiled form** — normalized from whatever the author wrote (see `PropertyInput`). */
  default?: CompiledDefault;
  required?: boolean;
  /**
   * Human-readable, one-line summary of the property — **mandatory**. It is the
   * primary signal a person or an LLM/RAG index reads to understand the field, so
   * every `@property` must carry one (enforced by the type and at registration).
   */
  description: string;
  /**
   * Marks a `string` attr as an **asset reference** (a texture/model URL). The
   * value is still a plain string in the bundle; the flag lets the engine
   * enumerate a scene's assets to preload and lets tooling treat the field as an
   * asset picker. See `AssetKind`.
   */
  asset?: AssetKind;
}

/**
 * What `@property({ … })` accepts from an author — like `PropertyMeta`, but the
 * `default` may use the natural shape and is normalized to the compiled form at
 * registration: a `vec2`/`vec3`/`euler` as an array, a `THREE.Vector3`/`Vector2`/
 * `Euler`, or `{x,y,z}`; a `color` as a number `0xRRGGBB`, a `"#rrggbb"` string,
 * or a `THREE.Color`.
 */
export interface PropertyInput extends Omit<PropertyMeta, 'default'> {
  default?: CompiledDefault | Vec3Like;
}

/** True for an array-marked property; `elementType` unwraps it. */
export function isArrayType(t: PropertyType): t is [PropType | ComponentCtor | EnumDef] {
  return Array.isArray(t);
}

/** The element type of a property — itself if scalar/reference/enum, or the unwrapped tuple. */
export function elementType(t: PropertyType): PropType | ComponentCtor | EnumDef {
  return Array.isArray(t) ? t[0] : t;
}

/**
 * Scalar property types parse from text. Reference kinds — `'node'`, `'prefab'`,
 * and Component classes — are resolved against the scene, not parsed as scalars.
 * Operates on a (already-unwrapped) element type.
 */
export function isScalarType(t: PropertyType): t is Exclude<PropType, 'node' | 'prefab'> {
  return typeof t === 'string' && t !== 'node' && t !== 'prefab';
}

export interface ComponentMeta {
  /** XML tag name inside <Components>. */
  name: string;
  /** Mandatory one-line summary of the component (read by people, agents, and RAG). */
  description: string;
  /** Attribute name → metadata, in declaration order (subclass first, then inherited). */
  properties: Map<string, PropertyMeta>;
}

export interface RegisteredComponent {
  meta: ComponentMeta;
  ctor: ComponentCtor;
}

/**
 * A uniform, explanatory error for a duplicate registration of any tag
 * (component/node/attachment). Registration happens as an **import side effect**
 * (the `@component`/`@node`/`@attachment` decorator runs when the module loads),
 * and these registries are process-global — normally filled once, then read by
 * the compiler and Vite plugin. A collision therefore almost always means one of
 * two concrete things, and the message spells both out so the fix is obvious.
 */
export function duplicateRegistrationError(kind: string, name: string, cause?: string): Error {
  return new Error(
    `${kind} "${name}" is already registered.` +
      (cause ? ` ${cause}` : '') +
      ` Tags register once, as a decorator import side effect, into a process-global registry, so this` +
      ` fires when either (a) two different classes claim the name "${name}" — rename one — or (b) the` +
      ` same module is loaded twice, usually duplicate/mismatched copies of a @scenoco-three package in` +
      ` the build (check for multiple installed versions) or a stale dist alongside src. Names must be` +
      ` unique across all components, nodes, and attachments.`,
  );
}

class EngineRegistry {
  private readonly components = new Map<string, RegisteredComponent>();

  registerComponent(meta: ComponentMeta, ctor: ComponentCtor): void {
    const existing = this.components.get(meta.name);
    if (existing) {
      const cause =
        existing.ctor === ctor
          ? `The same component class was registered twice (duplicate import or a duplicated package copy).`
          : `A different class (${existing.ctor.name || '<anonymous>'}) already uses this name.`;
      throw duplicateRegistrationError('Component', meta.name, cause);
    }
    this.components.set(meta.name, { meta, ctor });
  }

  /** Mainly for tests and future hot-reload support. */
  unregisterComponent(name: string): boolean {
    return this.components.delete(name);
  }

  getComponent(name: string): RegisteredComponent | undefined {
    return this.components.get(name);
  }

  componentNames(): string[] {
    return [...this.components.keys()];
  }
}

/** Global registry indexing all available components by name (node/attachment tags live in NodeRegistry). */
export const Registry = new EngineRegistry();
