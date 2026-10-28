import { BufferAttribute, BufferGeometry, Color, Vector3, type Mesh } from 'three';
import { Behaviour, findObjectOfType } from '@scenoco-three/core';
import { Spline, type BezierKnot } from '@scenoco-three/splines';
import { Terrain } from '@scenoco-three/terrain';

/** Metres of bed averaged either side of a point for the water's height there. */
const SMOOTH = 6;
/** Samples across the ribbon. */
const ACROSS = 12;

/**
 * A river's water: a ribbon along the knots that carved its bed (the asset lab's level `rivers`),
 * `level` metres over the bed's middle, smoothed along its length so it does not ripple with every
 * pebble. Every vertex knows the ground under it: the water is clear and pale where it is shallow
 * and fades out where the bank rises through it, so the shore follows the ground, not the ribbon's
 * edge. Its mesh shares the terrain's node, so the knots are in map metres. Draw it with a material
 * that has `vertexColors` and `transparent`.
 */
export class River extends Behaviour<Mesh> {
  knots: BezierKnot[] = [];
  /** Metres across: wider than the carved bed, so the banks decide where the water ends. */
  width = 20;
  /** Metres of water over the bed's deepest line. */
  level = 0.7;
  /**
   * Metres the ribbon's two edges sink below the surface, curving down from its middle: on flat
   * banks the water dips under the ground before it reaches them, instead of spreading over them.
   */
  bank = 1;
  /** Metres of depth over which the shore fades in. */
  shore = 0.35;
  /** Metres at which the water reaches `deep`. */
  depth = 2.2;
  shallow = new Color('#4fb3c4');
  deep = new Color('#1a5a86');
  /** How opaque the deepest water is. */
  opacity = 0.85;

  override start() {
    this.build();
  }

  /** Changed in the editor: the water is laid again. */
  override onValidate() {
    this.build();
  }

  private build() {
    const terrain = findObjectOfType(Terrain);
    const data = terrain?.terrainData;
    if (!data) throw new Error('River needs a Terrain in the scene: its water follows the ground.');
    const spline = new Spline(this.knots);
    const steps = Math.ceil(spline.getLength() / 2);
    const side = data.size.x;
    const ground = (x: number, z: number) => data.getInterpolatedHeight(x / side + 0.5, z / side + 0.5);
    const bed = Array.from({ length: steps + 1 }, (_, i) => {
      const p = spline.evaluatePosition(i / steps);
      return ground(p.x, p.z);
    });
    const positions = new Float32Array((steps + 1) * ACROSS * 3);
    const colours = new Float32Array((steps + 1) * ACROSS * 4);
    const point = new Vector3();
    const across = new Vector3();
    const colour = new Color();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      spline.evaluatePosition(t, point);
      spline.evaluateTangent(t, across);
      across.set(across.z, 0, -across.x).normalize();
      // The bed averaged over SMOOTH samples either side.
      const window = bed.slice(Math.max(0, i - SMOOTH), i + SMOOTH + 1);
      const surface = window.reduce((sum, h) => sum + h, 0) / window.length + this.level;
      for (let j = 0; j < ACROSS; j++) {
        const side = (j / (ACROSS - 1)) * 2 - 1;
        const offset = (side * this.width) / 2;
        const x = point.x + across.x * offset;
        const z = point.z + across.z * offset;
        const y = surface - this.bank * side * side;
        const deep = y - ground(x, z);
        const k = (i * ACROSS + j) * 4;
        positions.set([x, y, z], (i * ACROSS + j) * 3);
        colour.lerpColors(this.shallow, this.deep, Math.min(Math.max(deep / this.depth, 0), 1));
        colours.set([colour.r, colour.g, colour.b, smoothstep(0, this.shore, deep) * this.opacity], k);
      }
    }
    const index: number[] = [];
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < ACROSS - 1; j++) {
        const a = i * ACROSS + j;
        const b = a + ACROSS;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colours, 4));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    this.node.geometry.dispose();
    this.node.geometry = geometry;
  }

  override onDestroy() {
    this.node.geometry.dispose();
  }
}

function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}
