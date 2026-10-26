import { Quaternion, Vector2, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { Behaviour, Input, Time, destroy, instantiate, type Prefab, type Yieldable } from '@scenoco-three/core';
import { Collider, Rigidbody, type Collision } from '@scenoco-three/rapier';
import { LevelController } from './LevelController';
import { Nest, Stone } from './markers';
import { ModelView } from './ModelView';
import { MusicController } from './MusicController';
import { TerrainMesh } from './TerrainMesh';
import { UIController } from './UIController';
import { Ease, hop, punch, tween } from './tween';
import { unityEuler, unityTorque } from './unity';

/**
 * The egg — the Unity game's `EggController`. Drag (or the arrow keys) to roll it; a hard landing
 * or a stone breaks it; the nest at the bottom wins the level. The camera's container follows it
 * along the slope.
 */
export class EggController extends Behaviour {
  camContainer: Object3D | null = null;
  topPart: Prefab | null = null;
  bottomPart: Prefab | null = null;
  fried: Prefab | null = null;

  private static instance: EggController;
  private rb!: Rigidbody;
  private speed = new Vector2();
  private prevMousePos = new Vector2();
  private isDead = false;
  private gameStarted = false;
  private camTrans!: PerspectiveCamera;
  private camRot = new Quaternion();
  /** Contacts going on now: the rolling sound plays while there are any. */
  private touching = 0;

  static startGame(): void {
    const self = EggController.instance;
    self.rb.isKinematic = false;
    self.gameStarted = true;
    // DORotate(camRot, .5f).SetEase(Ease.OutBack)
    const cam = self.camTrans;
    const from = cam.quaternion.clone();
    self.startCoroutine(tween(0.5, Ease.outBack, (t) => cam.quaternion.slerpQuaternions(from, self.camRot, t)));
  }

  override start() {
    EggController.instance = this;
    this.rb = this.getComponent(Rigidbody)!;
    // Further down the slope on the early levels.
    this.node.position.x += 3 * (1 - LevelController.hardness);
    this.node.position.copy(TerrainMesh.groundBelow(this.node.position));
    this.rb.isKinematic = true;
    this.camTrans = this.camContainer!.children[0] as PerspectiveCamera;
    this.camRot.copy(this.camTrans.quaternion);
    this.camContainer!.position.copy(TerrainMesh.getPoint(this.node.position));
  }

  override fixedUpdate() {
    if (this.isDead) return;
    // Unity scaled the drag by the screen's width over 400: a phone's width of drag is the same push anywhere.
    const scale = window.innerWidth / 400;
    const rb = this.rb;
    rb.addTorque(unityTorque(this.speed.x * scale * 20, 0, 0));
    rb.addTorque(unityTorque(0, 0, Math.min(this.speed.y * scale, 0) * 20));
    rb.addTorque(unityTorque(Input.getAxis('Horizontal') * 20, 0, 0));
    rb.addTorque(unityTorque(0, 0, Math.min(Input.getAxis('Vertical'), 0) * 20));
    // OnCollisionStay's rolling sound: as loud as it is rolling, while it touches anything.
    if (this.touching > 0) MusicController.setRollingVol(rb.angularVelocity.length() / 7);
  }

  override update() {
    const target = TerrainMesh.getPoint(this.node.position);
    if (!this.gameStarted) {
      target.y += Math.sin(Time.time) / 2;
      this.camTrans.lookAt(this.node.position);
    }
    this.camContainer!.position.lerp(target, Math.min(Time.deltaTime * 10, 1));
    if (this.isDead) return;

    // Unity's mousePosition counts y up the screen; the page's counts down.
    const mouse = new Vector2(Input.mousePosition.x, -Input.mousePosition.y);
    if (Input.getMouseButtonDown()) this.prevMousePos.copy(mouse);
    if (Input.getMouseButton()) this.speed.copy(mouse).sub(this.prevMousePos);
    else this.speed.set(0, 0);
    this.prevMousePos.copy(mouse);
  }

  override onTriggerEnter(other: Collider) {
    if (this.isDead || !other.getComponentInParent(Nest)) return;
    this.isDead = true;
    destroy(this.rb);
    MusicController.gameOver(false);
    this.startCoroutine(this.win(other.node));
  }

  override onCollisionEnter(other: Collision) {
    this.touching++;
    if (!this.isDead && (other.impulse.length() > 3.5 || other.node.getComponentInParent(Stone))) this.crash();
    MusicController.setRollingVol(other.impulse.length() / 5);
  }

  override onCollisionExit() {
    this.touching = Math.max(0, this.touching - 1);
  }

  /** Into the nest: a hop there, a flip, a bump; then the level is won. */
  private *win(nest: Object3D): Generator<Yieldable> {
    const node = this.node;
    const from = node.position.clone();
    const to = node.parent!.worldToLocal(nest.getWorldPosition(new Vector3()));
    const tilt = unityEuler(15, 0, 0);
    const start = node.quaternion.clone();
    // DOLocalRotate(right * 15, .5) OutBack, then (15, 720, 0) over .6 InSine, then back to zero in .2.
    this.startCoroutine(
      (function* (): Generator<Yieldable> {
        yield* tween(0.5, Ease.outBack, (t) => node.quaternion.slerpQuaternions(start, tilt, t));
        yield* tween(0.6, Ease.inSine, (t) => node.quaternion.copy(unityEuler(15, 720 * t, 0)));
        const end = node.quaternion.clone();
        yield* tween(0.2, Ease.linear, (t) => node.quaternion.slerpQuaternions(end, new Quaternion(), t));
      })(),
    );
    // DOJump(nest, 1f, 1, .7f) InCirc
    yield* tween(0.7, Ease.inCirc, (t) => node.position.lerpVectors(from, to, t).y += hop(t, 1));
    LevelController.gameWon();
    yield* tween(0.5, Ease.linear, (t) => node.position.copy(to).y -= 0.3 * punch(t));
    UIController.gameOver(false);
  }

  /** Cracked: the shell falls in two, a fried egg spreads where it lay. */
  private crash() {
    this.isDead = true;
    const node = this.node;
    destroy(this.rb);
    destroy(this.getComponent(Collider)!);
    const view = this.getComponent(ModelView)!.view!;
    view.visible = false;
    const pose = { position: node.getWorldPosition(new Vector3()), quaternion: node.getWorldQuaternion(new Quaternion()) };
    for (const part of [this.topPart!, this.bottomPart!]) instantiate(part, pose);
    // The fried egg lies on the slope under it, as Unity's settled there, growing from a tenth of its size.
    const ground = TerrainMesh.groundBelow(pose.position.clone().add(new Vector3(0, 0.5, 0)));
    const fried = instantiate(this.fried!, { position: ground, quaternion: TerrainMesh.tilt });
    fried.scale.setScalar(0.1);
    this.startCoroutine(this.spread(fried));
    MusicController.gameOver(true);
  }

  private *spread(fried: Object3D): Generator<Yieldable> {
    yield* tween(3, Ease.outExpo, (t) => fried.scale.setScalar(0.1 + 0.9 * t));
    UIController.gameOver(true);
  }
}
