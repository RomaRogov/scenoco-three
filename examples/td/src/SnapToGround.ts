import { Vector3 } from 'three';
import { Behaviour, findObjectOfType } from '@scenoco-three/core';
import { Terrain } from '@scenoco-three/terrain';
import { groundAt, groundUnder } from './ground';

/** Seats its node on the terrain once, at start: on the highest ground within `radius`, plus `offset`. */
export class SnapToGround extends Behaviour {
  radius = 0;
  offset = 0;

  override start() {
    this.snap();
  }

  /** `radius` or `offset` changed in the editor: seated again. */
  override onValidate() {
    this.snap();
  }

  private snap() {
    const terrain = findObjectOfType(Terrain);
    if (!terrain) return;
    const world = this.node.getWorldPosition(new Vector3());
    world.y = (this.radius > 0 ? groundUnder(terrain, world.x, world.z, this.radius) : groundAt(terrain, world.x, world.z)) + this.offset;
    this.node.position.copy(this.node.parent ? this.node.parent.worldToLocal(world) : world);
  }
}
