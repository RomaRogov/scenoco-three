import { Behaviour, findObjectOfType } from '@scenoco-three/core';
import { SplineContainer } from '@scenoco-three/splines';
import { Terrain } from '@scenoco-three/terrain';
import { groundAt, groundUnder } from './ground';

/**
 * Puts its node on the level's path at `t` (0 the start, 1 the end), on the ground, facing along it:
 * the cave the enemies come out of, the castle they head for, a bridge over a stream.
 */
export class PlaceOnPath extends Behaviour {
  t = 0;
  /** Moved this far along the path's direction, after placing. */
  ahead = 0;
  /** Degrees added to the path's heading. */
  yaw = 0;
  /** Seated on the highest ground within this radius. */
  radius = 0;
  offset = 0;

  override start() {
    const path = findObjectOfType(SplineContainer);
    const terrain = findObjectOfType(Terrain);
    if (!path || !terrain) return;
    const at = path.evaluatePosition(this.t);
    const forward = path.evaluateTangent(this.t);
    forward.y = 0;
    forward.normalize();
    at.addScaledVector(forward, this.ahead);
    at.y = (this.radius > 0 ? groundUnder(terrain, at.x, at.z, this.radius) : groundAt(terrain, at.x, at.z)) + this.offset;
    this.node.position.copy(this.node.parent ? this.node.parent.worldToLocal(at) : at);
    this.node.rotation.y = Math.atan2(forward.x, forward.z) + (this.yaw * Math.PI) / 180;
  }
}
