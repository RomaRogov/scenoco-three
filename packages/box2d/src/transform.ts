import { Euler, Quaternion, Vector3, type Object3D } from 'three';

/**
 * The simulation runs in **world space**; a node's transform is relative to its parent.
 *
 * Nothing says a body has to sit at the root of the scene — a wall of bricks is laid out under
 * one node, exactly as it would be in Unity — and reading `object3D.position` for the body put
 * every one of those bricks wherever its offset happened to land: the wall was drawn where the
 * document said and collided with nothing, ten units below.
 *
 * So the pose goes to the world both ways: the body is placed where the node *is*, and the
 * result comes back through the parent.
 */

const POSITION = new Vector3();
const ROTATION = new Quaternion();
const ANGLES = new Euler();

/** Where a node is in the world, as this simulation sees it: x, y, and the angle about z. */
export function worldPose(node: Object3D): { x: number; y: number; angle: number } {
  node.getWorldPosition(POSITION);
  ANGLES.setFromQuaternion(node.getWorldQuaternion(ROTATION));
  return { x: POSITION.x, y: POSITION.y, angle: ANGLES.z };
}

/**
 * Put a world pose back on the node, through whatever it hangs under.
 *
 * Z is left where it was — the simulation is two-dimensional, and a 2D game is free to lay its
 * art out in depth.
 */
export function applyWorldPose(node: Object3D, x: number, y: number, angle: number): void {
  const parent = node.parent;
  if (!parent) {
    node.position.set(x, y, node.position.z);
    node.rotation.z = angle;
    return;
  }
  parent.updateWorldMatrix(true, false);
  node.getWorldPosition(POSITION).set(x, y, POSITION.z);
  node.position.copy(parent.worldToLocal(POSITION));
  ANGLES.setFromQuaternion(parent.getWorldQuaternion(ROTATION));
  node.rotation.z = angle - ANGLES.z;
}
