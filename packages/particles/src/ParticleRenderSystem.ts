import { BatchedRenderer, ParticleSystem as QuarksSystem } from 'three.quarks';
import { System, system } from '@scenoco-three/core';
import { ParticleSystem } from './ParticleSystem.js';
import { configToParameters } from './config.js';

/**
 * Renders every `<ParticleSystem>` in the scene via three.quarks. Registered for
 * the `ParticleSystem` component, so the engine auto-runs it whenever the scene
 * contains one (the System seam, exactly like the physics add-ons) — and, like
 * them, it only steps in play mode.
 *
 * It owns the scene's single `BatchedRenderer` (three.quarks batches all systems
 * into few draw calls), reconciles the live component set with the three.quarks
 * systems each frame (build new, tear down removed), and steps the renderer.
 */
@system(ParticleSystem)
export class ParticleRenderSystem extends System<ParticleSystem> {
  private renderer?: BatchedRenderer;
  private readonly built = new Map<ParticleSystem, QuarksSystem>();

  override onAttach(): void {
    // One BatchedRenderer per scene, living in the scene graph so it renders.
    this.renderer = new BatchedRenderer();
    this.engine.scene.add(this.renderer);
  }

  override step(dt: number): void {
    const renderer = this.renderer;
    if (!renderer) return;
    // Reconcile live components ↔ three.quarks systems: build the new, drop the gone.
    for (const comp of this.components) if (!this.built.has(comp)) this.build(renderer, comp);
    for (const [comp, ps] of this.built) if (!this.components.includes(comp)) this.teardown(renderer, comp, ps);
    renderer.update(dt);
  }

  override onDetach(): void {
    const renderer = this.renderer;
    if (renderer) {
      for (const [comp, ps] of [...this.built]) this.teardown(renderer, comp, ps);
      renderer.removeFromParent();
    }
    this.built.clear();
    this.renderer = undefined;
  }

  private build(renderer: BatchedRenderer, comp: ParticleSystem): void {
    const ps = new QuarksSystem(configToParameters(comp.toConfig()));
    comp.node.add(ps.emitter);
    renderer.addSystem(ps);
    this.built.set(comp, ps);
  }

  private teardown(renderer: BatchedRenderer, comp: ParticleSystem, ps: QuarksSystem): void {
    renderer.deleteSystem(ps);
    ps.emitter.removeFromParent();
    ps.dispose();
    this.built.delete(comp);
  }
}
