import type { Material, Mesh, MeshStandardMaterial } from 'three';
import { Component } from '@scenoco-three/core';
import { GameState } from './GameState.js';

/**
 * One brick: takes `hits` hits, darkens with each one, and reports itself broken.
 *
 * The three tiers are one prefab. `hits` is the only thing a level says about a brick —
 * `<Override target="#brick" hits="2" />` — and the look follows from it: the prefab names all
 * three materials once, and the brick picks the one its toughness earns. Before overrides
 * existed this needed three near-identical prefab documents, because a spawn could say nothing
 * but where to put the thing.
 *
 * It never touches the score. The brick knows what it is worth in *hits*; what a hit is worth
 * in points is a rule of the run, and that lives on `Progress`.
 */
export class Brick extends Component<Mesh> {
  /** How many hits it survives — 1, 2 or 3. */
  hits = 1;

  /** The look of each tier. Shared assets: every brick of a tier draws the same material. */
  soft!: Material;
  firm!: Material;
  hard!: Material;

  private left = 1;
  private game!: GameState;
  private own: MeshStandardMaterial | null = null;

  override awake(): void {
    this.left = this.hits;
    this.object3D.material = this.hits >= 3 ? this.hard : this.hits === 2 ? this.firm : this.soft;
    // The same line a rigid body writes to join the physics world: a system is reached, never
    // searched for, and registering here is what tells the level how many bricks it has.
    this.game = this.requireSystem(GameState);
    this.game.register(this);
  }

  /** Called by the ball. True when this was the hit that broke it. */
  hit(): boolean {
    this.left -= 1;
    if (this.left > 0) {
      this.damage();
      return false;
    }
    this.game.broke(this, this.hits);
    this.object3D.destroy();
    return true;
  }

  /**
   * Show the damage: dimmer, and a shade smaller.
   *
   * A tier's material is one shared instance, so the first hit swaps in a copy this brick owns.
   * Writing to the shared one would dim every brick of the tier at once.
   */
  private damage(): void {
    if (!this.own) {
      this.own = (this.object3D.material as MeshStandardMaterial).clone();
      this.object3D.material = this.own;
    }
    this.own.color.multiplyScalar(0.62);
    this.own.emissive.multiplyScalar(0.5);
    this.object3D.scale.multiplyScalar(0.94);
  }
}
