/**
 * A value three ways: as the editor shows it (degrees, `#rrggbb`, rounded), as the live object takes
 * it, and as the file is written with it — and which values it edits at all, by their kind.
 */
import type { Field, Kind } from './types.js';

/**
 * What an editable value is: as the project declares it when the dev server has said — a colour,
 * one of a few options — and otherwise from the value itself.
 */
export function kindOf(value: unknown, name: string, field?: Field): Kind | undefined {
  if (field && fits(value, field.kind)) return field.kind;
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.isColor) return 'color';
  if (v.isEuler || (name === 'rotation' && Array.isArray(value))) return 'angles';
  if (v.isVector2 || v.isVector3 || v.isVector4) return 'vector';
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((x) => typeof x === 'number')) return 'vector';
  if (listItem(value)) return 'list';
  return undefined;
}

/**
 * What a list's items are, when every one is the same kind the editor edits on a line of its own —
 * numbers, strings, `#rrggbb` colours, flags, vectors: a spline's knots, waypoints, a palette.
 * A list of anything else — nodes, prefabs, knots with fields of their own — is shown as written.
 */
export function listItem(value: unknown): Kind | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.every((x) => typeof x === 'string')) return value.every((x) => HEX.test(x)) ? 'color' : 'string';
  const kinds = new Set(value.map((x) => kindOf(x, '')));
  const [kind] = kinds;
  return kinds.size === 1 && (kind === 'number' || kind === 'boolean' || kind === 'vector') ? kind : undefined;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Whether a live value can be edited as the kind its field is declared. */
export function fits(value: unknown, kind: Kind): boolean {
  const v = value as Record<string, unknown> | null;
  switch (kind) {
    case 'color':
      return typeof value === 'string' ? /^#[0-9a-f]{6}$/i.test(value) : !!v?.isColor;
    case 'option':
      return typeof value === 'string' || typeof value === 'number';
    case 'number':
    case 'boolean':
    case 'string':
      return typeof value === kind;
    default:
      return kindOf(value, kind === 'angles' ? 'rotation' : '') === kind;
  }
}

/** The value as the editor shows it. */
export function shown(value: unknown, kind: Kind): unknown {
  const v = value as Record<string, unknown> & { toArray?: () => unknown[]; getHexString?: () => string };
  if (kind === 'color') return typeof value === 'string' ? value : `#${v.getHexString!()}`;
  if (kind === 'angles') return (Array.isArray(value) ? value : v.toArray!()).slice(0, 3).map((r) => round((Number(r) * 180) / Math.PI));
  if (kind === 'vector') return (Array.isArray(value) ? value : v.toArray!()).map((x) => round(Number(x)));
  if (kind === 'list') return (value as unknown[]).map((x) => shown(x, listItem(value)!));
  if (kind === 'number') return round(value as number);
  return value;
}

/**
 * A value as written, in the units the editor shows the live one in — undefined when the two cannot
 * be compared: `scale={0.25}` is `[0.25, 0.25, 0.25]`, a colour is lower-case `#rrggbb`.
 */
export function asShown(written: unknown, kind: Kind, name: string, live: unknown, field?: Field): unknown {
  if (typeof written === 'number' && kind === 'vector') return (live as number[]).map(() => round(written));
  const own = kindOf(written, name, field);
  if (!own || (own !== kind && !(own === 'string' && kind === 'color'))) return undefined;
  const value = shown(written, kind === 'color' ? 'color' : own);
  return typeof value === 'string' && kind === 'color' ? value.toLowerCase() : value;
}

/** What the live object takes: radians for angles. */
export function toLive(value: unknown, kind: Kind | undefined): unknown {
  if (kind === 'angles') return (value as number[]).map((d) => (d * Math.PI) / 180);
  return value;
}

/** What the file is written with: radians for angles, four decimals. */
export function toFile(value: unknown, kind: Kind | undefined): unknown {
  if (kind === 'angles') return (value as number[]).map((d) => round((d * Math.PI) / 180, 4));
  if (kind === 'vector') return (value as number[]).map((x) => round(x, 4));
  if (kind === 'list') return (value as unknown[]).map((x) => toFile(x, listItem(value)));
  if (kind === 'number') return round(value as number, 4);
  return value;
}

/** A new item of a list, written like the one it replaces: a string keeps its quotes. */
export function itemText(value: unknown, was: string | undefined): string {
  if (typeof value === 'string') {
    const quote = was?.startsWith("'") ? "'" : '"';
    return `${quote}${value.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`;
  }
  return codeOf(value);
}

/** A dashed name walks in: `shadow-mapSize` is `shadow.mapSize`. */
export function read(target: object, name: string): unknown {
  if (name in target) return (target as Record<string, unknown>)[name];
  let value: unknown = target;
  for (const step of name.split('-')) value = (value as Record<string, unknown> | undefined)?.[step];
  return value;
}

export function codeOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(codeOf).join(', ')}]`;
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

export function same(a: unknown, b: unknown): boolean {
  return a === b || (typeof a !== 'symbol' && typeof b !== 'symbol' && JSON.stringify(a) === JSON.stringify(b));
}

export function round(x: number, places = 3): number {
  const k = 10 ** places;
  return Math.round(x * k) / k;
}
