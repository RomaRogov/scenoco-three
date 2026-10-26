import { BufferAttribute, BufferGeometry, Vector3, type Mesh } from 'three';
import { Behaviour, findObjectOfType } from '@scenoco-three/core';
import { Spline, type BezierKnot } from '@scenoco-three/splines';
import { Terrain } from '@scenoco-three/terrain';

/** Metres of bed averaged either side of a point for the water's height there. */
const SMOOTH = 6;

/**
 * A river's water: a ribbon along the knots that carved its bed (the asset lab's level `rivers`),
 * `level` metres over the bed's middle, smoothed along its length so it does not ripple with every
 * pebble. The banks rise through its edges, so only the channel shows. Its mesh shares the
 * terrain's node, so the knots are in map metres.
 */
export class River extends Behaviour<Mesh> {
  knots: BezierKnot[] = [];
  /** Metres across: a little wider than the carved bed, so its edges sink into the banks. */
  width = 12;
  /** Metres of water over the bed's deepest line. */
  level = 1.1;

  override start() {
    const terrain = findObjectOfType(Terrain);
    const data = terrain?.terrainData;
    if (!data) throw new Error('River needs a Terrain in the scene: its water follows the ground.');
    const spline = new Spline(this.knots);
    const steps = Math.ceil(spline.getLength());
    const side = data.size.x;
    const bed = Array.from({ length: steps + 1 }, (_, i) => {
      const p = spline.evaluatePosition(i / steps);
      return data.getInterpolatedHeight(p.x / side + 0.5, p.z / side + 0.5);
    });
    const positions = new Float32Array((steps + 1) * 6);
    const point = new Vector3();
    const across = new Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      spline.evaluatePosition(t, point);
      spline.evaluateTangent(t, across);
      across.set(across.z, 0, -across.x).normalize().multiplyScalar(this.width / 2);
      // The bed averaged over SMOOTH metres either side.
      const window = bed.slice(Math.max(0, i - SMOOTH), i + SMOOTH + 1);
      const surface = window.reduce((sum, h) => sum + h, 0) / window.length + this.level;
      positions.set([point.x + across.x, surface, point.z + across.z, point.x - across.x, surface, point.z - across.z], i * 6);
    }
    const index: number[] = [];
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    this.node.geometry = geometry;
  }

  override onDestroy() {
    this.node.geometry.dispose();
  }
}
