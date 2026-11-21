import { Color, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';
import { ArcadeCar } from './ArcadeCar.js';

/**
 * The car as it is seen: the Blender model (blender/car.py) placed under the node, its `paint`
 * material tinted `color` — a copy each, so every car keeps its own — and its parts handed to
 * `ArcadeCar` by the names the model gives them: `body` to lean, the four `wheel_*` to spin, the front
 * two to steer.
 */
export class CarModel extends Behaviour {
  color = new Color('#e2412f');

  override awake(): void {
    let paint: MeshStandardMaterial | null = null;
    this.node.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (material.name !== 'paint') return;
      paint ??= material.clone();
      paint.color.copy(this.color);
      mesh.material = paint;
    });
    const car = this.node.getComponent(ArcadeCar);
    if (!car) return;
    const part = (name: string): Object3D | null => this.node.getObjectByName(name) ?? null;
    car.body = part('body');
    car.frontLeft = part('wheel_FL');
    car.frontRight = part('wheel_FR');
    car.wheels = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(part).filter((w): w is Object3D => w !== null);
  }
}
