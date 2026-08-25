import { BoxShape, type Shape } from 'planck';
import { Vector2 } from 'three';
import { Collider2D } from './Collider2D.js';

/** A 2D box collision shape. */
export class BoxCollider2D extends Collider2D {
  /**
   * Half the box's size — half the *visible* size, if it is meant to match the mesh.
   *
   * A collider never infers its size from the geometry beside it. The two are separate assets
   * now, and a collider that guessed would be wrong the moment either changed.
   */
  halfExtents = new Vector2(0.5, 0.5);

  override toShape(): Shape {
    return new BoxShape(this.halfExtents.x, this.halfExtents.y);
  }
}
