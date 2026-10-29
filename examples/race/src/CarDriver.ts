import { Vector3, type Group } from 'three';
import { Behaviour, Input, KeyCode, Mathf, findObjectOfType } from '@scenoco-three/core';
import { ArcadeCar } from './ArcadeCar.js';
import { RaceControl } from './RaceControl.js';
import { TrackPosition } from './TrackPosition.js';

/**
 * Who drives an `ArcadeCar`: the player — keys, a gamepad, or the page's stick and buttons — when
 * `human`, the spline otherwise.
 *
 * The spline driver looks a speed-dependent distance down the track, at its `lane`, and steers its
 * nose there; it reads how sharply the track bends further on and lifts off before the bend, to a
 * pace of `pace` of the car's top speed. The player gets the same steering as an assist (H to turn it
 * off): it fills in where the keys leave off, holding the line the car is on and bringing it back
 * from the grass — the keys always win.
 */
export class CarDriver extends Behaviour<Group> {
  human = false;
  /** Where on the road a spline driver keeps: metres left of the centre line, negative for right. */
  lane = 0;
  /** A spline driver's pace, as a share of its car's top speed on a straight. */
  pace = 0.9;
  /** How much the spline steers for the player, 0..1, while assisting. */
  assist = 0.65;
  assisting = true;

  private car!: ArcadeCar;
  private track!: TrackPosition;
  private race: RaceControl | null = null;
  private readonly target = new Vector3();
  private readonly here = new Vector3();
  private readonly there = new Vector3();

  override awake(): void {
    this.car = this.node.getComponent(ArcadeCar)!;
    this.track = this.node.getComponent(TrackPosition)!;
  }

  override start(): void {
    this.race = findObjectOfType(RaceControl);
  }

  override update(): void {
    if (this.human && (Input.getKeyDown(KeyCode.H) || Input.getButtonDown('Assist') || Input.getKeyDown(KeyCode.JoystickButton3))) {
      this.assisting = !this.assisting;
      console.info(`assist: ${this.assisting ? 'on' : 'off'}`);
    }
    if (this.race && !this.race.racing) {
      this.car.throttle = 0;
      this.car.steer = 0;
      return;
    }
    if (this.human) this.drive();
    else this.follow();
  }

  private drive(): void {
    // The keys, a gamepad's stick or d-pad, or the page's stick (`TouchStick`): all one axis.
    const keys = Input.getAxis('Horizontal');
    // Gas: up, the page's GAS, a pad's right trigger or A. Brake: down, BRAKE, the left trigger or B.
    const gas = button('Gas') || Input.getKey(KeyCode.JoystickButton7) || Input.getKey(KeyCode.JoystickButton0) ? 1 : 0;
    const brake = button('Brake') || Input.getKey(KeyCode.JoystickButton6) || Input.getKey(KeyCode.JoystickButton1) ? 1 : 0;
    this.car.throttle = Mathf.clamp(Input.getAxis('Vertical') + gas - brake, -1, 1);
    // The assist holds the line the car is on, kept to the asphalt, and gives way to the keys.
    const line = Mathf.clamp(this.track.offset, -3.5, 3.5);
    const help = this.assisting && this.car.speed > 2 ? this.assist * (1 - Math.abs(keys)) * this.steerToward(line) : 0;
    this.car.steer = Mathf.clamp(keys + help, -1, 1);
  }

  private follow(): void {
    this.car.steer = this.steerToward(this.lane);
    // Slower into a bend: how far the track turns between here and a little past where it looks.
    const speed = Math.max(0, this.car.speed);
    const now = this.track.directionAhead(0, this.here);
    const later = this.track.directionAhead(12 + speed * 0.5, this.there);
    const bend = Math.acos(Mathf.clamp(now.dot(later), -1, 1));
    const wanted = this.car.topSpeed * this.pace * (1 - Mathf.clamp(bend * 0.6, 0, 0.45));
    this.car.throttle = Mathf.clamp((wanted - speed) * 0.3, -1, 1);
  }

  /** The steer, -1..1, that points the nose at the track a little ahead, `side` metres left of centre. */
  private steerToward(side: number): number {
    const reach = 7 + Math.max(0, this.car.speed) * 0.45;
    const local = this.node.worldToLocal(this.track.ahead(reach, side, this.target));
    // + is to the car's left; steer + is right.
    return Mathf.clamp(-Math.atan2(local.x, local.z) * 2.2, -1, 1);
  }
}

/** A page button held: 1, else 0. */
function button(name: string): number {
  return Input.getButton(name) ? 1 : 0;
}
