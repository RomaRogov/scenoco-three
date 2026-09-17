import type { BatchedRenderer, ParticleSystem as QuarksSystem } from 'three.quarks';
import { System } from '@scenoco-three/core';
import { ParticleBatch } from './batch.js';
import type { ParticleSystem } from './ParticleSystem.js';

/**
 * Draws every `<ParticleSystem>` in the scene.
 *
 * ```xml
 * <Scene>
 *   <Systems>
 *     <ParticleRenderer />
 *   </Systems>
 * </Scene>
 * ```
 *
 * Declaring it is optional — the first emitter calls `requireSystem` and gets one. It exists as a
 * system because the batch every effect is drawn through is one object, and something has to own
 * it. That is exactly the line core draws: a component is behaviour on one node, a system is the
 * thing with no node.
 *
 * The batch itself is {@link ParticleBatch}, which knows nothing about scenes or components —
 * because the editor preview builds effects with it too, and an effect must look the same in both.
 *
 * It steps in `update`, so particles advance with the frame rather than with the fixed step —
 * they are appearance, and nothing simulated depends on them.
 */
export class ParticleRenderer extends System {
  /** The three.quarks renderer, in the scene graph so it draws. */
  get renderer(): BatchedRenderer {
    return this.batch.object;
  }

  private readonly batch = new ParticleBatch();

  private readonly built = new Map<ParticleSystem, QuarksSystem>();

  override awake(): void {
    this.scene.add(this.batch.object);
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
    const system = this.batch.add(emitter.effect, emitter.object3D);
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
