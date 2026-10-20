import { BufferGeometry, Float32BufferAttribute, Vector2, type Mesh, type Object3D } from 'three';
import { Behaviour } from '@scenoco-three/core';
import { containerFor, type SplineContainer } from './SplineContainer.js';
import { FrameReader } from './frames.js';

/** A cross-section point: across (`x`, to the right) and up (`y`), its normal, and its `u` texture coordinate. */
interface ProfilePoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
  u: number;
}

/**
 * Builds its mesh's geometry along a spline — Unity's `SplineExtrude`: a tube for a pipe, a rail, a
 * cable. `'circle'` has `sides` sides; `'square'` has hard edges. A road, a track, a fence is a
 * modelled piece bent along the spline instead: `SplineMesh`.
 *
 * ```tsx
 * <Mesh>
 *   <MeshStandardMaterial color="#888" metalness={0.8} />
 *   <SplineExtrude container={track} radius={0.1} sides={12} />
 * </Mesh>
 * ```
 *
 * The texture's `v` runs along the spline in units of the diameter, so a square texture keeps its
 * aspect; repeat it with `wrapT = RepeatWrapping`.
 */
export class SplineExtrude extends Behaviour<Mesh> {
  /** The spline: a ref to the node holding the `SplineContainer`. Left out, the one on this node. */
  container: SplineContainer | Object3D | null = null;
  shape: 'circle' | 'square' = 'circle';
  /** The tube's radius. */
  radius = 0.25;
  /** The circle's sides. */
  sides = 8;
  /** Cross-sections per world unit of length. */
  segmentsPerUnit = 4;
  /** Close a tube's ends. An open spline only. */
  capped = true;
  /** The part of the spline to cover, as `t` from and to. */
  range = new Vector2(0, 1);

  override start(): void {
    this.rebuild();
  }

  /** Build the geometry again, after the spline or a setting changed. */
  rebuild(): void {
    const container = containerFor(this, this.container, 'SplineExtrude');
    const reader = new FrameReader(container, this.node);
    const profile = this.profile();
    const [from, to] = [this.range.x, this.range.y];
    const length = reader.length * Math.abs(to - from);
    const rings = Math.max(2, Math.ceil(length * this.segmentsPerUnit) + 1);
    const width = this.radius * 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let frame = reader.at(from);
    for (let i = 0; i < rings; i++) {
      const along = i / (rings - 1);
      frame = reader.at(from + (to - from) * along, frame);
      for (const p of profile) {
        const { position: o, right: r, up: n } = frame;
        positions.push(o.x + r.x * p.x + n.x * p.y, o.y + r.y * p.x + n.y * p.y, o.z + r.z * p.x + n.z * p.y);
        normals.push(r.x * p.nx + n.x * p.ny, r.y * p.nx + n.y * p.ny, r.z * p.nx + n.z * p.ny);
        uvs.push(p.u, (along * length) / width);
      }
    }
    // Quads between neighbouring rings, wound so the outside faces out.
    const stride = profile.length;
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < stride - 1; j++) {
        if (this.shape === 'square' && j % 2 === 1) continue; // between two edges' duplicated corners
        const a = i * stride + j;
        const b = a + stride;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    if (this.capped && !container.closed) {
      this.cap(reader.at(from), -1, profile, positions, normals, uvs, indices);
      this.cap(reader.at(to), 1, profile, positions, normals, uvs, indices);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    this.node.geometry.dispose();
    this.node.geometry = geometry;
  }

  private profile(): ProfilePoint[] {
    const r = this.radius;
    if (this.shape === 'square') {
      // Four edges, each with its own two corners, so each face is flat-shaded.
      const out: ProfilePoint[] = [];
      for (let e = 0; e < 4; e++) {
        const a0 = Math.PI / 4 + (e * Math.PI) / 2;
        const a1 = a0 + Math.PI / 2;
        const mid = a0 + Math.PI / 4;
        const s = r * Math.SQRT2;
        out.push(
          { x: Math.cos(a0) * s, y: Math.sin(a0) * s, nx: Math.cos(mid), ny: Math.sin(mid), u: e / 4 },
          { x: Math.cos(a1) * s, y: Math.sin(a1) * s, nx: Math.cos(mid), ny: Math.sin(mid), u: (e + 1) / 4 },
        );
      }
      return out;
    }
    const sides = Math.max(3, Math.round(this.sides));
    return Array.from({ length: sides + 1 }, (_, j) => {
      const a = (j / sides) * Math.PI * 2;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a), u: j / sides };
    });
  }

  /** A fan over a tube's end, facing back along the spline at the start and forward at the end. */
  private cap(
    frame: ReturnType<FrameReader['at']>,
    facing: 1 | -1,
    profile: ProfilePoint[],
    positions: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
  ): void {
    const { position: o, right: r, up: n, forward: f } = frame;
    const center = positions.length / 3;
    positions.push(o.x, o.y, o.z);
    normals.push(f.x * facing, f.y * facing, f.z * facing);
    uvs.push(0.5, 0.5);
    for (const p of profile) {
      positions.push(o.x + r.x * p.x + n.x * p.y, o.y + r.y * p.x + n.y * p.y, o.z + r.z * p.x + n.z * p.y);
      normals.push(f.x * facing, f.y * facing, f.z * facing);
      uvs.push(0.5 + p.x / (2 * this.radius), 0.5 + p.y / (2 * this.radius));
    }
    for (let j = 1; j < profile.length; j++) {
      if (facing < 0) indices.push(center, center + j, center + j + 1);
      else indices.push(center, center + j + 1, center + j);
    }
  }
}
