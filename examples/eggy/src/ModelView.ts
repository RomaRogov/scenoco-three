import type { Material, Mesh, Object3D } from 'three';
import { Behaviour, instantiate, type Model } from '@scenoco-three/core';

/**
 * Shows a model under its node, with Unity's materials put back: one for every mesh, or one per
 * mesh by name (`{ basket: …, leaf1: … }`).
 */
export class ModelView extends Behaviour {
  model: Model | null = null;
  material: Material | null = null;
  materials: Record<string, Material> = {};
  castShadow = true;
  receiveShadow = false;

  /** The model's own root, once shown. */
  view: Object3D | null = null;

  override awake() {
    if (!this.model) throw new Error('ModelView has no model: give it model={models.egg}.');
    this.view = instantiate(this.model, { parent: this.node });
    this.view.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = this.materials[mesh.name] ?? this.material;
      if (material) mesh.material = material;
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = this.receiveShadow;
    });
  }
}
