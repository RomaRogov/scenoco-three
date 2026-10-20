import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Vector3, type Material, type Mesh, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Behaviour, Model } from '@scenoco-three/core';
import { containerFor, type SplineContainer } from './SplineContainer.js';
import { FrameReader, type Frame } from './frames.js';

/** One part of the piece: its geometry in the piece's own space, and its material if it brought one. */
interface Part {
  geometry: BufferGeometry;
  material: Material | Material[] | null;
}

/**
 * Bends a modelled piece along a spline, repeated end to end to cover it, into its own mesh's
 * geometry: a road section with its kerbs and markings, a rail, a fence. Unity has no built-in for
 * this; the name is the one its best-known add-on uses.
 *
 * ```tsx
 * <Mesh receiveShadow>
 *   <SplineMesh container={track} mesh={models.roadPiece} />
 * </Mesh>
 * ```
 *
 * `mesh` is a loaded `Model` — each of its meshes bent, each keeping its material, which this mesh
 * then draws with — or a bare geometry drawn with this mesh's own material.
 *
 * The piece runs along its +Z with +Y up, as glTF exports it: `x` maps to the left of the spline,
 * `y` to its up. It bends only where it has vertices, so model a piece with edge loops along its
 * length. Copies are stretched a little so a whole number of them fills the length exactly.
 */
export class SplineMesh extends Behaviour<Mesh> {
  /** The spline: a ref to the node holding the `SplineContainer`. Left out, the one on this node. */
  container: SplineContainer | Object3D | null = null;
  /** The piece to repeat: a loaded model, or a geometry. */
  mesh: Model | BufferGeometry | null = null;
  /** How many copies; `0` fits as many as the piece's own length allows. */
  count = 0;

  override start(): void {
    this.rebuild();
  }

  /** Bend again, after the spline or the piece changed. */
  rebuild(): void {
    if (!this.mesh) throw new Error('SplineMesh has no mesh: give it mesh={models.roadPiece}, the piece to repeat.');
    const parts = partsOf(this.mesh);
    if (parts.length === 0) throw new Error('SplineMesh: the model has no meshes to bend.');
    const reader = new FrameReader(containerFor(this, this.container, 'SplineMesh'), this.node);

    // One length for the whole piece, so its parts stay in step.
    const box = new Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox!);
    }
    const pieceLength = Math.max(1e-6, box.max.z - box.min.z);
    const count = this.count > 0 ? Math.round(this.count) : Math.max(1, Math.round(reader.length / pieceLength));

    const bent = parts.map((part) => {
      const copies = Array.from({ length: count }, (_, i) => bend(part.geometry, reader, i, count, box.min.z, pieceLength));
      return mergeOrThrow(copies);
    });

    this.node.geometry.dispose();
    if (this.mesh instanceof Model) {
      // A group per part, each drawn with that part's own material.
      this.node.geometry = parts.length === 1 ? bent[0]! : mergeOrThrow(bent, true);
      const materials = parts.map((part) => (Array.isArray(part.material) ? part.material[0]! : part.material!));
      this.node.material = parts.length === 1 ? materials[0]! : materials;
    } else {
      this.node.geometry = bent[0]!;
    }
    this.node.geometry.computeBoundingSphere();
  }
}

/** A model's meshes, each in the model root's space, or a lone geometry. */
function partsOf(mesh: Model | BufferGeometry): Part[] {
  if (!(mesh instanceof Model)) return [{ geometry: mesh, material: null }];
  const root = mesh.value.scene;
  root.updateWorldMatrix(true, true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const parts: Part[] = [];
  root.traverse((object) => {
    const part = object as Mesh;
    if (!part.isMesh) return;
    const geometry = floats(part.geometry).applyMatrix4(new Matrix4().multiplyMatrices(toRoot, part.matrixWorld));
    parts.push({ geometry, material: part.material });
  });
  return parts;
}

/**
 * A copy with every attribute as plain 32-bit floats. A compressed glTF (gltfpack, KHR_mesh_quantization)
 * stores positions as normalized 16-bit integers in -1..1 and scales them up in the node's transform;
 * moved into the geometry, metres would be written back into -1..1 and clipped.
 */
function floats(geometry: BufferGeometry): BufferGeometry {
  const copy = geometry.clone();
  for (const [name, attribute] of Object.entries(copy.attributes)) {
    if (attribute.array instanceof Float32Array && !attribute.normalized && !('isInterleavedBufferAttribute' in attribute)) continue;
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) {
      for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
    }
    copy.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
  }
  return copy;
}

/** Copy `i` of `count`: every vertex moved onto the spline's frame at its place along the piece. */
function bend(piece: BufferGeometry, reader: FrameReader, i: number, count: number, startZ: number, length: number): BufferGeometry {
  const copy = piece.clone();
  const positions = copy.getAttribute('position');
  const normals = copy.getAttribute('normal');
  const bentPositions = new Float32Array(positions.count * 3);
  const bentNormals = normals ? new Float32Array(normals.count * 3) : null;
  const frame: Frame = { position: new Vector3(), forward: new Vector3(), up: new Vector3(), right: new Vector3() };
  const point = new Vector3();
  const normal = new Vector3();
  for (let v = 0; v < positions.count; v++) {
    point.fromBufferAttribute(positions, v);
    reader.at((i + (point.z - startZ) / length) / count, frame);
    // +X is left: the piece's own right-handed axes, laid on the spline's frame.
    const x = -point.x;
    bentPositions[v * 3] = frame.position.x + frame.right.x * x + frame.up.x * point.y;
    bentPositions[v * 3 + 1] = frame.position.y + frame.right.y * x + frame.up.y * point.y;
    bentPositions[v * 3 + 2] = frame.position.z + frame.right.z * x + frame.up.z * point.y;
    if (normals && bentNormals) {
      normal.fromBufferAttribute(normals, v);
      const n = frame.right.clone().multiplyScalar(-normal.x).addScaledVector(frame.up, normal.y).addScaledVector(frame.forward, normal.z).normalize();
      bentNormals.set([n.x, n.y, n.z], v * 3);
    }
  }
  copy.setAttribute('position', new Float32BufferAttribute(bentPositions, 3));
  if (bentNormals) copy.setAttribute('normal', new Float32BufferAttribute(bentNormals, 3));
  return copy;
}

function mergeOrThrow(geometries: BufferGeometry[], useGroups = false): BufferGeometry {
  const merged = mergeGeometries(geometries, useGroups);
  if (!merged) throw new Error("SplineMesh: the piece's meshes carry different attributes and could not be merged.");
  return merged;
}
