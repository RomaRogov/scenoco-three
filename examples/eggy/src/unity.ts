import { Euler, Quaternion, Vector3 } from 'three';

/*
 * The Unity scene's numbers, read as written there. Unity is left-handed and three.js right-handed;
 * this port keeps Unity's x and y and flips z, so a position is (x, y, -z) and a rotation's x and y
 * parts change sign. The models were exported in the same frame.
 */

/** A Unity position. */
export const unityPosition = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, -z);

/** A Unity rotation, as its quaternion is stored in a scene or prefab. */
export const unityQuaternion = (x: number, y: number, z: number, w: number): Quaternion => new Quaternion(-x, -y, z, w);

/** A Unity rotation as the inspector shows it: Euler degrees, applied z, then x, then y. */
export function unityEuler(x: number, y: number, z: number): Quaternion {
  const q = new Quaternion().setFromEuler(new Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180, 'YXZ'));
  return unityQuaternion(q.x, q.y, q.z, q.w);
}

/** A Unity torque or angular velocity: a pseudovector, so under the flip its x and y change sign. */
export const unityTorque = (x: number, y: number, z: number): Vector3 => new Vector3(-x, -y, z);
