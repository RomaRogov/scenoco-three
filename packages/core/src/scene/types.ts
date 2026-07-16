import { Color } from 'three';

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
