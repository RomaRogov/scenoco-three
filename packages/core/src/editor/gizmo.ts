import { Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';

const PADS = ['XY', 'YZ', 'XZ'];
/** Each two-axis pad's own geometry, as three.js made it. */
const padShapes = new WeakMap<Mesh, BufferGeometry>();

/**
 * The move gizmo's two-axis pads are a fingertip at most. Pressed with a finger, they — what is
 * drawn and what is hit — grow to twice the size and step out from the axes to make room; with a
 * mouse they are three.js's again. Nothing else of the gizmo changes.
 */
export function fingerPads(gizmo: object, big: boolean): void {
  const parts = (gizmo as { _gizmo?: { gizmo: Record<string, Object3D>; picker: Record<string, Object3D> } })._gizmo;
  if (!parts) return;
  for (const handle of [...parts.gizmo.translate!.children, ...parts.picker.translate!.children] as Mesh[]) {
    // Not instanceof: the addon may come with another copy of three.
    if (!(handle as Mesh).isMesh || !PADS.includes(handle.name)) continue;
    let shape = padShapes.get(handle);
    if (!shape) padShapes.set(handle, (shape = handle.geometry as BufferGeometry));
    if (!big) {
      if (handle.geometry !== shape) (handle.geometry as BufferGeometry).dispose();
      handle.geometry = shape;
      continue;
    }
    if (handle.geometry !== shape) continue;
    shape.computeBoundingBox();
    const centre = shape.boundingBox!.getCenter(new Vector3());
    handle.geometry = shape.clone().translate(-centre.x, -centre.y, -centre.z).scale(2, 2, 2).translate(centre.x * 1.7, centre.y * 1.7, centre.z * 1.7);
  }
}
