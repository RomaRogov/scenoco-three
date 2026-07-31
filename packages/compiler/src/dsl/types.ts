import { Color } from 'three';
import { isEnumType, type EnumDef } from '@scenoco-three/core/internal';
import { ValueType } from '@scenoco-three/core/internal';
import {
  EULER_FORMAT,
  VEC2_FORMAT,
  VEC3_FORMAT,
  VEC_AXES,
  parseVecText,
  serializeVecText,
  serializeVecPositional,
  vecFormatFor,
  type VecFormat,
} from '@scenoco-three/core/internal';

/**
 * Canonical wire formats for SceNoCo attribute values — the single place that
 * defines how each scalar/math property is written in XML, parsed into a
 * JSON-serializable compiled value, serialized back, and described in XSD.
 *
 * Compiled representation (what flows through compile → instantiate, and what
 * ships as JSON in production builds) is deliberately plain and fast:
 *   float/int  → number
 *   bool       → boolean
 *   string     → string
 *   vec2/vec3  → number[]              (length 2 / 3)
 *   euler      → number[] in DEGREES   (degrees end to end; the radian conversion
 *                                       happens once at instantiate — see the
 *                                       `euler` codec below and instantiate.ts)
 *   color      → number (0xRRGGBB)
 *
 * The vector *text* grammar ("y: 1.5; z: -3", or positional "0 1.5 -3") is
 * declared once in core — `scene/vec-format.ts` — and wrapped here; see that
 * module for why it cannot live in this file.
 *
 * Reference types (`node` and typed component references) are not scalar codecs;
 * they need the scene-wide name/id tables and are resolved by the compiler.
 *
 * The two value *types* are owned by core (the runtime consumes compiled values),
 * and re-exported here so a consumer of the compiler gets the whole vocabulary
 * from one import. Declaring them twice is what let the radians/degrees model
 * drift between the packages in the first place.
 */

export type { CompiledScalar, ScalarType } from '@scenoco-three/core/internal';
import type { CompiledScalar, ScalarType } from '@scenoco-three/core/internal';

export interface ParseOk<T> {
  ok: true;
  value: T;
}
export interface ParseErr {
  ok: false;
  /** LLM-actionable: says what was expected and shows a valid example. */
  message: string;
}
export type ParseResult<T> = ParseOk<T> | ParseErr;

const ok = <T>(value: T): ParseOk<T> => ({ ok: true, value });
const err = (message: string): ParseErr => ({ ok: false, message });

export interface XsdType {
  /** Underlying XSD simple type. */
  base: string;
  /** Optional restriction pattern for string-encoded math types. */
  pattern?: string;
}

export interface TypeCodec<T extends CompiledScalar = CompiledScalar> {
  /** Human label used in error messages, e.g. "a vec3". */
  label: string;
  /** A valid example value, shown in errors and docs. */
  example: string;
  parse(raw: string): ParseResult<T>;
  serialize(value: T): string;
  xsd: XsdType;
}

// A single finite number: 1, -2.5, .5, 3e2, +4. Used for runtime parsing (JS regex).
const NUM_SRC = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const NUM_RE = new RegExp(`^${NUM_SRC}$`);

// XML-Schema-flavored equivalents for the generated XSD: patterns are implicitly
// anchored and forbid the `(?:…)` non-capturing group, so we use plain groups.
const XSD_NUM = '[+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?';

function parseFiniteNumber(raw: string): ParseResult<number> {
  const t = raw.trim();
  if (!NUM_RE.test(t)) return err(`expected a number (e.g. "1.5"), got "${raw}"`);
  const n = Number(t);
  return Number.isFinite(n) ? ok(n) : err(`expected a finite number, got "${raw}"`);
}

// ---- vectors ---------------------------------------------------------------
//
// The grammar itself lives in core (`scene/vec-format.ts`) because the editor's
// browser-side document model parses attribute text too and deliberately never
// bundles the compiler — a second declaration here is exactly how the
// radians/degrees model drifted once before. This file keeps only the build-time
// wrapping: the codec table, and the XSD patterns.

/** Adapt core's vector parse to the compiler's ParseResult shape. */
const vecCodecParse =
  (fmt: VecFormat) =>
  (raw: string): ParseResult<number[]> => {
    const r = parseVecText(raw, fmt);
    return r.ok ? ok(r.value) : err(r.message);
  };

const vecCodecSerialize = (fmt: VecFormat) => (v: CompiledScalar) => serializeVecText(v as number[], fmt);

/**
 * XSD pattern accepting either form. XSD cannot express "no duplicate axis" or
 * "at most n declarations"; the validator reports those with a real message.
 */
function xsdVecPattern(fmt: VecFormat): string {
  const axes = `[${VEC_AXES.slice(0, fmt.n).join('')}]`;
  const positional = `${XSD_NUM}(\\s+${XSD_NUM}){${fmt.n - 1}}`;
  const keyed = `${axes}\\s*:\\s*${XSD_NUM}(\\s*;\\s*${axes}\\s*:\\s*${XSD_NUM})*\\s*;?`;
  return `\\s*(${positional}|${keyed})\\s*`;
}

/** Positional-only number list, for the shader types whose components have no names. */
function parseNumberList(raw: string, n: number, label: string): ParseResult<number[]> {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== n || parts.some((p) => !NUM_RE.test(p))) {
    return err(`expected ${label} — ${n} space-separated numbers, got "${raw}"`);
  }
  return ok(parts.map(Number));
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const codecs: Record<ScalarType, TypeCodec> = {
  float: {
    label: 'a number',
    example: '1.5',
    parse: parseFiniteNumber,
    serialize: (v) => String(v),
    xsd: { base: 'xs:float' },
  },

  int: {
    label: 'an integer',
    example: '32',
    parse: (raw) => {
      const r = parseFiniteNumber(raw);
      if (!r.ok) return r;
      return Number.isInteger(r.value) ? r : err(`expected an integer (e.g. "32"), got "${raw}"`);
    },
    serialize: (v) => String(v),
    xsd: { base: 'xs:int' },
  },

  bool: {
    label: 'a boolean',
    example: 'true',
    parse: (raw) => {
      const t = raw.trim();
      if (t === 'true') return ok(true);
      if (t === 'false') return ok(false);
      return err(`expected "true" or "false", got "${raw}"`);
    },
    serialize: (v) => String(v),
    xsd: { base: 'xs:boolean' },
  },

  string: {
    label: 'a string',
    example: 'hello',
    parse: (raw) => ok(raw),
    serialize: (v) => String(v),
    xsd: { base: 'xs:string' },
  },

  vec2: {
    label: VEC2_FORMAT.label,
    example: VEC2_FORMAT.example,
    parse: vecCodecParse(VEC2_FORMAT),
    serialize: vecCodecSerialize(VEC2_FORMAT),
    xsd: { base: 'xs:string', pattern: xsdVecPattern(VEC2_FORMAT) },
  },

  vec3: {
    label: VEC3_FORMAT.label,
    example: VEC3_FORMAT.example,
    parse: vecCodecParse(VEC3_FORMAT),
    serialize: vecCodecSerialize(VEC3_FORMAT),
    xsd: { base: 'xs:string', pattern: xsdVecPattern(VEC3_FORMAT) },
  },

  euler: {
    // Degrees, end to end (Unity/Blender/A-Frame convention). The compiled form
    // stays degrees too — no build-time deg→rad conversion; the radian conversion
    // happens once at instantiate, via Object3D.eulerAngles (see instantiate.ts).
    // Deliberately *no* unit suffix: requiring "deg" would invent a new format
    // error, and allowing both "deg" and "rad" would reintroduce the ambiguity
    // the separate `eulerAngles` name exists to remove.
    label: EULER_FORMAT.label,
    example: EULER_FORMAT.example,
    parse: vecCodecParse(EULER_FORMAT),
    serialize: vecCodecSerialize(EULER_FORMAT),
    xsd: { base: 'xs:string', pattern: xsdVecPattern(EULER_FORMAT) },
  },

  color: {
    label: 'a color',
    example: '#ffcc00',
    parse: (raw) => {
      const t = raw.trim();
      if (HEX_RE.test(t)) return ok(new Color(t).getHex());
      if (t.toLowerCase() in Color.NAMES) return ok(new Color(t.toLowerCase()).getHex());
      return err(`expected a hex color (e.g. "#ffcc00") or a CSS color name (e.g. "tomato"), got "${raw}"`);
    },
    serialize: (v) => `#${(v as number).toString(16).padStart(6, '0')}`,
    xsd: { base: 'xs:string', pattern: `#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|[a-zA-Z]+` },
  },
};

// ---- enums ----------------------------------------------------------------
//
// An enum's XML/XSD surface is its member names; its compiled & runtime value is
// the native value (number or string). The codec maps name↔value, so an enum
// flows through every value site exactly like a built-in scalar.

/** A per-enum codec: parse a member name → native value, serialize value → name. */
export function enumCodec(def: EnumDef): TypeCodec {
  return {
    label: `${def.name} (${def.names.join(' | ')})`,
    example: def.names[0]!,
    parse: (raw) => {
      const token = raw.trim();
      const value = def.byName.get(token);
      if (value !== undefined) return ok(value);
      const allowed = def.names.map((n) => `"${n}"`).join(', ');
      return err(`expected one of ${allowed} (enum ${def.name}), got "${raw}"`);
    },
    serialize: (value) => def.byValue.get(value as string | number) ?? String(value),
    // The XSD exporter emits a named simpleType per enum; reference it by name.
    xsd: { base: def.name },
  };
}

/** Resolve the codec for any value type — a built-in scalar or a registered enum. */
export function scalarCodec(type: ScalarType | EnumDef): TypeCodec {
  return isEnumType(type) ? enumCodec(type) : codecs[type];
}

/**
 * Parse a `<ShaderMaterial>` `<Uniform>` value by its declared type. Reuses the
 * scalar codecs where they overlap and adds the shader-only types — `vec4`/`mat3`/
 * `mat4` (4/9/16 space-separated floats) and `sampler2D` (a texture path string).
 */
export function uniformValue(type: string, raw: string): ParseResult<CompiledScalar> {
  switch (type) {
    case ValueType.Float:
    case ValueType.Int:
    case ValueType.Bool:
    case ValueType.Vec2:
    case ValueType.Vec3:
    case ValueType.Color:
      return codecs[type].parse(raw);
    case 'vec4':
      return parseNumberList(raw, 4, 'a vec4');
    case 'mat3':
      return parseNumberList(raw, 9, 'a mat3 (9 numbers)');
    case 'mat4':
      return parseNumberList(raw, 16, 'a mat4 (16 numbers)');
    case 'sampler2D': {
      const t = raw.trim();
      return t ? ok(t) : err('a sampler2D needs a texture path, e.g. "noise.png"');
    }
    default:
      return err(`unknown uniform type "${type}"`);
  }
}

// ---- arrays ---------------------------------------------------------------
//
// Array attributes are written as a bracketed, comma-separated list: `[a,b,c]`
// (empty: `[]`). Comma is the separator, so an element value may not contain a
// comma — only relevant to `string` elements, which therefore can't hold commas.
// Every other type's canonical form is comma-free (floats use `.`, vecs use
// spaces, colors `#`, refs `#id`), so all element types are supported.

/** True if `raw` is wrapped in `[ … ]` (an array literal). */
export function isArrayLiteral(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith('[') && t.endsWith(']');
}

/**
 * Split a `[a,b,c]` literal into trimmed element strings. `[]` → `[]`. Errors if
 * `raw` is not bracketed (so a missing-bracket mistake gets a clear message).
 */
export function parseArrayLiteral(raw: string): ParseResult<string[]> {
  const t = raw.trim();
  if (!isArrayLiteral(t)) return err(`expected an array in brackets (e.g. "[a,b,c]"), got "${raw}"`);
  const inner = t.slice(1, -1).trim();
  if (inner === '') return ok([]);
  return ok(inner.split(',').map((s) => s.trim()));
}

/** Parse a scalar/enum-array literal `[…]` into compiled element values. */
export function parseScalarArray(raw: string, type: ScalarType | EnumDef): ParseResult<CompiledScalar[]> {
  const literal = parseArrayLiteral(raw);
  if (!literal.ok) return literal;
  const codec = scalarCodec(type);
  const out: CompiledScalar[] = [];
  for (let i = 0; i < literal.value.length; i++) {
    const r = codec.parse(literal.value[i]!);
    if (!r.ok) return err(`element ${i} — ${r.message}`);
    out.push(r.value);
  }
  return ok(out);
}

/** Serialize compiled element values back to a `[a,b,c]` literal. */
export function serializeScalarArray(values: CompiledScalar[], type: ScalarType | EnumDef): string {
  // Vector elements are written positionally inside a list — see
  // `serializeVecPositional`. Keying every vertex of a polygon would repeat the
  // axis names n times for no gain in clarity.
  const fmt = isEnumType(type) ? undefined : vecFormatFor(type);
  if (fmt) return `[${values.map((v) => serializeVecPositional(v as number[], fmt)).join(',')}]`;
  const codec = scalarCodec(type);
  return `[${values.map((v) => codec.serialize(v)).join(',')}]`;
}

/** A worked array example for a scalar element type (docs/errors). */
export function arrayExample(type: ScalarType): string {
  // Match what the serializer emits: vectors are positional inside a list.
  const fmt = vecFormatFor(type);
  const one = fmt ? fmt.positional : codecs[type].example;
  return `[${one},${one}]`;
}
