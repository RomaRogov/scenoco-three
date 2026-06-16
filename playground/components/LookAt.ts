import { Vector3 } from 'three';
import type { Object3D } from 'three';
import { Component, component, property } from '@scenoco-three/core';

/**
 * Orients the host so its -Z axis points at a target Object3D — a typed
 * `node` reference, resolved from another node's name in XML.
 */
@component({ name: 'LookAt', description: 'Rotates the host to face a target Object3D each frame' })
export class LookAt extends Component {
  @property({ type: 'node', description: 'Node to face' })
  target: Object3D | null = null;

  private readonly worldPos = new Vector3();

  override update(): void {
    if (!this.target) return;
    this.target.getWorldPosition(this.worldPos);
    this.node.lookAt(this.worldPos);
  }
}
