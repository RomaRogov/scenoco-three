import type { Object3D } from 'three';
import { Component } from '@scenoco-three/core';
// Imported for its side effect as well as its type: the package merges its contact hooks onto
// `Component`, and without the import `onTriggerEnter` is not a member to override.
import { Collider } from '@scenoco-three/collision';
import { Carrier } from './Carrier.js';

/**
 * A crate lying on the level. Walk over it and it joins the stack.
 *
 * The collider is a sensor, so this is `onTriggerEnter` — the detection-only back-end, because a
 * pickup needs to know it was touched and nothing needs to bounce off it.
 */
export class Pickup extends Component {
  /** What it is worth when it reaches the depot. */
  value = 1;
  /** Spins on the spot until collected, so it reads as loot. */
  spin = 60;

  private taken = false;

  override update(dt: number): void {
    if (this.taken) return;
    this.object3D.rotation.y += (this.spin * Math.PI) / 180 * dt;
  }

  override onTriggerEnter(other: Object3D): void {
    if (this.taken) return;
    const carrier = other.getComponent(Carrier);
    if (!carrier || !carrier.take(this.object3D)) return;
    this.taken = true;
    // The collider has done its job. Leaving it on would keep the depot's sensor reporting a
    // crate that is already somebody's cargo, and every other pickup testing against it.
    const collider = this.object3D.getComponent(Collider);
    if (collider) collider.enabled = false;
  }
}
