import Martini, { type MartiniTile } from '@mapbox/martini';
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Sphere,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import { Behaviour, Screen } from '@scenoco-three/core';
import type { TerrainData } from './TerrainData.js';
import { TerrainMaterial } from './TerrainMaterial.js';

/** Cells a chunk side: each chunk picks its own detail. */
const CHUNK = 64;
/** The detail levels: the most a level's surface strays from the heights, in metres. */
const LEVEL_ERRORS = [0.02, 0.08, 0.32, 1.28, 5.12, 20.48];

interface Chunk {
  mesh: Mesh;
  /** Martini's error tree over this chunk's samples, made once. */
  tile: MartiniTile;
  /** Built on first use, one geometry per level. */
  levels: (BufferGeometry | undefined)[];
  /** Where the chunk is, in the terrain's space. */
  bounds: Sphere;
  column: number;
  row: number;
}

/**
 * Draws a `TerrainData` under its node — Unity's `Terrain`. The ground is split into chunks of 64
 * cells, and every frame each chunk draws the coarsest mesh whose error stays under
 * `heightmapPixelError` pixels on screen from where the camera is: full detail near it, a few
 * triangles far away and on flat ground (Martini's right-triangulated irregular networks). A
 * chunk's edges are drawn as full detail draws them at every level, so neighbours meet exactly.
 *
 * ```tsx
 * <Group scale={0.25}>
 *   <Terrain terrainData={terrains.meadow} />
 * </Group>
 * ```
 *
 * The data has to be loaded first — `await loadAssets(terrains.meadow)` — and centres on the node.
 * It draws with a `TerrainMaterial` made from the data's layers, or with `materialTemplate`.
 */
export class Terrain extends Behaviour {
  terrainData: TerrainData | null = null;
  /** The material to draw with instead of a `TerrainMaterial` made from the data's layers. */
  materialTemplate: Material | null = null;
  /** How far, in screen pixels, the drawn ground may stray from the heights: lower is more triangles. */
  heightmapPixelError = 5;
  /** Whether the ground casts shadows. It always receives them. */
  castShadows = true;
  /** Every layer's tile size times this — above 1 each texture repeats less often. Not for a `materialTemplate`. */
  tileScale = 1;
  /**
   * Whether ground steeper than 45° is textured from the side, so cliffs are not stretched. It reads
   * no more textures than flat ground — the cost is a few sums a pixel — so it is on unless a seam
   * where a slope crosses 45° shows.
   */
  sideProjection = true;

  private chunks: Chunk[] = [];
  private ownMaterial: TerrainMaterial | null = null;
  private dirty = false;

  override awake() {
    const data = this.terrainData;
    if (!data) throw new Error('Terrain needs terrainData={…}: a TerrainData, loaded with loadAssets.');
    this.ownMaterial = this.materialTemplate ? null : new TerrainMaterial(data, { sideProjection: this.sideProjection });
    this.applyLook();
    this.makeChunks();
    // Heights, size or layers changed in code: the ground is made again, as Unity's terrain follows
    // its data — once, before the next frame is drawn, however many changes came first.
    this.listen(data.changed, () => (this.dirty = true));
  }

  /** The chunks, from the data as it is now. */
  private makeChunks() {
    const data = this.terrainData!;
    const n = data.heightmapResolution;
    const cells = n - 1;
    if (cells & (cells - 1) || cells < 2) {
      throw new Error(`Terrain: "${data.url}" is ${n} samples a side; level of detail needs 2^k + 1 (257, 513…). Write it again with the asset lab's \`lab terrain\`.`);
    }
    this.clear();
    const material = this.materialTemplate ?? this.ownMaterial!;
    const chunk = Math.min(CHUNK, cells);
    const martini = martiniFor(chunk + 1);
    const size = data.size;
    const stepX = size.x / cells;
    const stepZ = size.z / cells;
    for (let row = 0; row < cells / chunk; row++) {
      for (let column = 0; column < cells / chunk; column++) {
        const samples = new Float32Array((chunk + 1) ** 2);
        let low = Infinity;
        let high = -Infinity;
        for (let y = 0; y <= chunk; y++) {
          for (let x = 0; x <= chunk; x++) {
            const h = data.heights[(row * chunk + y) * n + column * chunk + x]!;
            samples[y * (chunk + 1) + x] = h;
            low = Math.min(low, h);
            high = Math.max(high, h);
          }
        }
        const halfX = (chunk * stepX) / 2;
        const halfZ = (chunk * stepZ) / 2;
        const centre = new Vector3(-size.x / 2 + column * chunk * stepX + halfX, (low + high) / 2, -size.z / 2 + row * chunk * stepZ + halfZ);
        const mesh = new Mesh(undefined, material);
        mesh.name = `chunk ${column},${row}`;
        mesh.receiveShadow = true;
        this.node.add(mesh);
        this.chunks.push({
          mesh,
          tile: martini.createTile(samples),
          levels: [],
          bounds: new Sphere(centre, Math.hypot(halfX, halfZ, (high - low) / 2)),
          column,
          row,
        });
      }
    }
    sealEdges(this.chunks, cells / chunk, chunk + 1);
    this.lateUpdate();
  }

  /** The chunks gone: their meshes off the node, their geometries freed. */
  private clear() {
    for (const chunk of this.chunks) {
      chunk.mesh.removeFromParent();
      chunk.levels.forEach((g) => g?.dispose());
    }
    this.chunks = [];
  }

  /** `tileScale` and `sideProjection` onto the material: they can change while the game runs. */
  private applyLook() {
    if (!this.ownMaterial) return;
    this.ownMaterial.tileScale = this.tileScale;
    this.ownMaterial.sideProjection = this.sideProjection;
  }

  override onValidate() {
    this.applyLook();
  }

  override lateUpdate() {
    this.applyLook();
    if (this.dirty) {
      this.dirty = false;
      this.ownMaterial?.refresh();
      this.makeChunks();
      return;
    }
    const camera = this.drawingCamera();
    const scale = this.node.getWorldScale(scratch).x;
    // Once a frame, not once a chunk: where the camera is, and how many pixels a metre covers a unit away.
    const eye = camera ? camera.getWorldPosition(scratch2) : null;
    const pixelsAtOne = camera ? pixelsPerUnit(camera, 1) : 0;
    const flat = camera instanceof OrthographicCamera;
    for (const chunk of this.chunks) {
      chunk.mesh.castShadow = this.castShadows;
      let level = 0;
      if (eye) {
        const centre = this.node.localToWorld(scratch.copy(chunk.bounds.center));
        const distance = Math.max(centre.distanceTo(eye) - chunk.bounds.radius * scale, 1e-3);
        const pixelsPerMetre = (flat ? pixelsAtOne : pixelsAtOne / distance) * scale;
        while (level + 1 < LEVEL_ERRORS.length && LEVEL_ERRORS[level + 1]! * pixelsPerMetre <= this.heightmapPixelError) level++;
      }
      const geometry = (chunk.levels[level] ??= this.build(chunk, level));
      if (chunk.mesh.geometry !== geometry) chunk.mesh.geometry = geometry;
    }
  }

  override onDestroy() {
    // The geometries and a material made here are this terrain's; the textures are the data's.
    this.clear();
    this.ownMaterial?.dispose();
  }

  /** The ground's height under a world position, in world units relative to the terrain's own height. */
  sampleHeight(worldPosition: Vector3): number {
    const data = this.terrainData!;
    const local = this.node.worldToLocal(scratch.copy(worldPosition));
    const size = data.size;
    local.y = data.getInterpolatedHeight(local.x / size.x + 0.5, local.z / size.z + 0.5);
    const ground = this.node.localToWorld(local).y;
    return ground - this.node.getWorldPosition(scratch).y;
  }

  /** How many triangles the chunks draw now: what `heightmapPixelError` buys. */
  get triangleCount(): number {
    return this.chunks.reduce((sum, c) => sum + (c.mesh.geometry.index?.count ?? 0) / 3, 0);
  }

  private drawingCamera(): Camera | null {
    try {
      return this.camera;
    } catch {
      return null; // not in a running scene yet: full detail
    }
  }

  /** A chunk's mesh at a level: Martini's triangles, normals from the full heights. */
  private build(chunk: Chunk, level: number): BufferGeometry {
    const data = this.terrainData!;
    const n = data.heightmapResolution;
    const cells = n - 1;
    const size = Math.min(CHUNK, cells);
    const { x: sizeX, z: sizeZ } = data.size;
    const stepX = sizeX / cells;
    const stepZ = sizeZ / cells;
    const { vertices, triangles } = chunk.tile.getMesh(LEVEL_ERRORS[level]);
    const count = vertices.length / 2;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const height = (gx: number, gy: number) => data.heights[Math.min(Math.max(gy, 0), cells) * n + Math.min(Math.max(gx, 0), cells)]!;
    for (let i = 0; i < count; i++) {
      const gx = chunk.column * size + vertices[i * 2]!;
      const gy = chunk.row * size + vertices[i * 2 + 1]!;
      positions.set([-sizeX / 2 + gx * stepX, height(gx, gy), -sizeZ / 2 + gy * stepZ], i * 3);
      // From the full heights, not the simplified mesh: the light does not jump when the detail does.
      const nx = (height(gx - 1, gy) - height(gx + 1, gy)) / (2 * stepX);
      const nz = (height(gx, gy - 1) - height(gx, gy + 1)) / (2 * stepZ);
      const length = Math.hypot(nx, 1, nz);
      normals.set([nx / length, 1 / length, nz / length], i * 3);
    }
    // Martini's grid y is the terrain's z, which makes its triangles face up as they are.
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(triangles, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const scratch = new Vector3();
const scratch2 = new Vector3();
const martinis = new Map<number, Martini>();

/**
 * Neighbours of different detail meet exactly: on an edge two chunks share, a sample is kept at
 * every level when full detail keeps it on either side, and dropped at every level otherwise — so
 * both draw the same edge, whatever their levels. Errors are only raised, then carried up by
 * Martini's own pass again, so each chunk's triangles still fit together.
 */
function sealEdges(chunks: Chunk[], perSide: number, side: number): void {
  const last = side - 1;
  const at = (column: number, row: number) => chunks[row * perSide + column]?.tile;
  const seal = (a: MartiniTile, b: MartiniTile, inA: (i: number) => number, inB: (i: number) => number) => {
    for (let i = 1; i < last; i++) {
      if (Math.max(a.errors[inA(i)]!, b.errors[inB(i)]!) > LEVEL_ERRORS[0]!) a.errors[inA(i)] = b.errors[inB(i)] = Infinity;
    }
  };
  for (let row = 0; row < perSide; row++) {
    for (let column = 0; column < perSide; column++) {
      const tile = at(column, row)!;
      // Its right edge is the next one's left; its far edge, the next row's near one.
      if (column + 1 < perSide) seal(tile, at(column + 1, row)!, (i) => i * side + last, (i) => i * side);
      if (row + 1 < perSide) seal(tile, at(column, row + 1)!, (i) => last * side + i, (i) => i);
    }
  }
  for (const chunk of chunks) chunk.tile.update();
}

function martiniFor(gridSize: number): Martini {
  let martini = martinis.get(gridSize);
  if (!martini) martinis.set(gridSize, (martini = new Martini(gridSize)));
  return martini;
}

/** Screen pixels a world unit covers at a distance: the viewport's height over what the camera sees there. */
function pixelsPerUnit(camera: Camera, distance: number): number {
  const screen = Screen.height;
  if (camera instanceof PerspectiveCamera) return screen / (2 * distance * Math.tan((camera.fov * Math.PI) / 360) / camera.zoom);
  if (camera instanceof OrthographicCamera) return (screen * camera.zoom) / (camera.top - camera.bottom);
  return screen / (2 * distance);
}
