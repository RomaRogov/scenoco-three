import type { Object3D } from 'three';
import { Component } from '@scenoco-three/core';
// Side-effect import: the package merges its contact hooks onto `Component`.
import '@scenoco-three/collision';
import { Carrier } from './Carrier.js';
import { Run } from './Run.js';

/**
 * Where the stack is delivered. Walk into it carrying anything and it all counts.
 *
 * The crates are destroyed rather than parked: a delivered crate has no further part to play, and
 * `destroy()` is deferred to the end of the tick, so this is safe to call from inside a contact
 * hook while the collision system is still walking its pairs.
 */
export class Depot extends Component {
  private run!: Run;

  override awake(): void {
    this.run = this.requireSystem(Run);
  }

  override onTriggerEnter(other: Object3D): void {
    const carrier = other.getComponent(Carrier);
    if (!carrier || carrier.count === 0) return;
    for (const crate of carrier.drain()) {
      this.run.deliver(1);
      crate.destroy();
    }
  }
}
