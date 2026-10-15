import { Quaternion, Vector3 } from 'three';
import { Behaviour } from '@scenoco-three/core';
import { Rigidbody } from '@scenoco-three/rapier';

/** A letter dragged off the edge drops back in from where it first fell. */
export class Respawn extends Behaviour {
  /** Below this height it has left the ground for good. */
  floor = -12;

  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();

  override awake() {
    this.position.copy(this.node.position);
    this.rotation.copy(this.node.quaternion);
  }

  override update() {
    const body = this.getComponent(Rigidbody);
    if (!body || body.isKinematic || this.node.position.y > this.floor) return;
    body.movePosition(this.position);
    body.moveRotation(this.rotation);
    body.velocity = new Vector3();
    body.angularVelocity = new Vector3();
  }
}
