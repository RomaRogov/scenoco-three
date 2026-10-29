import { Vector3, type Material, type Mesh, type MeshStandardMaterial } from 'three';
import { Behaviour, destroy, findObjectOfType, instantiate, type Prefab } from '@scenoco-three/core';
import { BONUSES, type Bonus } from './assets.js';
import { GameState } from './GameState.js';

/**
 * One brick: takes `hits` hits, flashes and darkens with each one, and bursts when it breaks — into
 * sparks, and into a pickup when it carries one.
 *
 * Every setting comes from where the level places it — `<BrickPrefab hits={2} bonus="laser" />` —
 * and the brick turns those into the tier's material, its sparks and its pickup, from the tables
 * the prefab hands it. It knows what it is worth in *hits*; what a hit is worth in points is a rule
 * of the run, on `Progress`.
 */
export class Brick extends Behaviour<Mesh> {
  /** How many hits it survives — 1, 2 or 3. */
  hits = 1;
  /** What falls out of it when it breaks. */
  bonus: Bonus = 'none';
  /** By hits, less one: its material, and the sparks it breaks into. */
  looks: Material[] = [];
  bursts: (Prefab | null)[] = [];
  /** By bonus, in `BONUSES`' order: the pickup it drops, and the gem on its face that says so. */
  drops: Prefab[] = [];
  gems: Material[] = [];
  gem: Mesh | null = null;

  private left = 1;
  private game!: GameState;
  private own: MeshStandardMaterial | null = null;
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

  /** Its look from its settings: the tier's material, and the gem only when it drops something. */
  private dress(): void {
    const look = this.looks[this.hits - 1];
    if (look) this.node.material = look;
    if (!this.gem) return;
    const gem = this.gems[this.which];
    this.gem.visible = !!gem;
    if (gem) this.gem.material = gem;
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
    if (this.own) this.own.emissiveIntensity = this.glow + this.flash * 4;
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

  /**
   * Show the damage: the frame dims and the body darkens. A tier's material is one shared instance,
   * so the first hit swaps in a copy this brick owns — writing the shared one would dim the tier.
   */
  private damage(): void {
    if (!this.own) {
      this.own = (this.node.material as MeshStandardMaterial).clone();
      this.node.material = this.own;
    }
    this.own.color.multiplyScalar(0.7);
    this.flash = 1;
  }
}
