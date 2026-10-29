import { Vector3, type Mesh, type MeshStandardMaterial } from 'three';
import { Behaviour, destroy, findObjectOfType, instantiate, type Prefab } from '@scenoco-three/core';
import { BONUSES, type Bonus } from './bonus.js';
import { GameState } from './GameState.js';

/**
 * One brick: takes `hits` hits, flashes and darkens with each one, and bursts when it breaks — into
 * sparks, and into a pickup when it carries one.
 *
 * Every setting comes from where the level places it — `<BrickPrefab hits={2} bonus="laser" />` —
 * and the brick turns those into its tier's colours, its sparks and its pickup, from the tables the
 * prefab hands it. Its material is its own, written in the prefab, so a hit can darken it alone. It knows what it is worth in *hits*; what a hit is worth in points is a rule
 * of the run, on `Progress`.
 */
export class Brick extends Behaviour<Mesh> {
  /** How many hits it survives — 1, 2 or 3. */
  hits = 1;
  /** What falls out of it when it breaks. */
  bonus: Bonus = 'none';
  /** By hits, less one: the tier's colour, how metallic it is, and the sparks it breaks into. */
  tints: string[] = [];
  metalness: number[] = [];
  bursts: (Prefab | null)[] = [];
  /** By bonus, in `BONUSES`' order: the pickup it drops, and the colour of the gem that says so. */
  drops: Prefab[] = [];
  gemTints: string[] = [];
  gem: Mesh | null = null;

  private left = 1;
  private game!: GameState;
  /** The flash of the last hit, fading: added to the glow, and to the scale as a kick. */
  private flash = 0;
  private readonly rest = new Vector3();

  override awake(): void {
    // Registering is what tells the level how many bricks it has.
    this.game = findObjectOfType(GameState)!;
    this.game.register(this);
    this.dress();
  }

  /** Again when the editor changes `hits` or `bonus`. */
  override onValidate(): void {
    this.dress();
  }

  /** Its look from its settings: the tier's colours, and the gem only when it drops something. */
  private dress(): void {
    const tint = this.tints[this.hits - 1];
    if (tint) {
      this.material.color.set(tint);
      this.material.emissive.set(tint);
    }
    this.material.metalness = this.metalness[this.hits - 1] ?? this.material.metalness;
    if (!this.gem) return;
    const gem = this.gemTints[this.which];
    this.gem.visible = !!gem;
    if (gem) {
      const material = this.gem.material as MeshStandardMaterial;
      material.color.set(gem);
      material.emissive.set(gem);
    }
  }

  private get material(): MeshStandardMaterial {
    return this.node.material as MeshStandardMaterial;
  }

  override start(): void {
    this.left = this.hits;
    this.rest.copy(this.node.scale);
  }

  override update(dt: number): void {
    if (this.flash <= 0) return;
    this.flash = Math.max(0, this.flash - dt * 5);
    const kick = 1 + this.flash * 0.12;
    this.node.scale.set(this.rest.x * kick, this.rest.y * kick, this.rest.z);
    this.material.emissiveIntensity = this.glow + this.flash * 4;
  }

  /** Called by the ball and by a laser bolt. True when this was the hit that broke it. */
  hit(): boolean {
    this.left -= 1;
    if (this.left > 0) {
      this.damage();
      this.game.sfx?.play('clank');
      return false;
    }
    const at = this.node.getWorldPosition(new Vector3());
    this.game.broke(this, this.hits, at);
    // Each brick of a rally a note higher up the scale.
    this.game.sfx?.play('break', this.game.combo - 1);
    const burst = this.bursts[this.hits - 1];
    const drop = this.drops[this.which];
    if (burst) instantiate(burst, { position: at });
    if (drop) instantiate(drop, { position: at });
    destroy(this.node);
    return true;
  }

  /** Its bonus as an index into the tables, -1 for none. */
  private get which(): number {
    return BONUSES.indexOf(this.bonus as (typeof BONUSES)[number]);
  }

  /** How bright its frame glows with the hits it has left. */
  private get glow(): number {
    return 2.4 * (0.45 + (0.55 * this.left) / this.hits);
  }

  /** Show the damage: the frame dims and the body darkens. */
  private damage(): void {
    this.material.color.multiplyScalar(0.7);
    this.flash = 1;
  }
}
