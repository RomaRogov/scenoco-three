import { Vector3, type Group, type Object3D } from 'three';
import { Behaviour, Mathf, findObjectOfType } from '@scenoco-three/core';
import { Rigidbody } from '@scenoco-three/rapier';
import { Terrain } from '@scenoco-three/terrain';
import { TrackPosition } from './TrackPosition.js';

/** The road piece's cross-section: asphalt and kerbs flat, then the shoulder down to the ground. */
const KERB_EDGE = 5.9;
const SHOULDER_EDGE = 8.2;
/** The wheels' radius in the model, for how fast they spin. */
const WHEEL_RADIUS = 0.36;

/**
 * An arcade car: Rapier moves it and resolves it bumping the other cars, but how it drives is this
 * — set straight on the body's velocity every physics step, the way arcade racers do, rather than
 * from tyres and torque.
 *
 * - Along its nose it speeds up toward `topSpeed` under `throttle`, brakes and reverses under a
 *   negative one, and rolls to a stop without either.
 * - Across, it keeps only a little of its sideways slide each step (`grip`): high grip carves, low
 *   grip drifts.
 * - It turns at `turnRate` with `steer`, scaled by speed — a parked car does not turn.
 * - Off the asphalt, on the grass, it is slower and loses speed.
 * - It rides on the road's surface — the spline's height, from `TrackPosition` — and past the
 *   shoulder on the terrain's: no wheels to catch on the kerb, so the body only ever turns about its
 *   up axis.
 *
 * `throttle` and `steer`, -1..1, are what a driver sets: a player's keys, or the spline (`CarDriver`).
 * `body` and the wheels are what is seen: it leans in a turn, they spin, and the front two steer.
 * `CarModel` hands them over from the model.
 */
export class ArcadeCar extends Behaviour<Group> {
  /** Metres per second at full throttle on the asphalt. */
  topSpeed = 34;
  /** Metres per second gained each second. */
  acceleration = 14;
  braking = 28;
  reverseSpeed = 8;
  /** Speed lost each second with neither pedal down, as a share of it. */
  rolling = 0.35;
  /** Radians a second at full steer, once moving faster than `fullTurnSpeed`. */
  turnRate = 1.7;
  fullTurnSpeed = 9;
  /** How fast a sideways slide is scrubbed off: per second. 10 grips; 2 drifts. */
  grip = 7;
  /** On the grass: the top speed, as a share of `topSpeed`, and extra speed lost each second. */
  grassTopSpeed = 0.45;
  grassDrag = 0.9;
  /** The chassis, leaning into a turn, and the front wheels, steering. */
  body: Object3D | null = null;
  frontLeft: Object3D | null = null;
  frontRight: Object3D | null = null;
  wheels: Object3D[] = [];

  /** -1..1: what the driver asks for this frame. */
  throttle = 0;
  steer = 0;

  private rb!: Rigidbody;
  private track!: TrackPosition;
  private readonly forward = new Vector3();
  private readonly side = new Vector3();
  private readonly velocity = new Vector3();
  private lean = 0;
  private terrain: Terrain | null = null;
  private readonly probe = new Vector3();

  override awake(): void {
    this.rb = this.node.getComponent(Rigidbody)!;
    this.track = this.node.getComponent(TrackPosition)!;
    this.terrain = findObjectOfType(Terrain);
  }

  /** Metres per second along its nose: negative in reverse. */
  get speed(): number {
    return this.rb.velocity.dot(this.node.getWorldDirection(this.forward));
  }

  /** On the grass, past the shoulder. */
  get offRoad(): boolean {
    return Math.abs(this.track.offset) > KERB_EDGE;
  }

  override fixedUpdate(dt: number): void {
    const forward = this.node.getWorldDirection(this.forward);
    const side = this.side.set(forward.z, 0, -forward.x);
    const v = this.rb.velocity;
    let along = v.dot(forward);
    let across = v.dot(side);

    const top = this.offRoad ? this.topSpeed * this.grassTopSpeed : this.topSpeed;
    const throttle = Mathf.clamp(this.throttle, -1, 1);
    if (throttle > 0) along = along < 0 ? along + this.braking * throttle * dt : Math.min(top, along + this.acceleration * throttle * dt);
    else if (throttle < 0) along = along > 0 ? along + this.braking * throttle * dt : Math.max(-this.reverseSpeed, along + this.acceleration * throttle * dt);
    else along *= Math.exp(-this.rolling * dt);
    if (this.offRoad) along *= Math.exp(-this.grassDrag * dt);
    // Over the top speed — the grass after the asphalt — it sheds the extra quickly, not at once.
    if (along > top) along = Mathf.lerp(along, top, 1 - Math.exp(-3 * dt));
    across *= Math.exp(-this.grip * dt);

    // Up and down: onto the road's surface wherever it is under the car.
    const climb = (this.surfaceHeight() - this.node.position.y) * 12;
    this.rb.velocity = this.velocity.copy(forward).multiplyScalar(along).addScaledVector(side, across).setY(climb);

    // A turn needs speed, and reverses with it, as a car's does.
    const grip = Mathf.clamp01(Math.abs(along) / this.fullTurnSpeed) * Math.sign(along);
    this.rb.angularVelocity = new Vector3(0, -Mathf.clamp(this.steer, -1, 1) * this.turnRate * grip, 0);
  }

  override update(dt: number): void {
    // The chassis leans out of the turn, by how hard it is turning at speed; the wheels show the steer.
    const want = -this.rb.angularVelocity.y * Mathf.clamp01(Math.abs(this.speed) / this.topSpeed) * 0.09;
    this.lean = Mathf.lerp(this.lean, want, 1 - Math.exp(-8 * dt));
    if (this.body) this.body.rotation.z = this.lean;
    // Spin about the axle first, then steer: Y after X.
    const roll = (this.speed / WHEEL_RADIUS) * dt;
    for (const wheel of this.wheels) {
      wheel.rotation.order = 'YXZ';
      wheel.rotation.x += roll;
    }
    const steer = -Mathf.clamp(this.steer, -1, 1) * 0.45;
    if (this.frontLeft) this.frontLeft.rotation.y = steer;
    if (this.frontRight) this.frontRight.rotation.y = steer;
  }

  /** The height under the car: the road's surface, then across the shoulder down onto the terrain. */
  private surfaceHeight(): number {
    const d = Math.abs(this.track.offset);
    const road = this.track.height;
    if (d <= KERB_EDGE || !this.terrain) return road;
    const ground = this.terrain.sampleHeight(this.node.getWorldPosition(this.probe)) + this.terrain.node.position.y;
    if (d >= SHOULDER_EDGE) return ground;
    return Mathf.lerp(road, ground, (d - KERB_EDGE) / (SHOULDER_EDGE - KERB_EDGE));
  }
}
