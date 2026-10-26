import { Quaternion, Vector3, type Mesh, type MeshBasicMaterial } from 'three';
import { Behaviour, destroy, Time, type Yieldable } from '@scenoco-three/core';
import { Collider } from '@scenoco-three/rapier';
import { LevelController } from './LevelController';
import { MusicController } from './MusicController';
import { UIController } from './UIController';
import { Ease, tween } from './tween';

/** A star to collect — the Unity game's `StarController`: it spins, and on touch pops, fades and counts. */
export class StarController extends Behaviour<Mesh> {
  private destroyed = false;

  override update() {
    // transform.Rotate(Vector3.up): a degree a frame at Unity's 60.
    if (!this.destroyed) this.node.rotateY((-60 * Time.deltaTime * Math.PI) / 180);
  }

  override onTriggerEnter(_other: Collider) {
    if (this.destroyed) return;
    this.destroyed = true;
    destroy(this.getComponent(Collider)!);
    LevelController.starsCollected++;
    UIController.starsChanged();
    MusicController.playStar();
    this.startCoroutine(this.collect());
  }

  private *collect(): Generator<Yieldable> {
    const node = this.node;
    // Its own material from here, so its fade is its own.
    const material = (node.material as MeshBasicMaterial).clone();
    node.material = material;
    const from = node.quaternion.clone();
    // DORotate(Vector3.up * 90f, .2f): a quarter turn to its world 90 degrees.
    const to = node.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2));
    this.startCoroutine(tween(0.2, Ease.inSine, (t) => node.quaternion.slerpQuaternions(from, to, t)));
    this.startCoroutine(tween(0.3, Ease.inSine, (t) => (material.opacity = 1 - t), 0.1));
    yield* tween(0.3, Ease.inExpo, (t) => node.scale.setScalar(1 + t), 0.1);
    material.dispose();
    destroy(node.parent ?? node);
  }
}
