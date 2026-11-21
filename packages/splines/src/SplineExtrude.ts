import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3, type Mesh, type Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';
import { containerFor, type SplineContainer } from './SplineContainer.js';
import { FrameReader } from './frames.js';

/** Unity's three built-in shapes, as `IExtrudeShape.GetPosition` returns them before the radius scales them. */
const SHAPES = {
  circle: (sides: number) => Array.from({ length: sides }, (_, i) => [Math.cos((i * 2 * Math.PI) / sides), Math.sin((i * 2 * Math.PI) / sides)] as const),
  square: () => [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const,
  // Its own list read backwards, as Unity's `Road` does: right shoulder, the top, left shoulder.
  road: () => [[0.6, -0.1], [0.5, 0], [-0.5, 0], [-0.6, -0.1]] as const,
};

/**
 * Builds its mesh's geometry along a spline — Unity's `SplineExtrude`, vertex for vertex: a tube
 * for a pipe, a rail, a cable (`'circle'`, `'square'`), or a flat strip for a road (`'road'`).
 *
 * ```tsx
 * <Mesh receiveShadow>
 *   <MeshStandardMaterial map={textures.road} />
 *   <SplineExtrude container={track} shape="road" radius={12} />
 * </Mesh>
 * ```
 *
 * `radius` scales the shape: a circle's radius, a square's side, and a road's width across its top
 * — its shoulders slope a tenth of that further out and down. Texture `u` runs across (a road's
 * top is its middle third, the shoulders the outer thirds); `v` is metres along the spline, so
 * set the texture's `repeat.y` to 1 / the length it covers. Normals are smoothed across the faces.
 */
export class SplineExtrude extends Behaviour<Mesh> {
  /** The spline: a ref to the node holding the `SplineContainer`. Left out, the one on this node. */
  container: SplineContainer | Object3D | null = null;
  shape: 'circle' | 'square' | 'road' = 'circle';
  /** The circle's sides. */
  sides = 8;
  /** Rings per unit of length. */
  segmentsPerUnit = 4;
  /** Close a tube's ends. An open spline only. */
  capped = true;
  /** The shape's scale: a circle's radius, a square's side, a road's width. */
  radius = 0.25;
  /** The part of the spline to cover, as `t` from and to. */
  range = new Vector2(0, 1);
  /** Wind the faces the other way, facing in. */
  flipNormals = false;

  override start(): void {
    this.rebuild();
    this.listen(containerFor(this, this.container, 'SplineExtrude').changed, () => this.rebuild());
  }

  /** A setting changed in the editor, or the spline's node moved: built again. */
  override onValidate(): void {
    this.rebuild();
  }

  /** Build the geometry again, after the spline or a setting changed. */
  rebuild(): void {
    const container = containerFor(this, this.container, 'SplineExtrude');
    const reader = new FrameReader(container, this.node);
    const shape = this.shape === 'circle' ? SHAPES.circle(Math.max(2, Math.round(this.sides))) : SHAPES[this.shape]();
    const wrapped = this.shape !== 'road';
    const sides = shape.length; // a road's ends don't meet: its 3 faces take 4 points
    const from = Math.min(this.range.x, this.range.y);
    const to = Math.max(this.range.x, this.range.y);
    const length = reader.length;
    const segments = Math.max(2, Math.ceil(length * (to - from) * this.segmentsPerUnit));
    const closed = container.closed && Math.abs(1 - (to - from)) < Number.EPSILON;
    const capped = this.capped && !container.closed;
    const flip = this.flipNormals;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const ring = (segment: number, caps: boolean) => {
      const t = from + (to - from) * (segment / (segments - 1));
      const { position: o, right: r, up: n } = reader.at(container.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t)));
      for (let k = 0; k < sides; k++) {
        const index = flip ? sides - k - 1 : k;
        const [sx, sy] = shape[index]!;
        const [x, y] = [sx * this.radius, sy * this.radius];
        positions.push(o.x + r.x * x + n.x * y, o.y + r.y * x + n.y * y, o.z + r.z * x + n.z * y);
        if (caps) uvs.push(sx / 2, sy / 2);
        else if (wrapped) {
          const ut = index / (sides + (sides % 2));
          uvs.push(1 - Math.abs(ut - Math.floor(ut + 0.5)) * 2, t * length);
        } else uvs.push(1 - index / (sides - 1), t * length);
      }
    };
    for (let i = 0; i < segments; i++) ring(i, false);

    // Unity winds clockwise in its left-handed space; the same faces here are counter-clockwise.
    const faces = wrapped ? sides : sides - 1;
    for (let i = 0; i < (closed ? segments : segments - 1); i++) {
      for (let k = 0; k < faces; k++) {
        const a = i * sides + k;
        const b = i * sides + ((k + 1) % sides);
        const c = ((i + 1) % segments) * sides + k;
        const d = ((i + 1) % segments) * sides + ((k + 1) % sides);
        indices.push(a, c, b, b, c, d);
      }
    }
    if (capped) {
      const start = segments * sides;
      const end = start + sides;
      ring(0, true);
      ring(segments - 1, true);
      for (let k = 0; k < sides - 2; k++) indices.push(start, start + k + 1, start + k + 2, end, end + k + 2, end + k + 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(smoothNormals(positions, indices, closed ? sides : 0, segments), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    this.node.geometry.dispose();
    this.node.geometry = geometry;
  }
}

/**
 * Unity's `AutosmoothNormals` at its 180° angle: each vertex the mean of its triangles' unit
 * normals; on a closed spline the first and last rings, which meet, then share theirs.
 */
function smoothNormals(positions: number[], indices: number[], seamSides: number, segments: number): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  const [a, b, c, ab, ac] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  for (let i = 0; i < indices.length; i += 3) {
    const [ia, ib, ic] = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    a.fromArray(positions, ia * 3);
    b.fromArray(positions, ib * 3);
    c.fromArray(positions, ic * 3);
    const face = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
    for (const v of [ia, ib, ic]) for (let j = 0; j < 3; j++) normals[v * 3 + j]! += face.getComponent(j);
  }
  const n = new Vector3();
  const norm = (v: number) => n.fromArray(normals, v * 3).normalize().toArray(normals, v * 3);
  for (let v = 0; v < positions.length / 3; v++) norm(v);
  const last = (segments - 1) * seamSides;
  for (let k = 0; k < seamSides; k++) {
    n.fromArray(normals, k * 3).add(new Vector3().fromArray(normals, (last + k) * 3)).normalize();
    n.toArray(normals, k * 3);
    n.toArray(normals, (last + k) * 3);
  }
  return normals;
}
