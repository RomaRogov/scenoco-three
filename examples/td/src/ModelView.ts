import { Box3, type Mesh, type Object3D, Vector3 } from 'three';
import { Behaviour, Model, instantiate } from '@scenoco-three/core';

/**
 * Shows a loaded model as a child of this node, sized and seated: `height` units tall, or `width`
 * units across its wider side (a tower on its pad), centred on the node with its base at the node's
 * origin, turned `yaw` degrees. Generated models come at whatever size their generator chose; this
 * makes them fit. `seat={false}` leaves the model where its file put it (a projectile, centred).
 */
export class ModelView extends Behaviour {
  model: Model | null = null;
  height = 0;
  width = 0;
  yaw = 0;
  seat = true;
  castShadow = true;
  receiveShadow = false;

  /** The model's own root, once shown. */
  view: Object3D | null = null;

  override awake() {
    if (!this.model) throw new Error('ModelView has no model: give it model={models.goblin}.');
    const view = instantiate(this.model, { parent: this.node });
    view.rotation.y = (this.yaw * Math.PI) / 180;
    view.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = this.receiveShadow;
    });
    this.view = view;
    if (!this.seat && !this.height && !this.width) return;

    // Measured in this node's own space, whatever scale the node starts at (a tower popping in).
    this.node.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(view).applyMatrix4(this.node.matrixWorld.clone().invert());
    const size = box.getSize(new Vector3());
    const scale = this.width > 0 ? this.width / Math.max(size.x, size.z, 1e-3) : this.height > 0 ? this.height / Math.max(size.y, 1e-3) : 1;
    view.scale.setScalar(scale);
    if (!this.seat) return;
    const centre = box.getCenter(new Vector3());
    view.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  }
}
