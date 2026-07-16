import type { Object3D } from 'three';
import { Registry, type Component, type ComponentMeta } from '@scenoco-three/core';

// Shared editor lookups + numeric helpers — the single home for utilities that
// panels, session, and the host (main) all need.

/** True if `object` (or any ancestor) is editor-internal — excluded from the tree, picking, and previews. */
export function isEditorOnly(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o.userData.scenocoEditorOnly) return true;
  return false;
}

/** The registry metadata for a live component instance (matches subclasses too). */
export function registeredMeta(component: Component): ComponentMeta | undefined {
  for (const name of Registry.componentNames()) {
    const entry = Registry.getComponent(name);
    if (entry && component instanceof entry.ctor) return entry.meta;
  }
  return undefined;
}

/** The registered tag name of a live component instance (exact class match). */
export function componentName(component: Component): string | undefined {
  for (const name of Registry.componentNames()) {
    const entry = Registry.getComponent(name);
    if (entry && component.constructor === entry.ctor) return name;
  }
  return undefined;
}

export const round = (n: number): number => Math.round(n * 1000) / 1000;
export const toDeg = (rad: number): number => round((rad * 180) / Math.PI);
export const toRad = (deg: number): number => (deg * Math.PI) / 180;
