import type { Color, Euler, Object3D, Vector2, Vector3 } from 'three';
import type { Component } from '@scenoco-three/core';
import { componentName, round, toDeg } from '../meta.js';

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
  if (o.isObject3D) return (o as unknown as Object3D).sceneId || '(node)';
  if (o.constructor?.name === 'PrefabAsset') return '(prefab)';
  if ('node' in o && 'engine' in o) return componentName(v as Component) ?? '(component)';
  return String(v);
}

export const vec = (v: Vector3 | Vector2): string =>
  'z' in v ? `${round(v.x)} ${round(v.y)} ${round((v as Vector3).z)}` : `${round(v.x)} ${round(v.y)}`;
export const euler = (e: Euler): string => `${toDeg(e.x)} ${toDeg(e.y)} ${toDeg(e.z)}`;
export const eulerArr = (e: Euler): number[] => [e.x, e.y, e.z];
export const fmtNum = (n: number): string => String(round(n));
