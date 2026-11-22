import { Raycaster, Vector3 } from 'three';
import { Behaviour, Ease, Input, Tween, destroy, instantiate, type Prefab } from '@scenoco-three/core';
import { ForceMode, Physics } from '@scenoco-three/rapier';

/**
 * A click shoves whatever body is under the pointer: a ray from the camera through the pointer —
 * `Physics.Raycast` — and an impulse at once, `ForceMode.Impulse`, away from the camera and a little up.
 */
export class Shove extends Behaviour {
  /** Newton-seconds: a crate of 1 kg leaves at this many metres a second. */
  strength = 6;
  /** Left where the ray hit, whether or not it hit a body. */
  mark: Prefab | null = null;

  private readonly ray = new Raycaster();

  override update() {
    if (!Input.getMouseButtonDown()) return;
    this.ray.setFromCamera(Input.pointer, this.camera);
    const hit = Physics.raycast(this.ray.ray, 60);
    if (!hit) return;
    if (this.mark) {
      // A ring that pops open where the ray hit and shrinks away.
      const mark = instantiate(this.mark, { position: hit.point.clone().addScaledVector(hit.normal, 0.02) });
      mark.lookAt(mark.position.clone().add(hit.normal));
      mark.scale.setScalar(0);
      Tween.sequence()
        .append(mark.doScale(1, 0.25).setEase(Ease.OutBack))
        .appendInterval(0.4)
        .append(mark.doScale(0, 0.3).setEase(Ease.InQuad))
        .onComplete(() => destroy(mark))
        .setLink(mark);
    }
    const body = hit.rigidbody;
    if (!body || body.isKinematic) return;
    const push = this.ray.ray.direction.clone().setY(0).normalize().add(new Vector3(0, 0.5, 0)).multiplyScalar(this.strength);
    body.addForce(push, ForceMode.Impulse);
  }
}
