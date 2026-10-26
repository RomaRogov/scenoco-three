import { Quaternion, Vector2, Vector3, type Object3D, type Texture } from 'three';
import { Behaviour, Mathf, findObjectOfType } from '@scenoco-three/core';
import type { TerrainData } from '@scenoco-three/terrain';
import { LevelController } from './LevelController';

/** The lip at the end of the slope, where the egg drops into the nest, in metres under the start. */
const LIP = -3;
/** The tallest the recipe goes: the walls and the stamps reach 10 m. */
const TOP = 10;

/**
 * The slope — the Unity game's `TerrainMesh`. The recipe is the original's: walls rising at both
 * sides, Perlin hills scaled by the level's hardness, a start pad and a funnel into the nest from two
 * greyscale stamps, and a drop off the end. The ground itself is the terrain package's: the heights
 * go into a `TerrainData`, which a `Terrain` draws and a `TerrainCollider` makes solid.
 *
 * Positions are in this node's space, as in Unity: x runs down the slope from 0 to `size.x`, z
 * across it, `size.y` wide. The node tilts the whole slope by the level's angle.
 */
export class TerrainMesh extends Behaviour {
  startTex: Texture | null = null;
  endTex: Texture | null = null;
  /** The recipe's grid: samples across, which the stamps are drawn at. */
  detail = 70;
  size = new Vector2(80, 30);
  maxHeight = 3;
  perlinScale = 0.15;
  terrainData: TerrainData | null = null;
  /** The node the ground is drawn under: placed so the data's centred ground starts at x = 0. */
  ground: Object3D | null = null;
  floor: Object3D | null = null;

  private shift = 0;
  private start_: Stamp | null = null;
  private end_: Stamp | null = null;

  private static instance: TerrainMesh;

  /** A world point's place on the slope's centre line, at its own z: where the camera follows. */
  static getPoint(pos: Vector3): Vector3 {
    const right = new Vector3(1, 0, 0).applyQuaternion(TerrainMesh.instance.node.quaternion);
    return right.multiplyScalar(pos.dot(right)).add(new Vector3(0, 0, pos.z));
  }

  /** The ground's height at a point in this node's space. */
  static getHeight(pos: Vector3): number {
    const self = TerrainMesh.instance;
    return self.terrainData!.getInterpolatedHeight(pos.x / self.size.x, (pos.z + self.size.y / 2) / self.size.y) + LIP;
  }

  /** The slope's tilt: what lies flat on it is turned this way. */
  static get tilt(): Quaternion {
    return TerrainMesh.instance.node.quaternion.clone();
  }

  /** The ground straight below a world point: where the egg is set down. */
  static groundBelow(world: Vector3): Vector3 {
    const node = TerrainMesh.instance.node;
    const hit = world.clone();
    // The slope is tilted: walk down to the ground in a few steps, each one re-aimed at it.
    for (let i = 0; i < 6; i++) {
      const local = node.worldToLocal(hit.clone());
      local.y = TerrainMesh.getHeight(local);
      hit.y = node.localToWorld(local).y;
    }
    return hit;
  }

  override awake() {
    TerrainMesh.instance = this;
    const hardness = LevelController.hardness;
    this.node.rotation.set(0, 0, (-(20 + hardness * 20) * Math.PI) / 180);
    this.maxHeight = 2 + hardness * 4;
    this.perlinScale = 0.15 + hardness * 0.1;
    this.size.x = 80 + hardness * 100;
    this.shift = LevelController.currentLevel * 180;
    this.start_ = this.startTex && stamp(this.startTex);
    this.end_ = this.endTex && stamp(this.endTex);
    this.generateTerrain();
    // The floor under the drop, 2 m below where the slope ends.
    this.node.updateMatrixWorld();
    this.floor?.position.copy(this.node.localToWorld(new Vector3(this.size.x, 0, 0))).add(new Vector3(0, -2, 0));
  }

  override start() {
    // Unity's serialized reference to the level, found instead.
    findObjectOfType(LevelController)!.init(this.size);
  }

  /** The original's height function, in metres, at a point in this node's space. */
  getHeightInternal(pos: Vector3): number {
    // Unity's z: this port flips z, and the recipe is not symmetric across it.
    const z = -pos.z + this.size.y / 2;
    const wall = Math.abs(pos.z / this.size.y) * 2;
    let perlinZ = Mathf.perlinNoise(this.shift + pos.x * this.perlinScale, z * this.perlinScale);
    let texZ = 0;
    // Where the point falls on the stamps' pixel grid — not rounded to a pixel as the original did:
    // Unity's mesh had a vertex per pixel and its triangles blended between them; this ground is
    // sampled several times finer, so it blends the pixels itself, or each one shows as a step.
    const xDet = Math.round(this.detail * (this.size.x / this.size.y)) + 1;
    const xPos = (pos.x / this.size.x) * xDet;
    const yPos = (z / this.size.y) * this.detail;
    if (this.start_ && xPos < this.start_.height) texZ = this.start_.grayscale(yPos, this.start_.height - xPos);
    if (this.end_ && xPos > xDet - this.end_.height) {
      texZ = this.end_.grayscale(yPos, xDet - xPos);
      perlinZ *= (xDet - xPos) / this.end_.height;
    }
    return Math.max(wall ** 5 * 10, perlinZ * this.maxHeight, texZ * 10);
  }

  /** The heights, into the terrain data: what Unity's GenerateMesh built a mesh from. */
  private generateTerrain() {
    const data = this.terrainData!;
    // 2^k + 1 samples down the slope, about 3 a metre — Unity's grid was 70 across.
    data.heightmapResolution = this.size.x > 120 ? 513 : 257;
    data.size = new Vector3(this.size.x, TOP - LIP, this.size.y);
    const n = data.heightmapResolution;
    const point = new Vector3();
    const rows = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => {
        // The last column drops off: the lip.
        if (c === n - 1) return 0;
        point.set((c / (n - 1)) * this.size.x, 0, -this.size.y / 2 + (r / (n - 1)) * this.size.y);
        return (this.getHeightInternal(point) - LIP) / (TOP - LIP);
      }),
    );
    data.setHeights(0, 0, rows);
    // The data's ground is centred on its node; the slope starts at x = 0, the lip at the bottom.
    this.ground?.position.set(this.size.x / 2, LIP, 0);
  }
}

/**
 * A greyscale image read as Unity's `Texture2D.GetPixel(x, y).grayscale` reads it — y from the bottom,
 * clamped at the edges (its import's wrap mode) — and between pixels, blended from the four around.
 */
interface Stamp {
  width: number;
  height: number;
  grayscale(x: number, y: number): number;
}

function stamp(texture: Texture): Stamp {
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  if (!image?.width) throw new Error('TerrainMesh: a stamp texture has no image yet — load it before the scene: await loadAssets(texture).');
  const { width, height } = image;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  const clamp = (v: number, n: number) => Math.min(Math.max(v, 0), n - 1);
  // Row 0 of the image is its top; Unity counts y from the bottom.
  const pixel = (x: number, y: number) => {
    const i = (clamp(height - 1 - y, height) * width + clamp(x, width)) * 4;
    return (0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!) / 255;
  };
  return {
    width,
    height,
    grayscale(x, y) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const top = pixel(x0, y0) * (1 - fx) + pixel(x0 + 1, y0) * fx;
      const bottom = pixel(x0, y0 + 1) * (1 - fx) + pixel(x0 + 1, y0 + 1) * fx;
      return top * (1 - fy) + bottom * fy;
    },
  };
}
