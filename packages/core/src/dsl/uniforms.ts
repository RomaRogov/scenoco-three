import { enumOf } from '../core/EnumRegistry.js';

/**
 * The uniform types a `<ShaderMaterial>` `<Uniform type="…">` may declare. Each
 * maps to a GLSL type and a runtime value shape:
 *   float/int → number · bool → boolean · vec2/3/4 → number[] · color → hex int
 *   (a vec3 Color) · mat3/mat4 → number[] (9/16) · sampler2D → a texture path.
 */
export const UNIFORM_TYPES = [
  'float',
  'int',
  'bool',
  'vec2',
  'vec3',
  'vec4',
  'color',
  'mat3',
  'mat4',
  'sampler2D',
] as const;

export type UniformTypeName = (typeof UNIFORM_TYPES)[number];

/** Registered as an enum so it gets a named XSD simpleType (and an editor dropdown later). */
export const UniformType = enumOf('UniformType', UNIFORM_TYPES);

export function isUniformType(t: string): t is UniformTypeName {
  return (UNIFORM_TYPES as readonly string[]).includes(t);
}
