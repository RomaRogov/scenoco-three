import { Raycaster, Vector2, type Camera, type Object3D, type Scene } from 'three';
import { findProvenance } from '@scenoco-three/core';

const raycaster = new Raycaster();
const pointer = new Vector2();

/**
 * What a click at these coordinates selects: the nearest node a **document** authored.
 *
 * A ray hits some deeply nested mesh inside a model nobody wrote by hand, so the hit itself is
 * rarely the answer — the thing worth selecting is the element that put it there, which is what
 * the compiler's provenance stamp says.
 *
 * Returns null for a click on nothing, and for a click on something the editor drew for itself.
 */
export function pickAt(
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  scene: Scene,
  camera: Camera,
): Object3D | null {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(scene.children, true).find((i) => !belongsToEditor(i.object));
  return hit ? (findProvenance(hit.object)?.object ?? null) : null;
}

/**
 * Is this object, **or anything above it**, something the editor drew for itself?
 *
 * Not the same question as `meta.ts`'s `isEditorOnly`, which asks only about the object itself —
 * that one answers for a node the chrome is about to list, where the object *is* the helper's
 * root. Here a ray has hit one of the small meshes deep inside a helper, so the flag is on an
 * ancestor. Testing only the hit object let a click on a gizmo handle select the gizmo — which
 * attached the transform control to its own helper and put `updateMatrixWorld` into infinite
 * recursion, killing the page.
 */
function belongsToEditor(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.userData.scenocoEditorOnly) return true;
  }
  return false;
}
