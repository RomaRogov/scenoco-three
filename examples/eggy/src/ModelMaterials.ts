import type { Material, Mesh } from 'three';
import { Behaviour } from '@scenoco-three/core';

/**
 * Unity's materials put back on the model under this node, as its MeshRenderers held them: `material`
 * on every mesh, or `materials`, one per mesh in the model's order — its material slots.
 */
export class ModelMaterials extends Behaviour {
  material: Material | null = null;
  materials: Material[] = [];

  override awake() {
    let index = 0;
    this.node.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = this.materials[index++] ?? this.material;
      if (material) mesh.material = material;
    });
  }
}
