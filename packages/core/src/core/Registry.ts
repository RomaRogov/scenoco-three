import type { Component } from './Component.js';

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

export interface PropertyMeta {
  type: PropType | ComponentCtor;
  /**
   * Default in compiled form (number/boolean/string, or number[] for vec/euler/
   * color-as-array). Used for XSD/docs generation and bundle default-elision.
   */
  default?: number | boolean | string | number[];
  required?: boolean;
  description?: string;
}

/**
 * Scalar property types parse from text. Reference kinds — `'node'`, `'prefab'`,
 * and Component classes — are resolved against the scene, not parsed as scalars.
 */
export function isScalarType(t: PropertyMeta['type']): t is Exclude<PropType, 'node' | 'prefab'> {
  return typeof t === 'string' && t !== 'node' && t !== 'prefab';
}

export interface ComponentMeta {
  /** XML tag name inside <Components>. */
  name: string;
  description?: string;
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

/** Global registry indexing all available components (and, later, node tags). */
export const Registry = new EngineRegistry();
