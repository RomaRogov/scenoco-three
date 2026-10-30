import { Box3, InstancedMesh, Matrix4, Quaternion, Vector3, type Mesh } from 'three';
import { Behaviour, findObjectOfType, type Model } from '@scenoco-three/core';
import { SplineContainer } from '@scenoco-three/splines';
import { Terrain } from '@scenoco-three/terrain';

/**
 * Scenery strewn over the terrain — trees, rocks — clear of the track, the same every time for one
 * `seed`. Drawn instanced, one mesh per model part per `cell` metres square: one mesh for the whole
 * map would be inside every camera's view and every shadow's, and drawn whole each time; in cells,
 * what is behind the camera, or outside the shadow's box, is skipped.
 */
export class Scatter extends Behaviour {
  items: Model[] = [];
  count = 200;
  seed = 1;
  /** Height in metres of a copy at scale 1, and the range each copy is scaled by. */
  height = 6;
  minScale = 0.7;
  maxScale = 1.4;
  /** Half the area covered, x and z, around the node. */
  extent: [number, number] = [120, 120];
  /** Metres kept clear either side of the track's centre line. */
  clearTrack = 16;
  /** The side of the squares the copies are grouped into, each drawn as its own meshes. */
  cell = 64;

  override start(): void {
    const terrain = findObjectOfType(Terrain);
    const track = findObjectOfType(SplineContainer);
    if (!terrain || this.items.length === 0) return;
    const line = track ? Array.from({ length: 400 }, (_, i) => track.evaluatePosition(i / 400)) : [];
    const centre = this.node.getWorldPosition(new Vector3());
    let state = this.seed * 9301 + 49297;
    const random = () => (state = (state * 9301 + 49297) % 233280) / 233280;

    // By model, then by cell: `${column},${row}` → the copies there.
    const placed: Map<string, Matrix4[]>[] = this.items.map(() => new Map());
    const at = new Vector3();
    for (let tries = 0, made = 0; tries < this.count * 8 && made < this.count; tries++) {
      const x = centre.x + (random() * 2 - 1) * this.extent[0];
      const z = centre.z + (random() * 2 - 1) * this.extent[1];
      const pick = Math.floor(random() * this.items.length);
      const scale = this.minScale + random() * (this.maxScale - this.minScale);
      const yaw = random() * Math.PI * 2;
      if (line.some((p) => Math.hypot(p.x - x, p.z - z) < this.clearTrack)) continue;
      at.set(x, 0, z);
      at.y = terrain.sampleHeight(at) + terrain.node.position.y;
      const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
      const cell = placed[pick]!.get(key) ?? [];
      placed[pick]!.set(key, cell);
      cell.push(new Matrix4().compose(at.clone(), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3().setScalar(scale)));
      made++;
    }

    this.items.forEach((model, i) => {
      if (placed[i]!.size === 0) return;
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
        for (const copies of placed[i]!.values()) {
          const mesh = new InstancedMesh(part.geometry, part.material, copies.length);
          copies.forEach((m, k) => mesh.setMatrixAt(k, m.clone().multiply(local)));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // The cell's own bounds, so a camera or a shadow that cannot see the cell skips it.
          mesh.computeBoundingSphere();
          // Instances in world space: the node's own transform must not move them again.
          this.node.parent?.add(mesh);
        }
      });
    });
  }
}

const UP = new Vector3(0, 1, 0);
