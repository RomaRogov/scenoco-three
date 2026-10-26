import { Box3, InstancedMesh, Matrix4, type Mesh, Quaternion, Vector3 } from 'three';
import { Behaviour, findObjectOfType, findObjectsOfType, type Model } from '@scenoco-three/core';
import { SplineContainer } from '@scenoco-three/splines';
import { BuildPad } from './BuildPad';
import { Terrain } from '@scenoco-three/terrain';
import { groundAt } from './ground';

/**
 * Scenery strewn over the level: trees, rocks. Kept off the path, the pads and the water, the same
 * every time for one `seed`. Each model is drawn instanced — one draw call per part, however many.
 */
export class Scatter extends Behaviour {
  items: Model[] = [];
  count = 60;
  seed = 1;
  minScale = 0.8;
  maxScale = 1.3;
  /** Height, in units, of a scale-1 copy. */
  height = 1.6;
  /** Half the area to cover, x and z, around the node. */
  extent: [number, number] = [30, 30];
  /** Distance kept from the path's centre line. */
  clearPath = 3.4;
  /** No scenery below this ground height: shores and water. */
  minGround = 0.25;

  override start() {
    const terrain = findObjectOfType(Terrain);
    const path = findObjectOfType(SplineContainer);
    if (!terrain || this.items.length === 0) return;
    const line = path ? Array.from({ length: 240 }, (_, i) => path.evaluatePosition(i / 239)) : [];
    const pads = findObjectsOfType(BuildPad).map((p) => p.node.getWorldPosition(new Vector3()));
    let state = this.seed * 9301 + 49297;
    const random = () => ((state = (state * 9301 + 49297) % 233280) / 233280);

    const placed: Matrix4[][] = this.items.map(() => []);
    for (let tries = 0; tries < this.count * 8 && placed.flat().length < this.count; tries++) {
      const x = (random() * 2 - 1) * this.extent[0];
      const z = (random() * 2 - 1) * this.extent[1];
      const pick = Math.floor(random() * this.items.length);
      const scale = this.minScale + random() * (this.maxScale - this.minScale);
      const yaw = random() * Math.PI * 2;
      const point = new Vector3(x, 0, z);
      if (line.some((p) => Math.hypot(p.x - x, p.z - z) < this.clearPath)) continue;
      if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 2.2)) continue;
      point.y = groundAt(terrain, x, z);
      if (point.y < this.minGround) continue;
      placed[pick]!.push(new Matrix4().compose(point, new Quaternion().setFromAxisAngle(UP, yaw), new Vector3().setScalar(scale)));
    }

    this.items.forEach((model, i) => {
      if (placed[i]!.length === 0) return;
      const root = model.value.scene;
      root.updateMatrixWorld(true);
      // Sized so a scale-1 copy is `height` tall, its base on the ground.
      const box = new Box3().setFromObject(root);
      const fit = this.height / Math.max(box.max.y - box.min.y, 1e-3);
      const seat = new Matrix4().makeScale(fit, fit, fit).multiply(new Matrix4().makeTranslation(0, -box.min.y, 0));
      root.traverse((o) => {
        const part = o as Mesh;
        if (!part.isMesh) return;
        const local = seat.clone().multiply(part.matrixWorld);
        const mesh = new InstancedMesh(part.geometry, part.material, placed[i]!.length);
        placed[i]!.forEach((m, k) => mesh.setMatrixAt(k, m.clone().multiply(local)));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.node.add(mesh);
      });
    });
  }
}

const UP = new Vector3(0, 1, 0);
