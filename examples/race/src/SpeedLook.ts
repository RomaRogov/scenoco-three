import { Vector3 } from 'three';
import { Behaviour, Ease, Mathf, Tween, WaitUntil, findObjectOfType, findObjectsOfType } from '@scenoco-three/core';
import { ChromaticAberration, DepthOfField, Vignette } from '@scenoco-three/postprocessing';
import { ArcadeCar } from './ArcadeCar';
import { CarDriver } from './CarDriver';
import { RaceControl } from './RaceControl';

/**
 * The lens, as the race goes: on the grid the player's car is sharp and the world behind it soft; at GO
 * the blur pulls away; flat out, the corners darken and the edges fringe with colour; at the finish the
 * blur comes back. It sets the Volume's effects on this node — every field is read each frame, so a
 * value set in `update` and a tween are the same to them.
 */
export class SpeedLook extends Behaviour {
  /** The vignette added at top speed, over the one the scene set. */
  vignetteAtSpeed = 0.3;
  /** The colour fringes at top speed. */
  fringeAtSpeed = 0.35;

  private car: ArcadeCar | null = null;
  private restVignette = 0;
  private readonly eye = new Vector3();
  private readonly target = new Vector3();

  override start() {
    this.car = findObjectsOfType(CarDriver).find((d) => d.human)?.getComponent(ArcadeCar) ?? null;
    this.restVignette = this.getComponent(Vignette)?.intensity ?? 0;
    this.startCoroutine(this.lens());
  }

  override update() {
    const car = this.car;
    if (!car) return;
    // Squared, so it creeps in near the top of the speed range rather than all the way up.
    const share = Mathf.clamp01(Math.abs(car.speed) / car.topSpeed) ** 2;
    const vignette = this.getComponent(Vignette);
    if (vignette) vignette.intensity = this.restVignette + share * this.vignetteAtSpeed;
    const fringe = this.getComponent(ChromaticAberration);
    if (fringe) fringe.intensity = share * this.fringeAtSpeed;
    // The lens holds the player's car in focus, wherever the chase camera puts it.
    const dof = this.getComponent(DepthOfField);
    if (dof?.enabled) dof.focusDistance = this.camera.getWorldPosition(this.eye).distanceTo(car.node.getWorldPosition(this.target));
  }

  /** The depth of field's part: soft on the grid, sharp at GO, soft again at the line — then off, as it costs a pass. */
  private *lens() {
    const race = findObjectOfType(RaceControl);
    const dof = this.getComponent(DepthOfField);
    if (!race || !dof) return;
    const aperture = (to: number, seconds: number) =>
      Tween.to(() => dof.aperture, (v) => (dof.aperture = v), to, seconds).setTarget(dof).setLink(this);
    dof.enabled = true;
    dof.aperture = 1.4;
    yield new WaitUntil(() => race.racing);
    yield aperture(22, 0.9).setEase(Ease.InCubic).waitForCompletion();
    dof.enabled = false;
    yield new WaitUntil(() => race.finished);
    dof.enabled = true;
    aperture(1.8, 1.5).setEase(Ease.OutCubic);
  }
}
