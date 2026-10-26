import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type ColorSpace,
  type Texture,
} from 'three';
import { Asset, Event } from '@scenoco-three/core';

/**
 * A ground layer — Unity's `TerrainLayer`: a texture tiled every `tileSize` metres. Made in code it
 * takes three's textures (`sharedTexture`, loaded before the terrain is drawn); read from a
 * `.terrain` file, its textures come with the file.
 *
 * `normalMapTexture` holds the normal's x and y in red and green and the layer's height in blue,
 * which the blend uses to let a taller layer show through; an ordinary normal map works, its blue
 * reading as one even height.
 */
export class TerrainLayer {
  name = '';
  /** Metres one tile covers. */
  tileSize = 10;
  diffuseTexture: Texture | null = null;
  normalMapTexture: Texture | null = null;

  constructor(init: Partial<Pick<TerrainLayer, 'name' | 'tileSize' | 'diffuseTexture' | 'normalMapTexture'>> = {}) {
    Object.assign(this, init);
  }
}

/** The ground layers on the GPU, a layer per slice. */
export interface TerrainTextures {
  /** The layers' weights: slice i holds layers 4i..4i+3 in RGBA. */
  splats: DataArrayTexture;
  /** Each layer's colour. */
  diffuse: DataArrayTexture;
  /** Each layer's normal x and y in red and green, its height in blue. */
  normal: DataArrayTexture;
}

/** Everything a terrain is, however it was made. */
interface State {
  /** Width (x), the height span (y), length (z), in metres. */
  size: Vector3;
  /** The height a normalized 0 stands for: a file's lowest point, 0 for one made in code. */
  base: number;
  heightmapResolution: number;
  /** Metres in the terrain's space, row by row from -z. */
  heights: Float32Array;
  alphamapResolution: number;
  /** Each layer's 0..255 weights, layer after layer, row by row from -z. */
  alphamaps: Uint8Array;
  terrainLayers: TerrainLayer[];
  /** The layers' colour and normal arrays: a file's, or packed from `terrainLayers` when first drawn. */
  layerTextures: Pick<TerrainTextures, 'diffuse' | 'normal'> | null;
  splats: DataArrayTexture | null;
}

interface Header {
  size: number;
  minY: number;
  maxY: number;
  heightStep: number;
  heightmapResolution: number;
  alphamapResolution: number;
  layers: { name: string; tileSize: number }[];
}

const MAGIC = 'SNCTRRN1';
/** The most layers one terrain can blend: two RGBA weight slices. */
export const MAX_TERRAIN_LAYERS = 8;

/**
 * A terrain's heights and ground layers — Unity's `TerrainData`. The ground is `size.x` by `size.z`
 * metres, centred on the terrain's node, sampled `heightmapResolution` times a side.
 *
 * Read from a `.terrain` file (the asset lab's `lab terrain`), with its layers' textures by file
 * name — what `import.meta.glob` returns: `<name>.jpg` and `<name>.normal.jpg` for every layer.
 *
 * ```ts
 * const meadow = new TerrainData(meadowUrl, import.meta.glob('./meadow/layers/*', { query: '?url', import: 'default', eager: true }));
 * await loadAssets(meadow);
 * ```
 *
 * Or made in code, as in Unity: no URL, then the resolution, the size, the heights (0..1 of
 * `size.y`, `[row][column]`) and the layers. A `Terrain` drawing it, and a `TerrainCollider`, follow
 * every change.
 *
 * ```ts
 * const data = new TerrainData();
 * data.heightmapResolution = 257;
 * data.size = new Vector3(80, 12, 30);
 * data.setHeights(0, 0, rows);
 * data.terrainLayers = [new TerrainLayer({ diffuseTexture: sharedTexture(grassUrl), tileSize: 8 })];
 * ```
 */
export class TerrainData extends Asset<State> {
  /** Raised after any change to the heights, the size or the layers. */
  readonly changed = new Event<[]>();

  private readonly textureUrls: Record<string, string> | null;

  constructor(url?: string, textures?: Record<string, string>) {
    super(url ?? 'runtime');
    this.textureUrls = textures ?? null;
    if (url === undefined) {
      const n = 33;
      this.provide({
        size: new Vector3(100, 30, 100),
        base: 0,
        heightmapResolution: n,
        heights: new Float32Array(n * n),
        alphamapResolution: 32,
        alphamaps: new Uint8Array(0),
        terrainLayers: [],
        layerTextures: null,
        splats: null,
      });
    }
  }

  /** Width (x), the height span (y) and length (z), in metres. Assign a whole vector to resize. */
  get size(): Vector3 {
    return this.value.size.clone();
  }

  set size(value: Vector3) {
    const state = this.value;
    // Heights keep their 0..1 place in the span, as in Unity.
    const scale = state.size.y > 0 ? value.y / state.size.y : 1;
    for (let i = 0; i < state.heights.length; i++) state.heights[i] = state.base + (state.heights[i]! - state.base) * scale;
    state.size.copy(value);
    this.changed.emit();
  }

  /** Samples a side: 2^k + 1 (33, 65, 129, 257, 513, 1025). Setting it flattens the ground. */
  get heightmapResolution(): number {
    return this.value.heightmapResolution;
  }

  set heightmapResolution(n: number) {
    if (!Number.isInteger(n) || n < 3 || (n - 1) & (n - 2)) {
      throw new Error(`TerrainData.heightmapResolution is 2^k + 1 samples a side (33, 65, 129, 257, 513…), not ${n}.`);
    }
    const state = this.value;
    state.heightmapResolution = n;
    state.heights = new Float32Array(n * n).fill(state.base);
    this.changed.emit();
  }

  /** Weight samples a side. Setting it gives the whole ground to the first layer. */
  get alphamapResolution(): number {
    return this.value.alphamapResolution;
  }

  set alphamapResolution(n: number) {
    this.value.alphamapResolution = n;
    this.resetWeights();
    this.changed.emit();
  }

  /** How many ground layers there are. */
  get alphamapLayers(): number {
    return this.value.terrainLayers.length;
  }

  /** The ground layers, in the order their weights are stored. Assign a whole array to change them. */
  get terrainLayers(): readonly TerrainLayer[] {
    return this.value.terrainLayers;
  }

  set terrainLayers(layers: readonly TerrainLayer[]) {
    if (layers.length > MAX_TERRAIN_LAYERS) throw new Error(`TerrainData: ${layers.length} layers, at most ${MAX_TERRAIN_LAYERS} blend.`);
    const state = this.value;
    const before = state.terrainLayers.length;
    state.terrainLayers = [...layers];
    state.layerTextures = null;
    if (before !== layers.length) this.resetWeights();
    this.changed.emit();
  }

  /** The layers' textures for drawing, or null when the layers have none. */
  get textures(): TerrainTextures | null {
    const state = this.value;
    state.layerTextures ??= this.isRuntime ? packLayers(state.terrainLayers) : null;
    if (!state.layerTextures) return null;
    state.splats ??= splatTexture(state);
    return { ...state.layerTextures, splats: state.splats };
  }

  /** The heights themselves, in metres, row by row from -z. */
  get heights(): Float32Array {
    return this.value.heights;
  }

  /** The height in metres at a sample: `x` along the row, `y` the row, clamped to the edges. */
  getHeight(x: number, y: number): number {
    const n = this.heightmapResolution;
    const c = Math.min(Math.max(Math.round(x), 0), n - 1);
    const r = Math.min(Math.max(Math.round(y), 0), n - 1);
    return this.value.heights[r * n + c]!;
  }

  /** The height in metres between samples, bilinear: `x` and `y` run 0..1 across the terrain. */
  getInterpolatedHeight(x: number, y: number): number {
    const n = this.heightmapResolution;
    const heights = this.value.heights;
    const c = Math.min(Math.max(x * (n - 1), 0), n - 1.001);
    const r = Math.min(Math.max(y * (n - 1), 0), n - 1.001);
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const fc = c - c0;
    const fr = r - r0;
    const at = (row: number, col: number) => heights[row * n + col]!;
    const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc;
    const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc;
    return top * (1 - fr) + bottom * fr;
  }

  /** The ground's normal between samples, in the terrain's space: `x` and `y` run 0..1. */
  getInterpolatedNormal(x: number, y: number, target = new Vector3()): Vector3 {
    const { size, heightmapResolution: n } = this.value;
    const d = 1 / (n - 1);
    const dx = (this.getInterpolatedHeight(x + d, y) - this.getInterpolatedHeight(x - d, y)) / (2 * d * size.x);
    const dz = (this.getInterpolatedHeight(x, y + d) - this.getInterpolatedHeight(x, y - d)) / (2 * d * size.z);
    return target.set(-dx, 1, -dz).normalize();
  }

  /** How steep the ground is there, in degrees from flat: `x` and `y` run 0..1. */
  getSteepness(x: number, y: number): number {
    return (Math.acos(Math.min(this.getInterpolatedNormal(x, y, scratch).y, 1)) * 180) / Math.PI;
  }

  /**
   * Heights from `heights[row][column]`, each 0..1 of `size.y`, written from sample `xBase` along
   * the row and row `yBase` on — as Unity's `SetHeights`. The terrain is redrawn and its collider
   * rebuilt.
   */
  setHeights(xBase: number, yBase: number, heights: ArrayLike<ArrayLike<number>>): void {
    const { heights: target, heightmapResolution: n, base, size } = this.value;
    for (let r = 0; r < heights.length; r++) {
      const row = heights[r]!;
      const y = yBase + r;
      if (y < 0 || y >= n) continue;
      for (let c = 0; c < row.length; c++) {
        const x = xBase + c;
        if (x >= 0 && x < n) target[y * n + x] = base + Math.min(Math.max(row[c]!, 0), 1) * size.y;
      }
    }
    this.changed.emit();
  }

  /** `width` × `height` samples from (`xBase`, `yBase`), each 0..1 of `size.y`: `[row][column]`. */
  getHeights(xBase: number, yBase: number, width: number, height: number): number[][] {
    const { heights, heightmapResolution: n, base, size } = this.value;
    return Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => (heights[(yBase + r) * n + xBase + c]! - base) / (size.y || 1)),
    );
  }

  /** Each layer's weight, `maps[row][column][layer]`, 0..1, written from (`x`, `y`) — Unity's `SetAlphamaps`. */
  setAlphamaps(x: number, y: number, maps: ArrayLike<ArrayLike<ArrayLike<number>>>): void {
    const state = this.value;
    const a = state.alphamapResolution;
    if (state.alphamaps.length === 0) this.resetWeights();
    for (let r = 0; r < maps.length; r++) {
      for (let c = 0; c < maps[r]!.length; c++) {
        const cell = maps[r]![c]!;
        const i = (y + r) * a + x + c;
        if (y + r < 0 || y + r >= a || x + c < 0 || x + c >= a) continue;
        for (let layer = 0; layer < state.terrainLayers.length; layer++) state.alphamaps[layer * a * a + i] = Math.round(Math.min(Math.max(cell[layer] ?? 0, 0), 1) * 255);
      }
    }
    if (state.splats) fillSplats(state, state.splats);
    this.changed.emit();
  }

  /** `width` × `height` weights from (`x`, `y`): `[row][column][layer]`, 0..1. */
  getAlphamaps(x: number, y: number, width: number, height: number): number[][][] {
    const { alphamaps, alphamapResolution: a, terrainLayers } = this.value;
    return Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => terrainLayers.map((_, layer) => (alphamaps[layer * a * a + (y + r) * a + x + c] ?? 0) / 255)),
    );
  }

  private get isRuntime(): boolean {
    return this.url === 'runtime';
  }

  /** The whole ground to the first layer. */
  private resetWeights(): void {
    const state = this.value;
    const a = state.alphamapResolution;
    state.alphamaps = new Uint8Array(state.terrainLayers.length * a * a);
    state.alphamaps.fill(255, 0, a * a);
    state.splats?.dispose();
    state.splats = null;
  }

  protected override async fetch(): Promise<State> {
    const response = await fetch(this.url);
    if (!response.ok) throw new Error(`TerrainData "${this.url}": HTTP ${response.status}`);
    const { header, heights, alphamaps } = await decode(this.url, await response.arrayBuffer());
    const state: State = {
      size: new Vector3(header.size, header.maxY - header.minY, header.size),
      base: header.minY,
      heightmapResolution: header.heightmapResolution,
      heights,
      alphamapResolution: header.alphamapResolution,
      alphamaps,
      terrainLayers: header.layers.map((l) => new TerrainLayer(l)),
      layerTextures: this.textureUrls ? await loadLayers(header, this.textureUrls) : null,
      splats: null,
    };
    return state;
  }
}

const scratch = new Vector3();

/**
 * The `.terrain` format (the lab's `write_terrain` is the other half): "SNCTRRN1", the header's
 * length as a little-endian uint32, the header as JSON, then gzip holding the heights — each sample's
 * step count minus the plane its left, upper and upper-left neighbours predict, zigzagged to uint16,
 * low bytes then high bytes — and then each layer's 0..255 weights.
 */
async function decode(url: string, buffer: ArrayBuffer): Promise<{ header: Header; heights: Float32Array; alphamaps: Uint8Array }> {
  const bytes = new Uint8Array(buffer);
  const fail = (why: string) => new Error(`TerrainData "${url}": ${why}. Write it with the asset lab's \`lab terrain\`.`);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw fail(`not a .terrain file`);
  const length = new DataView(buffer).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length))) as Header;
  if (header.layers.length > MAX_TERRAIN_LAYERS) throw fail(`${header.layers.length} layers, at most ${MAX_TERRAIN_LAYERS} blend`);
  const stream = new Blob([bytes.subarray(12 + length)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const body = new Uint8Array(await new Response(stream).arrayBuffer());
  const n = header.heightmapResolution;
  const a = header.alphamapResolution;
  if (body.length !== n * n * 2 + header.layers.length * a * a) throw fail(`its data is ${body.length} bytes, not what its header describes`);
  const heights = new Float32Array(n * n);
  const steps = new Int32Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const zigzag = body[i]! | (body[n * n + i]! << 8);
      const residual = (zigzag >>> 1) ^ -(zigzag & 1);
      const predicted = r > 0 && c > 0 ? steps[i - 1]! + steps[i - n]! - steps[i - n - 1]! : c > 0 ? steps[i - 1]! : r > 0 ? steps[i - n]! : 0;
      steps[i] = predicted + residual;
      heights[i] = header.minY + steps[i]! * header.heightStep;
    }
  }
  return { header, heights, alphamaps: body.slice(n * n * 2) };
}

/** The weights as RGBA slices, four layers to a slice: what the material samples. */
function splatTexture(state: State): DataArrayTexture {
  const a = state.alphamapResolution;
  const slices = Math.max(1, Math.ceil(state.terrainLayers.length / 4));
  const splats = new DataArrayTexture(new Uint8Array(a * a * 4 * slices), a, a, slices);
  splats.wrapS = splats.wrapT = ClampToEdgeWrapping;
  splats.minFilter = splats.magFilter = LinearFilter;
  fillSplats(state, splats);
  return splats;
}

function fillSplats(state: State, splats: DataArrayTexture): void {
  const a = state.alphamapResolution;
  const weights = splats.image.data as Uint8Array;
  state.terrainLayers.forEach((_, layer) => {
    const offset = Math.floor(layer / 4) * a * a * 4 + (layer % 4);
    for (let i = 0; i < a * a; i++) weights[offset + i * 4] = state.alphamaps[layer * a * a + i]!;
  });
  splats.needsUpdate = true;
}

/** A file's layer textures, found among `files` by the layer's name. */
async function loadLayers(header: Header, files: Record<string, string>): Promise<Pick<TerrainTextures, 'diffuse' | 'normal'>> {
  const find = (name: string, normal: boolean) => {
    const pattern = new RegExp(`(^|/)${name}${normal ? '\\.normal' : ''}\\.(jpe?g|png|webp)$`);
    const found = Object.entries(files).find(([path]) => pattern.test(path));
    if (!found) {
      throw new Error(`TerrainData: no texture for layer "${name}" (${name}${normal ? '.normal' : ''}.jpg) among ${Object.keys(files).join(', ')}`);
    }
    return found[1];
  };
  const bitmaps = (normal: boolean) =>
    Promise.all(
      header.layers.map(async (l) => {
        const url = find(l.name, normal);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`TerrainData: "${url}": HTTP ${response.status}`);
        // As stored: the normal maps are data, not colour, so no colour management.
        return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      }),
    );
  const [diffuse, normal] = await Promise.all([bitmaps(false), bitmaps(true)]);
  return { diffuse: stack(diffuse, SRGBColorSpace), normal: stack(normal) };
}

/** A runtime terrain's layers, from their three textures — loaded by now, or it says which is not. */
function packLayers(layers: readonly TerrainLayer[]): Pick<TerrainTextures, 'diffuse' | 'normal'> | null {
  if (layers.length === 0) return null;
  const image = (texture: Texture | null, layer: TerrainLayer, what: string): CanvasImageSource | null => {
    if (!texture) return null;
    const source = texture.image as (CanvasImageSource & { width?: number }) | undefined;
    if (!source || !source.width) {
      throw new Error(`TerrainLayer "${layer.name}": its ${what} has no image yet. Load it first: await loadAssets(texture).`);
    }
    return source;
  };
  const diffuse = layers.map((l) => image(l.diffuseTexture, l, 'diffuseTexture'));
  if (diffuse.some((d) => !d)) throw new Error('TerrainLayer: every layer needs a diffuseTexture to be drawn.');
  // A layer with no normal map is flat and of middling height.
  const normal = layers.map((l) => image(l.normalMapTexture, l, 'normalMapTexture') ?? FLAT);
  // In the first texture's own colour space: sRGB for a colour texture, as stored for a game that lights in gamma.
  return { diffuse: stack(diffuse as CanvasImageSource[], layers[0]!.diffuseTexture!.colorSpace as ColorSpace), normal: stack(normal) };
}

/** Stands in for a missing normal map: straight up, half height. */
const FLAT = 'flat';

/**
 * Opaque images as the slices of one tiling texture array, each drawn at the first one's size, row 0
 * at v = 0. A canvas premultiplies alpha, which would ruin anything stored there: opaque images only.
 */
function stack(images: (CanvasImageSource | typeof FLAT)[], colorSpace?: ColorSpace): DataArrayTexture {
  const first = images.find((i): i is CanvasImageSource => i !== FLAT) as (CanvasImageSource & { width: number; height: number }) | undefined;
  const width = first?.width ?? 4;
  const height = first?.height ?? 4;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(width * height * 4 * images.length);
  images.forEach((image, i) => {
    if (image === FLAT) {
      context.fillStyle = 'rgb(128, 128, 128)';
      context.fillRect(0, 0, width, height);
    } else {
      context.drawImage(image, 0, 0, width, height);
    }
    data.set(context.getImageData(0, 0, width, height).data, i * width * height * 4);
  });
  const texture = new DataArrayTexture(data, width, height, images.length);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  if (colorSpace) texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}
