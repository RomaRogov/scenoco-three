import { Euler, Quaternion, Vector3, type Object3D } from 'three';

/**
 * The simulation runs in **world space**; a node's transform is relative to its parent.
 *
 * Nothing says a body has to sit at the root of the scene — a wall of bricks is laid out under
 * one node, exactly as it would be in Unity — and reading `node.position` for the body put
 * every one of those bricks wherever its offset happened to land: the wall was drawn where the
 * document said and collided with nothing, ten units below.
 *
 * So the pose goes to the world both ways: the body is placed where the node *is*, and the
 * result comes back through the parent.
 */

const POSITION = new Vector3();
const ROTATION = new Quaternion();
const ANGLES = new Euler();
const SCALE = new Vector3();

/**
 * Where a node is in the world, as this simulation sees it: x, y, and the angle about z. `fresh`
 * when its world matrix is already up to date: three's getWorldPosition and getWorldQuaternion each
 * walk up to the root again, and on a phone those walks were a tenth of the frame.
 */
export function worldPose(node: Object3D, fresh = false): { x: number; y: number; angle: number } {
  if (!fresh) node.updateWorldMatrix(true, false);
  node.matrixWorld.decompose(POSITION, ROTATION, SCALE);
  ANGLES.setFromQuaternion(ROTATION);
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

/**
 * Where a collider's own space sits in its body's: offset, turn and scale. A collider on the body's
 * node is at the origin, scaled by the node's world scale; one on a node under it — a compound
 * body — is placed where that node is, relative to the body's node.
 */
export interface ShapeFrame {
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
}

export function shapeFrame(node: Object3D, owner: Object3D): ShapeFrame {
  // One walk up from the node brings the owner, its ancestor, up to date too.
  const at = worldPose(node);
  const scaleX = SCALE.x;
  const scaleY = SCALE.y;
  if (node === owner) return { x: 0, y: 0, angle: 0, scaleX, scaleY };
  const from = worldPose(owner, true);
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  const cos = Math.cos(-from.angle);
  const sin = Math.sin(-from.angle);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos, angle: at.angle - from.angle, scaleX, scaleY };
}

/** A point of the collider's own space, in its body's. */
export function placePoint(frame: ShapeFrame, x: number, y: number): { x: number; y: number } {
  const sx = x * frame.scaleX;
  const sy = y * frame.scaleY;
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  return { x: frame.x + sx * cos - sy * sin, y: frame.y + sx * sin + sy * cos };
}

/** Whether two frames place a shape the same way — within what float noise moves. */
export function sameFrame(a: ShapeFrame, b: ShapeFrame): boolean {
  return (
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.scaleX - b.scaleX) + Math.abs(a.scaleY - b.scaleY) < 1e-5 &&
    Math.abs(Math.atan2(Math.sin(a.angle - b.angle), Math.cos(a.angle - b.angle))) < 1e-5
  );
}
