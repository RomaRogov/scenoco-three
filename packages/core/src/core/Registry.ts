import type { AssetKind } from './AssetCache.js';
import type { Component } from './Component.js';
import type { EnumDef } from './EnumRegistry.js';

export type ComponentCtor = new () => Component;

/**
 * Primitive/math property wire types. Each maps to a canonical XML attribute
 * format (defined in dsl/types.ts) and an XSD encoding:
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
export type PropType =
  | 'float'
  | 'int'
  | 'bool'
  | 'string'
  | 'vec2'
  | 'vec3'
  | 'euler'
  | 'color'
  | 'node'
  | 'prefab';

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

class EngineRegistry {
  private readonly components = new Map<string, RegisteredComponent>();

  registerComponent(meta: ComponentMeta, ctor: ComponentCtor): void {
    if (this.components.has(meta.name)) {
      throw new Error(`Component "${meta.name}" is already registered`);
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
