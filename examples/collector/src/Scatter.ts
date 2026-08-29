import { Vector3 } from 'three';
import { Component, type PrefabType } from '@scenoco-three/core';

/**
 * Lays the crates out across the level, and puts a new one down as they are collected.
 *
 * A level of loot is a loop, not thirty elements: the prefab is a field, so the document says
 * *what* to scatter and this says *where*. Keeping the count topped up is what stops the last ten
 * seconds of a run being a walk across an empty field.
 */
export class Scatter extends Component {
  /** What to scatter. Authored as a path: `crate="crate.prefab.xml"`. */
  crate!: PrefabType;

  /** How many to keep on the level. */
  count = 14;
  /** Half the area they land in. */
  area = new Vector3(7, 0, 7);
  /** Nothing spawns this close to the middle, where the depot is. */
  clearance = 2.5;
  /**
   * How high a crate rests.
   *
   * The scatter names it rather than leaving it to the prefab, because a placement passed to
   * `instantiate` replaces the prefab's own — all three axes of it. Saying only x and z would
   * bury every crate at y = 0.
   */
  height = 0.2;

  override start(): void {
    this.top();
  }

  override update(): void {
    this.top();
  }

  private top(): void {
    while (this.object3D.children.length < this.count) {
      this.object3D.instantiate(this.crate, { position: this.somewhere() });
    }
  }

  private somewhere(): Vector3 {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = (Math.random() * 2 - 1) * this.area.x;
      const z = (Math.random() * 2 - 1) * this.area.z;
      if (Math.hypot(x, z) > this.clearance) return new Vector3(x, this.height, z);
    }
    return new Vector3(this.area.x, this.height, this.area.z);
  }
}
