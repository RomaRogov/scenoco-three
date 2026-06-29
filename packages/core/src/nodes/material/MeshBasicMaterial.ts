import { MeshBasicMaterial, type Mesh, type Texture } from 'three';
import { Attachment } from '../base.js';
import { attachment, property } from '../../core/decorators.js';
import type { AttachContext } from '../../core/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({
  name: 'MeshBasicMaterial',
  description: 'Unlit material — shows a flat color/texture regardless of scene lighting.',
  target: MATERIAL_TARGETS,
  group: 'material',
})
export class MeshBasicMaterialNode extends Attachment<Mesh> {
  @property({ type: 'color', default: 0xffffff, description: 'Material color' }) color = 0xffffff;
  @property({ type: 'float', default: 1, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: 'bool', default: false, description: 'Enable alpha blending (use with opacity)' }) transparent = false;
  @property({ type: 'bool', default: false, description: 'Render as wireframe' }) wireframe = false;
  /** Image URL loaded into the engine's AssetCache (needs `loadSceneAsync`). */
  @property({ type: 'string', asset: 'texture', default: '', description: 'Color texture URL' }) map = '';

  private cached?: MeshBasicMaterial;
  attach(ctx: AttachContext<Mesh>): void {
    if (!this.cached) {
      const m = new MeshBasicMaterial({
        color: this.color,
        opacity: this.opacity,
        transparent: this.transparent,
        wireframe: this.wireframe,
      });
      this.cached = m;
      ctx.assets?.resolve<Texture>(this.map, (t) => {
        m.map = t;
        m.needsUpdate = true;
      });
    }
    ctx.node.material = this.cached;
  }
}
