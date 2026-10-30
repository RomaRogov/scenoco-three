/**
 * @internal What a host — the editor, or the bridge a test drives — does to a running game from the
 * outside: holds its clock, so the page's loop stops calling `runtime.update` and frames pass only
 * when stepped, and draws it from another camera. `play` reads both every frame.
 */
import type { Camera } from 'three';
import type { Runtime } from './kernel/runtime.js';

const held = new WeakSet<Runtime>();
/** A viewpoint drawn instead of the game camera while it lasts. */
const viewing = new WeakMap<Runtime, Camera>();

/** @internal true while a host holds this runtime's clock. */
export function isHeld(runtime: Runtime): boolean {
  return held.has(runtime);
}

/** @internal hold the clock, or let it run. */
export function setHeld(runtime: Runtime, hold: boolean): void {
  if (hold) held.add(runtime);
  else held.delete(runtime);
}

/** @internal the camera a host asked to draw from, if any. */
export function viewOf(runtime: Runtime): Camera | null {
  return viewing.get(runtime) ?? null;
}

/** @internal draw from `camera` instead of the game's, or from the game's again with null. */
export function setView(runtime: Runtime, camera: Camera | null): void {
  if (camera) viewing.set(runtime, camera);
  else viewing.delete(runtime);
}
