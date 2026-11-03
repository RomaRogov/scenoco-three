import { Quaternion, Vector3, type Mesh, type MeshBasicMaterial } from 'three';
import { Behaviour, Ease, destroy, Time } from '@scenoco-three/core';
import { Collider } from '@scenoco-three/rapier';
import { LevelController } from './LevelController';
import { MusicController } from './MusicController';
import { UIController } from './UIController';

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
    this.collect();
  }

  private collect() {
    const node = this.node;
    // Its own material from here, so its fade is its own.
    const material = (node.material as MeshBasicMaterial).clone();
    node.material = material;
    // A quarter turn to its world 90 degrees.
    node.doRotateQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2), 0.2).setEase(Ease.InSine);
    material.doFade(0, 0.3).setEase(Ease.InSine).setDelay(0.1).setLink(node);
    node.doScale(2, 0.3).setEase(Ease.InExpo).setDelay(0.1).onComplete(() => {
      material.dispose();
      destroy(node.parent ?? node);
    });
  }
}
