import { MeshStandardMaterial, type Mesh, type Texture } from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import { MATERIAL_TARGETS } from '../targets.js';

@attachment({
  name: 'MeshStandardMaterial',
  description: 'Physically based (PBR) material with roughness/metalness and texture maps.',
  target: MATERIAL_TARGETS,
  group: 'material',
})
export class MeshStandardMaterialNode extends Attachment<Mesh> {
  @property({ type: ValueType.Color, description: 'Base (albedo) color' }) color = 0xffffff;
  @property({ type: ValueType.Float, description: 'Surface roughness, 0 (glossy) to 1 (matte)' }) roughness = 1;
  @property({ type: ValueType.Float, description: 'Metalness, 0 (dielectric) to 1 (metal)' }) metalness = 0;
  @property({ type: ValueType.Color, description: 'Emissive (self-lit) color' }) emissive = 0x000000;
  @property({ type: ValueType.Float, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: ValueType.Bool, description: 'Enable alpha blending (use with opacity)' }) transparent = false;
  @property({ type: ValueType.Bool, description: 'Render as wireframe' }) wireframe = false;

  // Texture maps — image URLs loaded into the engine's AssetCache and assigned at
  // attach. Need `loadSceneAsync` so the texture is ready (synchronous `loadScene`
  // leaves them unset).
  @property({ type: ValueType.String, asset: 'texture', description: 'Base color (albedo) texture URL' }) map = '';
  @property({ type: ValueType.String, asset: 'texture', description: 'Normal map texture URL' }) normalMap = '';
  @property({ type: ValueType.String, asset: 'texture', description: 'Roughness map texture URL' }) roughnessMap = '';
  @property({ type: ValueType.String, asset: 'texture', description: 'Metalness map texture URL' }) metalnessMap = '';
  @property({ type: ValueType.String, asset: 'texture', description: 'Emissive map texture URL' }) emissiveMap = '';
  @property({ type: ValueType.String, asset: 'texture', description: 'Ambient occlusion map texture URL' }) aoMap = '';

  private cached?: MeshStandardMaterial;
  attach(ctx: AttachContext<Mesh>): void {
    if (!this.cached) {
      const m = new MeshStandardMaterial({
        color: this.color,
        roughness: this.roughness,
        metalness: this.metalness,
        emissive: this.emissive,
        opacity: this.opacity,
        transparent: this.transparent,
        wireframe: this.wireframe,
      });
      this.cached = m;
      // Resolve textures from the cache (sync if loaded, else streamed in).
      const set = (url: string, assign: (t: Texture) => void): void =>
        ctx.assets?.resolve<Texture>(url, (t) => {
          assign(t);
          m.needsUpdate = true;
        });
      set(this.map, (t) => (m.map = t));
      set(this.normalMap, (t) => (m.normalMap = t));
      set(this.roughnessMap, (t) => (m.roughnessMap = t));
      set(this.metalnessMap, (t) => (m.metalnessMap = t));
      set(this.emissiveMap, (t) => (m.emissiveMap = t));
      set(this.aoMap, (t) => (m.aoMap = t));
    }
    ctx.node.material = this.cached;
  }
}
