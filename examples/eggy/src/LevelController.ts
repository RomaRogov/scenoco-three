import { Quaternion, Vector3, type Object3D, type Vector2 } from 'three';
import { Behaviour, Mathf, PlayerPrefs, Random, instantiate, type Prefab } from '@scenoco-three/core';
import { TerrainMesh } from './TerrainMesh';
import { punch, tween, Ease } from './tween';

const STORAGE_LEVEL = 'LevelController.LEVEL';
const STORAGE_STARS_OVERALL = 'LevelController.STARS_OVERALL';

/** The level's progress and layout — the Unity game's `LevelController`: stones, stars and the nest. */
export class LevelController extends Behaviour {
  nest: Object3D | null = null;
  stones: Prefab[] = [];
  star: Prefab | null = null;

  static starsOnLevel = 0;
  static starsCollected = 0;

  private static instance: LevelController;

  static get currentLevel(): number {
    return PlayerPrefs.getInt(STORAGE_LEVEL, 1);
  }

  static set currentLevel(value: number) {
    PlayerPrefs.setInt(STORAGE_LEVEL, value);
  }

  static get starsOverall(): number {
    return PlayerPrefs.getInt(STORAGE_STARS_OVERALL, 0);
  }

  static set starsOverall(value: number) {
    PlayerPrefs.setInt(STORAGE_STARS_OVERALL, value);
  }

  /** 0 on level 1, 1 from level 100: steeper, longer, hillier, stonier. */
  static get hardness(): number {
    return Mathf.clamp01(LevelController.currentLevel / 100);
  }

  static gameWon(): void {
    LevelController.starsOverall += LevelController.starsCollected;
    LevelController.currentLevel++;
    const self = LevelController.instance;
    const nest = self.nest!;
    const rest = nest.position.clone();
    // DOPunchPosition(Vector3.down * .3f, .5f)
    self.startCoroutine(tween(0.5, Ease.linear, (t) => nest.position.copy(rest).y -= 0.3 * punch(t)));
  }

  /** Lay the level out: Unity's Init, called by the terrain once its heights exist. */
  init(size: Vector2): void {
    LevelController.instance = this;
    Random.initState(LevelController.currentLevel);
    LevelController.starsOnLevel = 0;
    this.nest!.position.set(size.x + 1, 0, 0);
    const positions: Vector3[] = [];
    const hardness = LevelController.hardness;
    for (let i = 0; i < 10 + hardness * 30; i++) {
      const stone = instantiate(this.stones[Random.rangeInt(0, this.stones.length)]!, { parent: this.node });
      const pos = new Vector3(Random.range(22, size.x - 20), 0, Random.range(-10, 10));
      pos.y = TerrainMesh.getHeight(pos);
      stone.position.copy(pos);
      // eulerAngles: a turn about the world's up, whatever the slope's tilt.
      stone.quaternion.copy(worldYaw(this.node, Random.range(0, 360)));
      positions.push(pos);
    }
    for (let i = 0; i < 15; i++) {
      const star = instantiate(this.star!, { parent: this.node });
      let pos: Vector3;
      do {
        pos = new Vector3(Random.range(22, size.x - 20), 0, Random.range(-10, 10));
        pos.y = TerrainMesh.getHeight(pos) + 0.55;
      } while (positions.some((p) => p.distanceTo(pos) < 2));
      LevelController.starsOnLevel++;
      star.position.copy(pos);
      positions.push(pos);
    }
    LevelController.starsCollected = 0;
  }
}

/** The local rotation that leaves a child of `parent` turned `degrees` about the world's up. */
function worldYaw(parent: Object3D, degrees: number): Quaternion {
  const world = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (-degrees * Math.PI) / 180);
  return parent.getWorldQuaternion(new Quaternion()).invert().multiply(world);
}
