import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import type { Effect } from './RenderSettings.js';

/**
 * The post-processing chain, built when a scene's render settings declare a pass.
 *
 * Everything about it is loaded through a dynamic `import`, so a project whose scenes declare
 * no passes never fetches a byte of three's postprocessing addons — which is why this is a
 * module of its own rather than imports at the top of `Engine`.
 *
 * The chain is `render → the document's effects, in order → output`. `OutputPass` last is
 * three.js's own recommendation: it applies the tone mapping and colour-space conversion the
 * renderer would otherwise have done on its way to the canvas, so a composited frame and a
 * plain one differ only by the effects.
 */
export class EffectChain {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;

  private constructor(composer: EffectComposer, renderPass: RenderPass) {
    this.composer = composer;
    this.renderPass = renderPass;
  }

  /** Load the composer and wire `effects` into it, in document order. */
  static async create(renderer: WebGLRenderer, effects: readonly Effect[]): Promise<EffectChain> {
    const [{ EffectComposer }, { RenderPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);

    const composer = new EffectComposer(renderer);
    // `RenderPass` needs a scene and a camera up front; both are replaced on every frame, so
    // which ones it starts with does not matter. The active scene supplies them in `render`.
    const renderPass = new RenderPass(undefined as unknown as Scene, undefined as unknown as Camera);
    composer.addPass(renderPass);
    for (const effect of effects) {
      const pass = effect.createPass?.();
      if (pass) composer.addPass(pass);
    }
    composer.addPass(new OutputPass());

    const size = renderer.getSize(new Vector2());
    composer.setSize(size.x, size.y);
    return new EffectChain(composer, renderPass);
  }

  /** Draw `scene` through the chain. */
  render(scene: Scene, camera: Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
