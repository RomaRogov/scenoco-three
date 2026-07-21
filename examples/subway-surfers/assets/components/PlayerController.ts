import { Vector3, type Object3D } from 'three';
import { Component, component, property, PrefabAsset, ValueType } from '@scenoco-three/core';
import { Tween } from '@scenoco-three/animation';
import { Hud } from './Hud.js';
import { Obstacle } from './Obstacle.js';
import { Coin } from './Coin.js';

type RunState = 'run' | 'jump' | 'slide';

/**
 * Lane-runner control: tweened lane switching, a hand-tuned jump arc (gravity +
 * impulse, not a fixed-duration tween — a jump should feel responsive, not
 * eased), a timed slide, forward auto-run with a difficulty ramp, and the
 * win/lose reactions on contact (coin pickup / obstacle survival check).
 *
 * `-Z` is forward — the direction Three.js's default (unrotated) camera already
 * looks, so the chase camera (a child of this node, see the scene) needs no yaw.
 *
 * References: this holds a typed ref to `Hud` (one direction only — Hud never
 * references the player back) and looks up `Obstacle`/`Coin` via
 * `other.getComponent(...)` inside `onTriggerEnter` (a method body — lazy,
 * import-order-safe). See `@scenoco-three/core`'s README for why that split
 * matters (a typed `@property({ type })` ref is captured eagerly, at
 * class-definition time — a method-body lookup isn't).
 */
@component({
  name: 'PlayerController',
  description: 'Lane-runner control: tweened lane switch, jump/slide, forward auto-run with difficulty ramp, coin/obstacle reactions.',
})
export class PlayerController extends Component {
  @property({ type: [ValueType.Float], description: 'World X position of each lane, left to right' })
  lanes: number[] = [-2.4, 0, 2.4];
  @property({ type: ValueType.Float, description: 'Starting forward speed, world units/sec (-Z is forward)' })
  forwardSpeed = 9;
  @property({ type: ValueType.Float, description: 'Speed cap the difficulty ramp approaches' })
  maxSpeed = 22;
  @property({ type: ValueType.Float, description: 'How fast speed ramps toward maxSpeed, units/sec of speed per sec' })
  rampRate = 0.14;
  @property({ type: ValueType.Float, description: 'Upward jump velocity impulse' })
  jumpImpulse = 8.2;
  @property({ type: ValueType.Float, description: 'Gravity applied while airborne' })
  gravity = 26;
  @property({ type: ValueType.Float, description: 'Seconds spent sliding per slide' })
  slideDuration = 0.55;
  @property({ type: ValueType.Float, description: 'Seconds a lane change tween takes' })
  laneChangeDuration = 0.16;
  @property({ type: ValueType.Float, description: 'Collider/body center height above ground' })
  standHeight = 0.9;

  @property({ type: Hud, description: 'HUD to report score/coins/game-over to' })
  hud: Hud | null = null;
  @property({ type: ValueType.Node, description: 'Visual body root — leaned/squashed/stretched for turn/slide/jump feel' })
  body: Object3D | null = null;
  @property({ type: ValueType.Prefab, description: 'One-shot sparkle burst spawned at a collected coin' })
  sparkleFx: PrefabAsset | null = null;
  @property({ type: ValueType.Prefab, description: 'One-shot burst spawned at the player on a crash' })
  crashFx: PrefabAsset | null = null;

  private lane = 1; // index into `lanes`
  private laneX = 0;
  private laneTween?: Tween;
  private lean = 0;
  private bodyScaleY = 1;
  private state: RunState = 'run';
  private jumpVel = 0;
  private jumpY = 0;
  private slideT = 0;
  private elapsed = 0;
  private distance = 0;
  private coins = 0;
  private over = false;

  override onLoad(): void {
    this.laneX = this.lanes[this.lane] ?? 0;
    this.node.position.set(this.laneX, this.standHeight, 0);
  }

  override update(dt: number): void {
    if (this.over) return;
    this.elapsed += dt;
    this.readInput();
    this.laneTween?.update(dt);
    this.stepVertical(dt);

    const speed = Math.min(this.maxSpeed, this.forwardSpeed + this.elapsed * this.rampRate);
    this.distance += speed * dt;
    this.node.position.set(this.laneX, this.standHeight + this.jumpY, -this.distance);

    this.animateBody(dt);
    this.hud?.setScore(Math.floor(this.distance));
  }

  private stepVertical(dt: number): void {
    if (this.state === 'jump') {
      this.jumpVel -= this.gravity * dt;
      this.jumpY += this.jumpVel * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.jumpVel = 0;
        this.state = 'run';
      }
    } else if (this.state === 'slide') {
      this.slideT -= dt;
      if (this.slideT <= 0) this.state = 'run';
    }
  }

  private readInput(): void {
    if (this.state !== 'run') return; // no lane/jump/slide changes mid-jump or mid-slide
    const input = this.engine.input;
    if (input.getKeyDown('A') || input.getKeyDown('LeftArrow')) this.changeLane(-1);
    if (input.getKeyDown('D') || input.getKeyDown('RightArrow')) this.changeLane(1);
    if (input.getKeyDown('W') || input.getKeyDown('UpArrow') || input.getKeyDown('Space')) this.jump();
    if (input.getKeyDown('S') || input.getKeyDown('DownArrow')) this.slide();
  }

  private changeLane(dir: -1 | 1): void {
    const next = Math.max(0, Math.min(this.lanes.length - 1, this.lane + dir));
    if (next === this.lane) return;
    this.lane = next;
    this.lean = -dir * 0.32; // bank into the turn; animateBody decays it back to 0
    const target = this.lanes[this.lane] ?? 0;
    this.laneTween = new Tween([this.laneX], [target], (v) => (this.laneX = v[0] ?? target), {
      duration: this.laneChangeDuration,
      easing: 'quadOut',
    });
  }

  private jump(): void {
    this.state = 'jump';
    this.jumpVel = this.jumpImpulse;
  }

  private slide(): void {
    this.state = 'slide';
    this.slideT = this.slideDuration;
  }

  /** Cosmetic feedback only — never touches gameplay state. */
  private animateBody(dt: number): void {
    if (!this.body) return;
    this.lean += (0 - this.lean) * Math.min(1, dt * 6);
    this.body.rotation.z = this.lean;
    const targetScaleY = this.state === 'slide' ? 0.5 : this.state === 'jump' ? 1.12 : 1;
    this.bodyScaleY += (targetScaleY - this.bodyScaleY) * Math.min(1, dt * 10);
    this.body.scale.y = this.bodyScaleY;
  }

  /** Collision package hook — every collider here is a sensor, so this is the only one needed. */
  onTriggerEnter(other: Object3D): void {
    if (this.over) return;
    const coin = other.getComponent(Coin);
    if (coin) {
      this.collectCoin(other, coin.value);
      return;
    }
    const obstacle = other.getComponent(Obstacle);
    if (!obstacle) return;
    const survives =
      (obstacle.kind === 'jump' && this.state === 'jump') || (obstacle.kind === 'duck' && this.state === 'slide');
    if (!survives) this.crash();
  }

  private collectCoin(coinNode: Object3D, value: number): void {
    this.coins += value / 10;
    this.hud?.setCoins(this.coins);
    this.sparkleFx?.spawn({ parent: this.engine.scene, position: coinNode.getWorldPosition(new Vector3()) });
    this.engine.destroy(coinNode);
  }

  private crash(): void {
    this.over = true;
    this.crashFx?.spawn({ parent: this.engine.scene, position: this.node.position.clone() });
    this.hud?.gameOver(Math.floor(this.distance), this.coins);
  }
}
