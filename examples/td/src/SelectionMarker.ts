import { Box3, BufferAttribute, BufferGeometry, Euler, Mesh, Vector3, type MeshBasicMaterial } from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { Behaviour, findObjectOfType } from '@scenoco-three/core';
import { Terrain, TerrainMaterial } from '@scenoco-three/terrain';

/** Straight down: a projector's -z along the world's -y. */
const DOWN = new Euler(-Math.PI / 2, 0, 0);
/** Units above and below the tower the projection reaches: hills and dips in range still take it. */
const DEPTH = 24;

/**
 * The selected tower's reach, projected onto the ground with three's `DecalGeometry`: the disc and
 * its edge follow every slope. The terrain is drawn in chunks, each mesh swapped as its detail
 * changes, so there is a decal per chunk in range, cut again only when its chunk's mesh changes.
 * The decals are in world space, so the node stays at the scene's origin.
 */
export class SelectionMarker extends Behaviour {
  /** The disc and edge: a texture with the reach's whole width across it, clear past its edge. */
  material: MeshBasicMaterial | null = null;

  private readonly at = new Vector3();
  private radius = 0;
  private shown = 0;
  private time = 0;
  /** Each chunk in range: the geometry it was cut from, and its decal. */
  private readonly decals = new Map<Mesh, { from: BufferGeometry; decal: Mesh }>();

  override awake() {
    this.node.visible = false;
  }

  /** Show `radius` units of reach around a point on the ground. */
  show(at: Vector3, radius: number) {
    const moved = !this.at.equals(at) || this.radius !== radius;
    this.at.copy(at);
    this.radius = radius;
    if (moved) this.clear();
    if (!this.node.visible) this.shown = 0;
    this.node.visible = true;
    this.project();
  }

  hide() {
    this.node.visible = false;
    this.clear();
  }

  override update(dt: number) {
    if (!this.node.visible) return;
    this.project();
    this.time += dt;
    // Grows out to its radius, then breathes: the texture is scaled, the decals stay as cut.
    this.shown = Math.min(1, this.shown + dt * 5);
    const ease = 1 - Math.pow(1 - this.shown, 3);
    const map = this.material?.map;
    if (map) {
      const scale = 1 / Math.max(ease * (1 + Math.sin(this.time * 3) * 0.01), 0.01);
      map.repeat.set(scale, scale);
      map.offset.set(0.5 - scale / 2, 0.5 - scale / 2);
    }
  }

  override onDestroy() {
    this.clear();
  }

  /** A decal on every chunk the reach touches; one whose chunk changed its mesh is cut again. */
  private project() {
    const terrain = findObjectOfType(Terrain);
    if (!terrain || !this.material) return;
    const size = new Vector3(this.radius * 2, this.radius * 2, DEPTH * 2);
    const reach = new Box3().setFromCenterAndSize(this.at, size.clone().set(size.x, DEPTH * 2, size.y));
    const box = new Box3();
    for (const chunk of terrain.node.children) {
      if (!(chunk instanceof Mesh) || !(chunk.material instanceof TerrainMaterial)) continue;
      const had = this.decals.get(chunk);
      if (had?.from === chunk.geometry) continue;
      if (had) this.drop(chunk);
      if (!chunk.geometry.boundingBox) chunk.geometry.computeBoundingBox();
      if (!box.copy(chunk.geometry.boundingBox!).applyMatrix4(chunk.matrixWorld).intersectsBox(reach)) continue;
      const decal = new Mesh(facingUp(new DecalGeometry(chunk, this.at, DOWN, size)), this.material);
      decal.renderOrder = 2;
      this.node.add(decal);
      this.decals.set(chunk, { from: chunk.geometry, decal });
    }
  }

  private drop(chunk: Mesh) {
    const had = this.decals.get(chunk);
    if (!had) return;
    had.decal.removeFromParent();
    had.decal.geometry.dispose();
    this.decals.delete(chunk);
  }

  private clear() {
    for (const chunk of [...this.decals.keys()]) this.drop(chunk);
  }
}

/**
 * Only the decal's triangles that face up. A chunk hides its seams with skirts hanging straight
 * down from its edges; projected from above they take the picture too, and show as a line.
 */
function facingUp(geometry: BufferGeometry): BufferGeometry {
  // By the triangle's own face: a skirt's corners carry the ground's normals, which point up.
  const position = geometry.getAttribute('position');
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  const keep: number[] = [];
  for (let v = 0; v < position.count; v += 3) {
    a.fromBufferAttribute(position, v);
    b.fromBufferAttribute(position, v + 1).sub(a);
    c.fromBufferAttribute(position, v + 2).sub(a);
    if (Math.abs(b.cross(c).normalize().y) > 0.3) keep.push(v, v + 1, v + 2);
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) {
    const source = geometry.getAttribute(name);
    const data = new Float32Array(keep.length * source.itemSize);
    keep.forEach((v, i) => {
      for (let k = 0; k < source.itemSize; k++) data[i * source.itemSize + k] = source.array[v * source.itemSize + k]!;
    });
    out.setAttribute(name, new BufferAttribute(data, source.itemSize));
  }
  geometry.dispose();
  return out;
}
