import type { Color, Euler, Object3D, Vector2, Vector3 } from 'three';
import { round, toDeg } from '../meta.js';

// Pure value formatters for the inspector's read-only rows (ported unchanged from
// the old fields.ts). No DOM — just value → display string.

export function fmt(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean' || typeof v === 'string') return String(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  const o = v as Record<string, unknown> & {
    isVector3?: boolean; isVector2?: boolean; isColor?: boolean; isEuler?: boolean; isObject3D?: boolean;
  };
  if (o.isVector3 || o.isVector2) return vec(o as unknown as Vector3);
  if (o.isEuler) return euler(o as unknown as Euler);
  if (o.isColor) return `#${(o as unknown as Color).getHexString()}`;
  // A reference to another node or component: its class is the useful thing to show, since the
  // document refers to it by an id the inspector already renders on its own row.
  if (o.isObject3D) return `(${(v as Object3D).type})`;
  if ('object3D' in o) return `(${(v as object).constructor.name})`;
  return String(v);
}

export const vec = (v: Vector3 | Vector2): string =>
  'z' in v ? `${round(v.x)} ${round(v.y)} ${round((v as Vector3).z)}` : `${round(v.x)} ${round(v.y)}`;
export const euler = (e: Euler): string => `${toDeg(e.x)} ${toDeg(e.y)} ${toDeg(e.z)}`;
/** A live `Euler` (radians) as the degrees triple the DSL and inspector use. */
export const eulerDeg = (e: Euler): number[] => [toDeg(e.x), toDeg(e.y), toDeg(e.z)];
export const fmtNum = (n: number): string => String(round(n));
