import type { BatchedRenderer, ParticleSystem as QuarksSystem } from 'three.quarks';
import { System } from '@scenoco-three/core';
import { ParticleBatch } from './batch.js';
import type { ParticleSystem } from './ParticleSystem.js';

/**
 * Draws every `ParticleSystem` in the scene through one three.quarks batch — made by the first
 * emitter that wakes. It steps in `update`: particles are appearance, and nothing simulated
 * depends on them.
 */
export class ParticleRenderer extends System {
  /** The three.quarks renderer, in the scene graph so it draws. */
  get renderer(): BatchedRenderer {
    return this.batch.object;
  }

  private readonly batch = new ParticleBatch();

  private readonly built = new Map<ParticleSystem, QuarksSystem>();

  override awake(): void {
    this.runtime.root.add(this.batch.object);
  }

  override update(deltaTime: number): void {
    this.batch.step(deltaTime);
  }

  override onDestroy(): void {
    this.batch.dispose();
    this.built.clear();
  }

  /** @internal called by `ParticleSystem.awake`. */
  createSystem(emitter: ParticleSystem): QuarksSystem {
    const system = this.batch.add(emitter.effect, emitter.node);
    this.built.set(emitter, system);
    return system;
  }

  /** @internal called by `ParticleSystem.onDestroy`. */
  destroySystem(emitter: ParticleSystem): void {
    const system = this.built.get(emitter);
    if (!system) return;
    this.batch.remove(system);
    this.built.delete(emitter);
  }
}
