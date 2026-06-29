/**
 * Minimal GLSL introspection for `<ShaderMaterial>` validation: pull the uniform
 * declarations out of shader source so the compiler can check each XML `<Uniform>`
 * against the name and type the shader actually declares.
 */

/** `<Uniform type>` → the GLSL type it must be declared as (`color` is a `vec3`). */
const GLSL_FOR: Record<string, string> = {
  float: 'float',
  int: 'int',
  bool: 'bool',
  vec2: 'vec2',
  vec3: 'vec3',
  vec4: 'vec4',
  color: 'vec3',
  mat3: 'mat3',
  mat4: 'mat4',
  sampler2D: 'sampler2D',
};

const UNIFORM_RE = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*(?:\[\s*\d+\s*\])?\s*;/g;

/** Map of `uniform` name → declared GLSL type in `glsl` (comments stripped first). */
export function parseUniforms(glsl: string): Map<string, string> {
  const src = glsl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const out = new Map<string, string>();
  for (const m of src.matchAll(UNIFORM_RE)) out.set(m[2]!, m[1]!);
  return out;
}

/** True if a `<Uniform type>` is compatible with the shader's declared `glslType`. */
export function glslMatches(uniformType: string, glslType: string): boolean {
  return GLSL_FOR[uniformType] === glslType;
}
