import { Color, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Behaviour, instantiate, type Model } from '@scenoco-three/core';
import { ArcadeCar } from './ArcadeCar.js';

/**
 * The car as it is seen: the Blender model (blender/car.py) placed under the node, its `paint`
 * material tinted `color` — a copy each, so every car keeps its own — and its parts handed to
 * `ArcadeCar` by the names the model gives them: `body` to lean, the four `wheel_*` to spin, the front
 * two to steer.
 */
export class CarModel extends Behaviour {
  model: Model | null = null;
  color = new Color('#e2412f');

  override awake(): void {
    if (!this.model) throw new Error('CarModel has no model: give it model={models.car}.');
    const view = instantiate(this.model, { parent: this.node });
    let paint: MeshStandardMaterial | null = null;
    view.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const material = mesh.material as MeshStandardMaterial;
      if (material.name !== 'paint') return;
      paint ??= material.clone();
      paint.color.copy(this.color);
      mesh.material = paint;
    });
    const car = this.node.getComponent(ArcadeCar);
    if (!car) return;
    const part = (name: string): Object3D | null => view.getObjectByName(name) ?? null;
    car.body = part('body');
    car.frontLeft = part('wheel_FL');
    car.frontRight = part('wheel_FR');
    car.wheels = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(part).filter((w): w is Object3D => w !== null);
  }
}
