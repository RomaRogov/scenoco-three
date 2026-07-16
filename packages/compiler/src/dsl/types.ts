import { Color } from 'three';
import { isEnumType, type EnumDef } from '@scenoco-three/core/internal';
import { ValueType } from '@scenoco-three/core/internal';

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
 *   euler      → number[] in RADIANS   (XML is degrees; converted at parse time)
 *   color      → number (0xRRGGBB)
 *
 * Reference types (`node` and typed component references) are not scalar codecs;
 * they need the scene-wide name/id tables and are resolved by the compiler.
 */

export type ScalarType = 'float' | 'int' | 'bool' | 'string' | 'vec2' | 'vec3' | 'euler' | 'color';

export type CompiledScalar = number | boolean | string | number[];

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
const xsdVecPattern = (n: number) => `\\s*${XSD_NUM}(\\s+${XSD_NUM}){${n - 1}}\\s*`;

function parseFiniteNumber(raw: string): ParseResult<number> {
  const t = raw.trim();
  if (!NUM_RE.test(t)) return err(`expected a number (e.g. "1.5"), got "${raw}"`);
  const n = Number(t);
  return Number.isFinite(n) ? ok(n) : err(`expected a finite number, got "${raw}"`);
}

function parseVec(raw: string, n: number, label: string): ParseResult<number[]> {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== n) {
    return err(`expected ${label} — ${n} space-separated numbers (e.g. "${vecExample(n)}"), got "${raw}"`);
  }
  const out: number[] = [];
  for (const p of parts) {
    if (!NUM_RE.test(p)) {
      return err(`expected ${label} — ${n} space-separated numbers (e.g. "${vecExample(n)}"), got "${raw}"`);
    }
    out.push(Number(p));
  }
  return ok(out);
}

const vecExample = (n: number) => (n === 2 ? '0 1' : '0 1.5 -3');
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

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
    label: 'a vec2',
    example: '0 1',
    parse: (raw) => parseVec(raw, 2, 'a vec2'),
    serialize: (v) => (v as number[]).join(' '),
    xsd: { base: 'xs:string', pattern: xsdVecPattern(2) },
  },

  vec3: {
    label: 'a vec3',
    example: '0 1.5 -3',
    parse: (raw) => parseVec(raw, 3, 'a vec3'),
    serialize: (v) => (v as number[]).join(' '),
    xsd: { base: 'xs:string', pattern: xsdVecPattern(3) },
  },

  euler: {
    // XML carries degrees (Unity/Blender/A-Frame convention); compiled is radians.
    label: 'an euler (degrees)',
    example: '0 90 0',
    parse: (raw) => {
      const r = parseVec(raw, 3, 'an euler (degrees)');
      return r.ok ? ok(r.value.map((d) => d * DEG2RAD)) : r;
    },
    serialize: (v) => (v as number[]).map((rad) => round(rad * RAD2DEG)).join(' '),
    xsd: { base: 'xs:string', pattern: xsdVecPattern(3) },
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

// Trim floating-point dust when serializing degrees back from radians.
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

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
      return parseVec(raw, 4, 'a vec4');
    case 'mat3':
      return parseVec(raw, 9, 'a mat3 (9 numbers)');
    case 'mat4':
      return parseVec(raw, 16, 'a mat4 (16 numbers)');
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
  const codec = scalarCodec(type);
  return `[${values.map((v) => codec.serialize(v)).join(',')}]`;
}

/** A worked array example for a scalar element type (docs/errors). */
export function arrayExample(type: ScalarType): string {
  return `[${codecs[type].example},${codecs[type].example}]`;
}
