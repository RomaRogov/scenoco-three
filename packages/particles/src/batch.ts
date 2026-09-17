import type { Object3D } from 'three';
import { BatchedRenderer, ParticleSystem as QuarksSystem } from 'three.quarks';
import { configToParameters, type ParticleEffect } from './config.js';

/**
 * Live effects and the thing that draws them: a three.quarks batch, the systems in it, and the
 * step that advances them.
 *
 * Its own class because **two** things build effects and they have to build them identically —
 * the scene's {@link ParticleRenderer}, and the editor preview, which has no scene, no components
 * and no engine. The preview bundles this file, so an effect in an editor is made by the same code
 * that makes it in the game. There is no second implementation to drift.
 *
 * three.quarks batches every effect into a handful of draw calls through one `BatchedRenderer`, so
 * something has to own that one object; this is it.
 */
export class ParticleBatch {
  /** The renderer. It is an `Object3D`, and it has to be in the scene graph, because it draws. */
  readonly object = new BatchedRenderer();

  private readonly systems = new Set<QuarksSystem>();

  /**
   * Build one effect, and hang its emitter under `parent`.
   *
   * The emitter object is what carries the effect's transform, so it goes under whatever asked
   * for it — a moved node moves the effect, which is what `Local` simulation space means.
   */
  add(effect: ParticleEffect, parent: Object3D): QuarksSystem {
    const system = new QuarksSystem(configToParameters(effect));
    parent.add(system.emitter);
    this.object.addSystem(system);
    this.systems.add(system);
    return system;
  }

  /** Take one out again, and free what it held. */
  remove(system: QuarksSystem): void {
    if (!this.systems.delete(system)) return;
    this.object.deleteSystem(system);
    system.emitter.removeFromParent();
    system.dispose();
  }

  /** Advance every effect in the batch. Appearance, so it moves with the frame. */
  step(deltaTime: number): void {
    this.object.update(deltaTime);
  }

  /** Free the lot. */
  dispose(): void {
    for (const system of [...this.systems]) this.remove(system);
    this.object.removeFromParent();
  }
}
