import { BatchedRenderer, ParticleSystem as QuarksSystem } from 'three.quarks';
import { System } from '@scenoco-three/core';
import { configToParameters } from './config.js';
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
 * Declaring it is optional — the first emitter calls `requireSystem` and gets one. It exists as
 * a system because three.quarks batches every effect in a scene into a handful of draw calls
 * through a single `BatchedRenderer`, and something has to own that one object. That is exactly
 * the line core draws: a component is behaviour on one node, a system is the thing with no
 * node.
 *
 * It steps in `update`, so particles advance with the frame rather than with the fixed step —
 * they are appearance, and nothing simulated depends on them.
 */
export class ParticleRenderer extends System {
  /** The three.quarks renderer, in the scene graph so it draws. */
  get renderer(): BatchedRenderer {
    return this._renderer;
  }

  private _renderer!: BatchedRenderer;

  private readonly built = new Map<ParticleSystem, QuarksSystem>();

  override awake(): void {
    this._renderer = new BatchedRenderer();
    this.scene.add(this.renderer);
  }

  override update(deltaTime: number): void {
    this.renderer.update(deltaTime);
  }

  override onDestroy(): void {
    for (const system of this.built.values()) system.dispose();
    this.built.clear();
    this.renderer.removeFromParent();
  }

  /** @internal called by `ParticleSystem.awake`. */
  createSystem(emitter: ParticleSystem): QuarksSystem {
    const system = new QuarksSystem(configToParameters(emitter.effect));
    // The emitter object is what carries the effect's transform, so it hangs under the node the
    // component is on — a moved node moves the effect, which is what `Local` space means.
    emitter.object3D.add(system.emitter);
    this.renderer.addSystem(system);
    this.built.set(emitter, system);
    return system;
  }

  /** @internal called by `ParticleSystem.onDestroy`. */
  destroySystem(emitter: ParticleSystem): void {
    const system = this.built.get(emitter);
    if (!system) return;
    this.renderer.deleteSystem(system);
    system.emitter.removeFromParent();
    system.dispose();
    this.built.delete(emitter);
  }
}
