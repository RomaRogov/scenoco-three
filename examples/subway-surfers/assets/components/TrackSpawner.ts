import type { Object3D } from 'three';
import { Component, component, property, PrefabAsset, ValueType } from '@scenoco-three/core';
import { PlayerController } from './PlayerController.js';

/**
 * Procedurally spawns track segments ahead of the player and recycles them once
 * they fall behind — object pooling is skipped in favor of plain spawn/destroy
 * for clarity (each segment parents its own obstacle/coins, so one
 * `engine.destroy(segmentRoot)` tears the whole thing down in one call, per the
 * engine's Unity-style recursive destroy).
 *
 * References `PlayerController` (one direction only, to read its node position
 * and its `lanes` — no duplicated lane-position config to drift out of sync).
 * `PlayerController` never references this back.
 */
@component({
  name: 'TrackSpawner',
  description: 'Procedurally spawns track segments (with randomized obstacles/coins) ahead of the player and recycles them once behind.',
})
export class TrackSpawner extends Component {
  @property({ type: ValueType.Prefab, description: 'Track segment prefab (ground + walls)' })
  segment: PrefabAsset | null = null;
  @property({ type: ValueType.Prefab, description: 'Low barrier — jump over' })
  barrier: PrefabAsset | null = null;
  @property({ type: ValueType.Prefab, description: 'Overhead beam — slide under' })
  beam: PrefabAsset | null = null;
  @property({ type: ValueType.Prefab, description: 'Full-height train — must change lanes' })
  train: PrefabAsset | null = null;
  @property({ type: ValueType.Prefab, description: 'Collectible coin' })
  coin: PrefabAsset | null = null;

  @property({ type: PlayerController, description: "The player — this segment's placement follows its Z position and lanes" })
  player: PlayerController | null = null;

  @property({ type: ValueType.Float, description: 'Length of one segment along Z' })
  segmentLength = 24;
  @property({ type: ValueType.Int, description: 'Segments kept spawned ahead of the player' })
  segmentsAhead = 5;
  @property({ type: ValueType.Float, description: 'Distance behind the player before a segment is recycled' })
  behindMargin = 16;
  @property({ type: ValueType.Int, description: 'Segments from the start with no obstacles — a fair runway' })
  safeSegments = 2;
  @property({ type: ValueType.Float, description: 'Chance (0-1) a populated segment gets an obstacle' })
  obstacleChance = 0.8;
  @property({ type: ValueType.Float, description: 'Chance (0-1) a populated segment gets a coin run' })
  coinChance = 0.85;

  private nextZ = 0;
  private segmentIndex = 0;
  private active: { root: Object3D; centerZ: number }[] = [];

  override onLoad(): void {
    // Pre-fill the starting window so the track never visibly "pops in".
    while (this.nextZ > this.playerZ() - this.segmentsAhead * this.segmentLength) this.spawnSegment();
  }

  override update(): void {
    const playerZ = this.playerZ();
    while (this.nextZ > playerZ - this.segmentsAhead * this.segmentLength) this.spawnSegment();
    for (const s of [...this.active]) {
      if (s.centerZ > playerZ + this.behindMargin) {
        this.engine.destroy(s.root);
        this.active.splice(this.active.indexOf(s), 1);
      }
    }
  }

  private playerZ(): number {
    return this.player?.node.position.z ?? 0;
  }

  private lanes(): number[] {
    return this.player?.lanes ?? [-2.4, 0, 2.4];
  }

  private spawnSegment(): void {
    const z = this.nextZ;
    this.nextZ -= this.segmentLength;
    const root = this.segment?.spawn({ position: [0, 0, z] });
    if (!root) return;
    this.active.push({ root, centerZ: z });
    this.segmentIndex++;
    if (this.segmentIndex > this.safeSegments) this.populate(root);
  }

  /** Drop a random obstacle and/or a short run of coins into a freshly spawned segment. */
  private populate(root: Object3D): void {
    const lanes = this.lanes();
    const half = this.segmentLength / 2 - 2;
    const kinds = [this.barrier, this.beam, this.train];
    const obstacle = kinds[Math.floor(Math.random() * kinds.length)];
    let obstacleLane = -1;
    if (obstacle && Math.random() < this.obstacleChance) {
      obstacleLane = Math.floor(Math.random() * lanes.length);
      const localZ = (Math.random() - 0.5) * half;
      obstacle.spawn({ parent: root, position: [lanes[obstacleLane] ?? 0, 0, localZ] });
    }

    if (this.coin && Math.random() < this.coinChance) {
      // Prefer a lane the obstacle isn't sitting in, so the reward is reachable
      // without necessarily needing the jump/slide to also grab it.
      let coinLane = Math.floor(Math.random() * lanes.length);
      if (lanes.length > 1 && coinLane === obstacleLane) coinLane = (coinLane + 1) % lanes.length;
      const count = 3 + Math.floor(Math.random() * 3);
      const start = -half + Math.random() * (half * 0.6);
      for (let i = 0; i < count; i++) {
        this.coin.spawn({ parent: root, position: [lanes[coinLane] ?? 0, 1, start + i * 1.6] });
      }
    }
  }
}
