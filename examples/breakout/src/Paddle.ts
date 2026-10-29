import { Vector3, type Camera, type Group, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Behaviour, Input, MouseButton, findObjectOfType, instantiate, type Prefab } from '@scenoco-three/core';
import type { Bonus } from './assets.js';
import { GameState } from './GameState.js';

/** A bonus running on the paddle, and how much of it is left — what the HUD draws. */
export interface Effect {
  bonus: Exclude<Bonus, 'none' | 'multi'>;
  left: number;
  total: number;
}

/**
 * The paddle: moves by keyboard or by dragging, and wears the bonuses it catches.
 *
 * Its node is the physics body — `scale.x` is its width, and the collider follows it. What is seen
 * is `body`, a child it animates on its own: it leans into a move, squashes when the ball lands, and
 * flares when a bonus is caught, none of which may touch the collider.
 */
export class Paddle extends Behaviour<Group> {
  /** Units per second, for the keyboard. */
  speed = 18;
  /** Where the side walls' inner faces are: the paddle's edge stops there, whatever its width. */
  wall = 9.2;
  /** Half the paddle's width at scale 1. */
  halfWidth = 1.6;
  /** The visible paddle, which leans and squashes. */
  body: Mesh | null = null;
  /** The two cannons, shown while the laser lasts. */
  cannons: Object3D | null = null;
  /** What the laser fires. */
  bolt: Prefab | null = null;
  /** Seconds between two volleys. */
  fireEvery = 0.24;
  /** How wide `wide` makes it, and `slim`. */
  wideScale = 1.55;
  slimScale = 0.62;

  private game!: GameState;
  private readonly effects: Effect[] = [];
  private width = 1;
  private lastX = 0;
  private lean = 0;
  /** Squash from the last ball, and the flare from the last bonus: each fades to 0. */
  private squash = 0;
  private flare = 0;
  private cooldown = 0;
  private readonly point = new Vector3();
  private readonly eye = new Vector3();

  override awake(): void {
    this.game = findObjectOfType(GameState)!;
    // A lost ball ends what the rally earned.
    this.listen(this.game.ballReset, () => (this.effects.length = 0));
  }

  override start(): void {
    this.lastX = this.node.position.x;
  }

  override update(dt: number): void {
    this.move(dt);
    this.wear(dt);
    this.animate(dt);
  }

  /** The ball came down on it. */
  struck(): void {
    this.squash = 1;
  }

  /** A pickup was caught. */
  catch(bonus: Exclude<Bonus, 'none'>): void {
    this.flare = 1;
    this.game.sfx?.play(bonus === 'multi' ? 'multi' : 'catch');
    if (bonus === 'multi') return this.game.multiply();
    // Wide and slim undo each other; catching one again starts its time over.
    const seconds = bonus === 'laser' ? 9 : 14;
    const others = bonus === 'laser' ? [bonus] : ['wide', 'slim'];
    for (let i = this.effects.length - 1; i >= 0; i--) if (others.includes(this.effects[i]!.bonus)) this.effects.splice(i, 1);
    this.effects.push({ bonus, left: seconds, total: seconds });
  }

  /** The bonuses running now, for the HUD. */
  get running(): readonly Effect[] {
    return this.effects;
  }

  private has(bonus: Effect['bonus']): boolean {
    return this.effects.some((e) => e.bonus === bonus);
  }

  // --- moving ------------------------------------------------------------------------------

  private move(dt: number): void {
    const limit = this.wall - this.halfWidth * this.node.scale.x;
    let x = this.node.position.x;
    if (Input.getMouseButton(MouseButton.Left)) x = this.pointerX(this.camera);
    else x += Input.getAxisRaw('Horizontal') * this.speed * dt; // raw: a paddle stops the instant the key comes up
    this.node.position.x = Math.max(-limit, Math.min(limit, x));
  }

  /** Where the ray through the pointer crosses the plane of play, z = 0 — under any camera. */
  private pointerX(camera: Camera): number {
    this.point.set(Input.pointer.x, Input.pointer.y, 0.5).unproject(camera);
    camera.getWorldPosition(this.eye);
    const direction = this.point.sub(this.eye);
    if (Math.abs(direction.z) < 1e-6) return this.node.position.x;
    return this.eye.x + direction.x * (-this.eye.z / direction.z);
  }

  // --- bonuses ----------------------------------------------------------------------------

  private wear(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i]!.left -= dt;
      if (this.effects[i]!.left <= 0) this.effects.splice(i, 1);
    }
    const target = this.has('wide') ? this.wideScale : this.has('slim') ? this.slimScale : 1;
    // Eased, so the paddle grows rather than pops; the collider follows the node's scale.
    this.width += (target - this.width) * (1 - Math.exp(-10 * dt));
    if (Math.abs(this.node.scale.x - this.width) > 1e-3) this.node.scale.x = this.width;

    const laser = this.has('laser');
    if (this.cannons) this.cannons.visible = laser;
    this.cooldown -= dt;
    if (laser && this.bolt && this.cooldown <= 0 && this.game.phase === 'playing') {
      this.cooldown = this.fireEvery;
      const x = this.node.position.x;
      const edge = (this.halfWidth - 0.25) * this.node.scale.x;
      for (const side of [-edge, edge]) instantiate(this.bolt, { position: [x + side, this.node.position.y + 0.5, 0] });
      this.game.sfx?.play('laser');
    }
  }

  // --- how it looks -----------------------------------------------------------------------

  private animate(dt: number): void {
    const velocity = (this.node.position.x - this.lastX) / Math.max(dt, 1e-4);
    this.lastX = this.node.position.x;
    this.lean += (Math.max(-1, Math.min(1, velocity / 40)) - this.lean) * (1 - Math.exp(-12 * dt));
    this.squash = Math.max(0, this.squash - dt * 4.5);
    this.flare = Math.max(0, this.flare - dt * 2);
    if (!this.body) return;
    // A squash that springs back: down and wide, then a little up and narrow past rest.
    const s = Math.sin(this.squash * Math.PI * 1.5) * this.squash;
    this.body.scale.set(1 + s * 0.12, 1 - s * 0.3, 1);
    this.body.rotation.z = -this.lean * 0.16;
    this.body.position.y = -s * 0.1;
    const material = this.body.material as MeshStandardMaterial;
    material.emissiveIntensity = 1.2 + this.flare * 3 + this.squash;
  }
}
