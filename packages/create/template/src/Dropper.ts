import { Behaviour, Input, instantiate } from '@scenoco-three/core';
import { Crate } from './scenes/prefabs';

/** Drops a crate where its node stands, on Space — Unity's 'Jump' button. */
export class Dropper extends Behaviour {
  update() {
    if (!Input.getButtonDown('Jump')) return;
    const { x, z } = this.node.position;
    instantiate(Crate, { position: [x, 0.25, z] });
  }
}
