import { Object3D } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';

/** The shape the glTF loader returns. */
interface LoadedGltf {
  scene: Object3D;
  animations?: unknown[];
}

/**
 * Attaches a loaded glTF/GLB model as a child subtree of its host node. The
 * `src` URL is loaded into the engine's `AssetCache` during preload; at attach
 * the cached model's scene is **cloned** (so multiple instances and the cached
 * original stay independent) and added under `ctx.node`.
 *
 *   <Group position="0 0 0"><Model src="hero.glb" /></Group>
 *
 * Loaded via `loadSceneAsync` (ready before instantiation) or streamed in under
 * synchronous `loadScene` (added when the load finishes). The clone uses
 * `SkeletonUtils.clone`, so **skinned** meshes rebind correctly; it shares the
 * cached geometry/materials (cache-managed → not freed on scene unload).
 * Animation clips are not yet wired (see the animation roadmap item).
 */
@attachment({
  name: 'Model',
  target: Object3D,
  group: 'model',
  unique: false,
  description: 'A glTF/GLB model loaded as a child subtree of the node.',
})
export class ModelNode extends Attachment {
  @property({ type: 'string', asset: 'model', default: '', description: 'glTF/GLB URL' })
  src = '';

  attach(ctx: AttachContext): void {
    const node = ctx.node;
    ctx.assets?.resolve<LoadedGltf>(this.src, (gltf) => {
      if (!gltf.scene) return;
      const clone = cloneSkinned(gltf.scene);
      // Expose the model's premade animation clips on the clone, so an animation
      // player (AnimationMixer) can drive them.
      if (gltf.animations?.length) clone.userData.animations = gltf.animations;
      node.add(clone);
    });
  }
}
