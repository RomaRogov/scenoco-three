import { Vector3, type Camera, type Group, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import {
  Behaviour, Ease, Input, Mathf, MouseButton, Time, Tween, WaitForSeconds, findObjectOfType, instantiate, type Prefab,
} from '@scenoco-three/core';
import type { Bonus } from './bonus.js';
import { GameState } from './GameState.js';

type Timed = Exclude<Bonus, 'none' | 'multi'>;

/** A bonus running on the paddle, as the HUD draws it. */
export interface Effect {
  bonus: Timed;
  left: number;
  total: number;
}

const SECONDS: Record<Timed, number> = { laser: 9, wide: 14, slim: 14 };
const GLOW = 1.2;

/**
 * The paddle: follows the mouse, a finger or the keys — whichever moved last — and wears the bonuses it
 * catches. Its node is the physics body (`scale.x` is its width); `body` is what is seen, so its lean,
 * squash and flare never touch the collider.
 */
export class Paddle extends Behaviour<Group> {
  /** Units a second, for the keys. */
  speed = 18;
  /** The side walls' inner faces. */
  wall = 9.2;
  halfWidth = 1.6;
  body: Mesh | null = null;
  /** Shown while the laser lasts. */
  cannons: Object3D | null = null;
  bolt: Prefab | null = null;
  fireEvery = 0.24;
  wideScale = 1.55;
  slimScale = 0.62;

  private game!: GameState;
  /** Each running bonus, and the game time it ends at. */
  private readonly ends = new Map<Timed, number>();
  private pointing = false;
  private lastX = 0;
  private lean = 0;
  private readonly point = new Vector3();
  private readonly eye = new Vector3();

  override awake(): void {
    this.game = findObjectOfType(GameState)!;
    // A lost ball ends what the rally earned.
    this.listen(this.game.ballReset, () => {
      this.ends.clear();
      this.refit();
    });
  }

  override start(): void {
    this.lastX = this.node.position.x;
  }

  override update(dt: number): void {
    this.move(dt);
    this.leanInto(dt);
    const ended = [...this.ends].filter(([, at]) => at <= Time.time);
    for (const [bonus] of ended) this.ends.delete(bonus);
    if (ended.length) this.refit();
  }

  /** The ball came down on it: a squash that springs back, and a flash. */
  struck(): void {
    this.body?.doComplete();
    this.body?.doPunchScale(new Vector3(0.12, -0.3, 0), 0.3, 4, 0.6);
    this.flash(1, 0.22);
  }

  catch(bonus: Exclude<Bonus, 'none'>): void {
    this.flash(3, 0.5);
    this.game.sfx?.play(bonus === 'multi' ? 'multi' : 'catch');
    if (bonus === 'multi') return this.game.multiply();
    // Wide and slim undo each other; catching one again starts its time over.
    if (bonus !== 'laser') this.ends.delete(bonus === 'wide' ? 'slim' : 'wide');
    if (bonus === 'laser' && !this.ends.has('laser')) this.startCoroutine(this.fire());
    this.ends.set(bonus, Time.time + SECONDS[bonus]);
    this.refit();
  }

  get running(): Effect[] {
    return [...this.ends].map(([bonus, at]) => ({ bonus, left: at - Time.time, total: SECONDS[bonus] }));
  }

  private move(dt: number): void {
    const keys = Input.getAxisRaw('Horizontal'); // raw: it stops the instant the key comes up
    // A mouse moves with no button held, a finger only while it touches: whichever moved last steers.
    if (Input.mouseDelta.lengthSq() > 0 || Input.getMouseButton(MouseButton.Left)) this.pointing = true;
    else if (keys !== 0) this.pointing = false;
    const x = this.pointing ? this.pointerX(this.camera) : this.node.position.x + keys * this.speed * dt;
    const limit = this.wall - this.halfWidth * this.node.scale.x;
    this.node.position.x = Mathf.clamp(x, -limit, limit);
  }

  /** Where the ray through the pointer crosses the plane of play, z = 0. */
  private pointerX(camera: Camera): number {
    this.point.set(Input.pointer.x, Input.pointer.y, 0.5).unproject(camera);
    const direction = this.point.sub(camera.getWorldPosition(this.eye));
    return Math.abs(direction.z) < 1e-6 ? this.node.position.x : this.eye.x - direction.x * (this.eye.z / direction.z);
  }

  /** It tilts into a move, by how fast it goes: a following value, not a tween. */
  private leanInto(dt: number): void {
    const velocity = (this.node.position.x - this.lastX) / Math.max(dt, 1e-4);
    this.lastX = this.node.position.x;
    this.lean = Mathf.lerp(this.lean, Mathf.clamp(velocity / 40, -1, 1), 1 - Math.exp(-12 * dt));
    if (this.body) this.body.rotation.z = -this.lean * 0.16;
  }

  /** Its width and cannons for the bonuses now running: it grows or shrinks into the new width. */
  private refit(): void {
    const width = this.ends.has('wide') ? this.wideScale : this.ends.has('slim') ? this.slimScale : 1;
    this.node.doScaleX(width, 0.3).setEase(Ease.OutBack);
    if (this.cannons) this.cannons.visible = this.ends.has('laser');
  }

  /** A volley from both cannons every `fireEvery` seconds, for as long as the laser lasts. */
  private *fire() {
    while (this.ends.has('laser')) {
      if (this.bolt && this.game.phase === 'playing') {
        const edge = (this.halfWidth - 0.25) * this.node.scale.x;
        const { x, y } = this.node.position;
        for (const side of [-edge, edge]) instantiate(this.bolt, { position: [x + side, y + 0.5, 0] });
        this.game.sfx?.play('laser');
      }
      yield new WaitForSeconds(this.fireEvery);
    }
  }

  /** The glow up by `extra`, settling back over `seconds`. */
  private flash(extra: number, seconds: number): void {
    const material = this.body?.material as MeshStandardMaterial | undefined;
    if (!material) return;
    Tween.kill(material);
    material.emissiveIntensity = GLOW + extra;
    material.doFloat(GLOW, 'emissiveIntensity', seconds).setEase(Ease.OutQuad).setLink(this);
  }
}
