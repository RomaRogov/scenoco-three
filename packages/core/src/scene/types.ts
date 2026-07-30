/**
 * The compiled representation of a SceNoCo attribute value — what flows through
 * compile → instantiate, and what ships as JSON in production builds.
 * Deliberately plain and fast:
 *   float/int  → number
 *   bool       → boolean
 *   string     → string
 *   vec2/vec3  → number[]              (length 2 / 3)
 *   euler      → number[] in DEGREES   (degrees end to end; the radian conversion
 *                                       happens once at instantiate, via
 *                                       Object3D.eulerAngles — see instantiate.ts)
 *   color      → number (0xRRGGBB)
 *
 * Only the *types* live here. The codecs that parse/serialize these formats and
 * describe them in XSD are build-time concerns and live in the compiler
 * (`@scenoco-three/compiler` → `dsl/types.ts`), the single place that defines the
 * XML wire format. Core never parses attribute text — it loads a compiled bundle.
 *
 * Reference types (`node` and typed component references) are not scalars; they
 * need the scene-wide name/id tables and are resolved by the compiler.
 */

export type ScalarType = 'float' | 'int' | 'bool' | 'string' | 'vec2' | 'vec3' | 'euler' | 'color';

export type CompiledScalar = number | boolean | string | number[];
