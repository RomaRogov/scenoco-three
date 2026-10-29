import type { Mesh, MeshStandardMaterial } from 'three';
import { Behaviour, Random, WaitForSeconds } from '@scenoco-three/core';

/**
 * A neon tube that stutters now and then: every `minDelay` to `maxDelay` seconds, chosen afresh each
 * time, its glow dips a few times in quick succession and comes back — each tube on its own clock.
 * It drives the emission of its own material, the one written in the scene.
 */
export class NeonFlicker extends Behaviour<Mesh> {
  minDelay = 3;
  maxDelay = 5;
  /** How dark a dip goes, as a share of the tube's glow: 0 is out, 1 no dip at all. */
  minLevel = 0.85;
  maxLevel = 0.95;
  /** How many dips a flicker has, at most. */
  maxDips = 4;

  private rest = 1;

  override start(): void {
    this.rest = this.material.emissiveIntensity;
    this.startCoroutine(this.flicker());
  }

  private *flicker() {
    while (true) {
      yield new WaitForSeconds(Random.range(this.minDelay, this.maxDelay));
      const dips = Random.rangeInt(1, this.maxDips + 1);
      for (let i = 0; i < dips; i++) {
        this.material.emissiveIntensity = this.rest * Random.range(this.minLevel, this.maxLevel);
        yield new WaitForSeconds(Random.range(0.03, 0.08));
        this.material.emissiveIntensity = this.rest;
        yield new WaitForSeconds(Random.range(0.03, 0.12));
      }
    }
  }

  private get material(): MeshStandardMaterial {
    return this.node.material as MeshStandardMaterial;
  }
}
