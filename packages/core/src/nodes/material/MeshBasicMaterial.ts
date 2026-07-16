import { MeshBasicMaterial, type Mesh, type Texture } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({
  name: 'MeshBasicMaterial',
  description: 'Unlit material — shows a flat color/texture regardless of scene lighting.',
  target: MATERIAL_TARGETS,
  group: 'material',
})
export class MeshBasicMaterialNode extends Attachment<Mesh> {
  @property({ type: ValueType.Color, description: 'Material color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: ValueType.Bool, description: 'Enable alpha blending (use with opacity)' }) transparent = false;
  @property({ type: ValueType.Bool, description: 'Render as wireframe' }) wireframe = false;
  /** Image URL loaded into the engine's AssetCache (needs `loadSceneAsync`). */
  @property({ type: ValueType.String, asset: 'texture', description: 'Color texture URL' }) map = '';

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
