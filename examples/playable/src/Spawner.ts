import { Vector3 } from 'three';
import { Component, Time, type PrefabType } from '@scenoco-three/core';
import { Round } from './Round.js';

/**
 * Drops a prefab at intervals, across a width.
 *
 * The thing it spawns is a field, not an import: `spawns="target.prefab.xml"` on the element.
 * That is what a `PrefabType` field is for, and it is what keeps repetition in a component
 * without the document having to name the same prefab thirty times.
 */
export class Spawner extends Component {
  /** What to drop. Authored as a path: `spawns="target.prefab.xml"`. */
  spawns!: PrefabType;

  /** Seconds between drops at the start, and at the end of the round. */
  interval = 0.9;
  finalInterval = 0.45;
  /** How far either side of this node they appear. */
  spread = 3.4;

  private next = 0;
  private round!: Round;

  override awake(): void {
    this.round = this.requireSystem(Round);
  }

  override update(): void {
    if (this.round.phase !== 'playing') return;
    this.next -= Time.deltaTime;
    if (this.next > 0) return;

    // Tighten as the clock runs down, so the last seconds are the busy ones.
    const through = this.round.duration <= 0 ? 1 : 1 - this.round.remaining / this.round.duration;
    this.next = this.interval + (this.finalInterval - this.interval) * through;

    this.object3D.instantiate(this.spawns, {
      position: new Vector3((Math.random() * 2 - 1) * this.spread, 0, 0),
    });
  }
}
