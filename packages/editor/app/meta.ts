import type { Object3D } from 'three';

/**
 * The few things the chrome needs to say about a live object.
 *
 * Nothing is read off `Object3D`: the *document* knows which element built a node, so the editor
 * asks it, and a node with no element is one nothing authored.
 */

/**
 * Gizmo handles and helpers, which belong to the editor rather than to the scene — and a
 * component's preview, which is drawn *from* the document but is not something it says.
 *
 * Asks about this object alone — the chrome lists roots. Picking asks the same question of every
 * ancestor, because a ray lands deep inside a helper; that one is in `picking.ts`.
 *
 * A preview is deliberately not `scenocoToolOnly`: picking should see it, so that clicking the
 * terrain a component drew selects the node that component is on, which is what a person means by
 * clicking it. It is only the *tree* that should not list geometry the document never wrote.
 */
export function isEditorOnly(object: Object3D): boolean {
  return object.userData.scenocoToolOnly === true || object.userData.scenocoPreview !== undefined;
}

export const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Radians on a live `Euler` → the degrees a document is written in. */
export const toDeg = (radians: number): number => round((radians * 180) / Math.PI);
