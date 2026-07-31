/**
 * The text grammar for vector-shaped attribute values — the one implementation,
 * shared by everything that reads or writes scene text.
 *
 * A vector is written as **keyed axis declarations**, CSS-declaration style:
 *
 *     position="y: 1.15; z: -0.24"     eulerAngles="y: 90"
 *
 * Declarations are order-independent and any axis may be omitted, taking 0 — so
 * the text states only what differs from rest. The **positional** form ("0 1.15 -0.24") stays
 * accepted permanently: it is what three.js/Unity habits produce, and rejecting
 * it would manufacture a format error for no gain. Only the keyed form is emitted.
 *
 * The separator is `;`, never `,`. That is load-bearing, not cosmetic: array
 * literals (`[a,b,c]`) split on commas, so a comma inside a scalar's wire form
 * makes arrays of that scalar unparseable. **No scalar wire form may contain a
 * comma.**
 *
 * ## Why this lives in core
 *
 * Core does not parse *bundles* as text — it loads compiled JSON. But two
 * separate consumers parse attribute *text*: the compiler (build time, Node) and
 * the editor's document model (browser, which deliberately never bundles the
 * compiler). Declaring the grammar twice is precisely what let the radians/
 * degrees model drift between packages once before, so it is declared here, once,
 * and both sides delegate. Diagnostics phrasing, XSD patterns, and the codec
 * table remain build-time concerns and stay in the compiler.
 */

/** Axis keys in canonical order; a vec2 uses the first two. */
export const VEC_AXES = ['x', 'y', 'z'] as const;

/**
 * An omitted axis is **always 0** — one rule, no per-attribute exceptions. In
 * particular `scale` is an ordinary vec3, exactly as it is in three.js, where
 * `position` and `scale` are both a plain `Vector3`. A `scale`-specific type
 * with identity 1 and a uniform shorthand was tried and removed: it bought a
 * shorter spelling for an attribute that appears zero times across both example
 * games, at the cost of a public `ValueType` and a second rule to remember.
 */
export interface VecFormat {
  n: number;
  /** Human label used in messages, e.g. "a vec3". */
  label: string;
  /** Short keyed example, shown in diagnostics. */
  example: string;
  /** Equivalent positional example, so the older form stays discoverable. */
  positional: string;
  /**
   * Trim floating-point dust on output. Only euler wants this — its numbers come
   * back from a radian conversion. Positions carry whatever precision the author
   * wrote, and rounding them would silently degrade an authored value on every
   * round-trip.
   */
  round?: boolean;
}

/** The value an omitted axis takes, for every vector format. */
const IDENTITY = 0;

export const VEC2_FORMAT: VecFormat = { n: 2, label: 'a vec2', example: 'x: 0.5', positional: '0 1' };
export const VEC3_FORMAT: VecFormat = { n: 3, label: 'a vec3', example: 'y: 1.5', positional: '0 1.5 -3' };
export const EULER_FORMAT: VecFormat = {
  n: 3,
  label: 'an euler (degrees)',
  example: 'y: 90',
  positional: '0 90 0',
  round: true,
};

/**
 * The format for a vector-shaped {@link ValueType}, or `undefined` for any type
 * that is not vector-shaped. Lets a caller go from registry metadata straight to
 * the grammar without a second switch that can fall out of step.
 */
export function vecFormatFor(type: unknown): VecFormat | undefined {
  switch (type) {
    case 'vec2':
      return VEC2_FORMAT;
    case 'vec3':
      return VEC3_FORMAT;
    case 'euler':
      return EULER_FORMAT;
    default:
      return undefined;
  }
}

export type VecParse = { ok: true; value: number[] } | { ok: false; message: string };

// A single finite number: 1, -2.5, .5, 3e2, +4.
const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

const fail = (message: string): VecParse => ({ ok: false, message });

/** The one message that teaches the grammar; every vector parse failure ends here. */
export function vecMessage(fmt: VecFormat, raw: string, why?: string): string {
  return (
    `expected ${fmt.label} — e.g. "${fmt.example}" ` +
    `(an omitted axis is ${IDENTITY}), or the positional form "${fmt.positional}"` +
    `${why ? `; ${why}` : ''}, got "${raw}"`
  );
}

/** Parse either accepted form into a fixed-length number array. */
export function parseVecText(raw: string, fmt: VecFormat): VecParse {
  const t = raw.trim();
  if (t.includes(':')) return parseKeyed(t, fmt);
  return parsePositional(t, fmt);
}

function parseKeyed(raw: string, fmt: VecFormat): VecParse {
  const allowed = VEC_AXES.slice(0, fmt.n) as readonly string[];
  const out = new Array<number>(fmt.n).fill(IDENTITY);
  const seen = new Set<string>();
  for (const segment of raw.split(';')) {
    const s = segment.trim();
    if (s === '') continue; // tolerate a trailing ";" — a CSS habit, harmless
    const colon = s.indexOf(':');
    if (colon === -1) return fail(vecMessage(fmt, raw, `"${s}" is missing a ":"`));
    const axis = s.slice(0, colon).trim().toLowerCase();
    const value = s.slice(colon + 1).trim();
    const i = allowed.indexOf(axis);
    if (i === -1) return fail(`unknown axis "${axis}" in ${fmt.label} — expected ${allowed.join(', ')}`);
    if (seen.has(axis)) return fail(`${fmt.label} sets "${axis}" twice`);
    seen.add(axis);
    if (!NUM_RE.test(value)) return fail(`${fmt.label} axis "${axis}": expected a number, got "${value}"`);
    out[i] = Number(value);
  }
  if (seen.size === 0) return fail(vecMessage(fmt, raw, 'no axes were set'));
  return { ok: true, value: out };
}

function parsePositional(raw: string, fmt: VecFormat): VecParse {
  const parts = raw.split(/\s+/);
  if (parts.length !== fmt.n || parts.some((p) => !NUM_RE.test(p))) return fail(vecMessage(fmt, raw));
  return { ok: true, value: parts.map(Number) };
}

/** Canonical output: keyed, xyz order, identity axes elided. */
export function serializeVecText(value: readonly number[], fmt: VecFormat): string {
  const parts: string[] = [];
  for (let i = 0; i < fmt.n; i++) {
    const n = num(value[i] ?? IDENTITY, fmt);
    if (n !== IDENTITY) parts.push(`${VEC_AXES[i]}: ${n}`);
  }
  // An all-identity vector would otherwise serialize to "", and an attribute must
  // never be emitted with an empty value. Callers normally omit the attribute
  // entirely in that case; writing it out in full is the safe fallback.
  if (parts.length === 0) {
    return VEC_AXES.slice(0, fmt.n)
      .map((a) => `${a}: ${IDENTITY}`)
      .join('; ');
  }
  return parts.join('; ');
}

/**
 * Positional output — the form used for vectors **inside an array literal**.
 *
 * A standalone vector is keyed; a vector in a list is not. That is CSS's own
 * rule (`clip-path: polygon(0 0, 100% 0)` nests space-separated pairs in a comma
 * list, while `translate: 10px 20px` is a standalone tuple), and it keeps a
 * polygon readable instead of repeating axis names once per vertex.
 */
export function serializeVecPositional(value: readonly number[], fmt: VecFormat): string {
  const out: string[] = [];
  for (let i = 0; i < fmt.n; i++) out.push(String(num(value[i] ?? IDENTITY, fmt)));
  return out.join(' ');
}

/** Output form of one component: exact unless the format asks for dust-trimming. */
function num(n: number, fmt: VecFormat): number {
  return fmt.round ? Math.round(n * 1e6) / 1e6 : n;
}
