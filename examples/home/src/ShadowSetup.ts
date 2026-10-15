import { Behaviour } from '@scenoco-three/core';
import type { DirectionalLight } from 'three';

/** A shadow camera's bounds are set as props; its projection needs one refresh. */
export class ShadowSetup extends Behaviour<DirectionalLight> {
  override awake() {
    this.node.shadow.camera.updateProjectionMatrix();
  }
}
