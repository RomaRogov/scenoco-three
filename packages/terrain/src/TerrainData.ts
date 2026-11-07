import {
  ClampToEdgeWrapping,
  Color,
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
 * A ground layer — Unity's `TerrainLayer`: a texture tiled every `tileSize` metres, or, with no
 * texture, a plain `color`. Made in code it takes three's textures (`sharedTexture`, loaded before
 * the terrain is drawn, or a `DataTexture`/`CanvasTexture`); read from a `.terrain` file, its textures
 * come with the file.
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
  /** What the layer is with no `diffuseTexture`. */
  color = new Color(0x808080);
  normalMapTexture: Texture | null = null;

  constructor(init: Partial<Pick<TerrainLayer, 'name' | 'tileSize' | 'diffuseTexture' | 'color' | 'normalMapTexture'>> = {}) {
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
  /** Metres along x and along z. */
  width: number;
  depth: number;
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
 * A terrain's heights and ground layers. The ground is `width` by `depth` metres, centred on the
 * terrain's node, sampled `heightmapResolution` times a side. Everything is in metres in the
 * terrain's own space: x and z from its centre, heights from its node.
 *
 * Made in code from a height function — the same one the game can call to place things:
 *
 * ```ts
 * export const hill = (x: number, z: number) => 4 * Math.exp(-(x * x + z * z) / 200);
 * export const ground = new TerrainData();
 * ground.width = 80;
 * ground.depth = 60;
 * ground.heightmapResolution = 129;
 * ground.setHeights(hill);
 * ```
 *
 * Or read from a `.terrain` file (the asset lab's `lab terrain`), with its layers' textures by file
 * name — what `import.meta.glob` returns: `<name>.jpg` and `<name>.normal.jpg` for every layer — and
 * then `await loadAssets(meadow)`.
 *
 * A `Terrain` drawing it and a `TerrainCollider` follow every change. A Unity export writes it as
 * Unity's own `TerrainData`, in Unity's units.
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
        width: 100,
        depth: 100,
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

  /** Metres along x. The samples stretch with it. */
  get width(): number {
    return this.value.width;
  }

  set width(metres: number) {
    this.value.width = metres;
    this.changed.emit();
  }

  /** Metres along z. The samples stretch with it. */
  get depth(): number {
    return this.value.depth;
  }

  set depth(metres: number) {
    this.value.depth = metres;
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
    state.heights = new Float32Array(n * n);
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

  /** The heights themselves, in metres, row by row from -z. After writing them, `setHeights()` redraws. */
  get heights(): Float32Array {
    return this.value.heights;
  }

  /**
   * Every sample's height from `height(x, z)`, in metres, x and z in metres from the centre. With
   * no function, the heights written into `heights` are taken as they are. The terrain is redrawn
   * and its collider rebuilt.
   */
  setHeights(height?: (x: number, z: number) => number): void {
    const { heights, heightmapResolution: n, width, depth } = this.value;
    if (height) {
      for (let r = 0; r < n; r++) {
        const z = -depth / 2 + (r * depth) / (n - 1);
        for (let c = 0; c < n; c++) heights[r * n + c] = height(-width / 2 + (c * width) / (n - 1), z);
      }
    }
    this.changed.emit();
  }

  /** The ground's height in metres at (x, z), metres from the centre: between samples, bilinear; clamped at the edges. */
  heightAt(x: number, z: number): number {
    const { heights, heightmapResolution: n, width, depth } = this.value;
    const c = Math.min(Math.max((x / width + 0.5) * (n - 1), 0), n - 1.001);
    const r = Math.min(Math.max((z / depth + 0.5) * (n - 1), 0), n - 1.001);
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const fc = c - c0;
    const fr = r - r0;
    const at = (row: number, col: number) => heights[row * n + col]!;
    const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc;
    const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc;
    return top * (1 - fr) + bottom * fr;
  }

  /** The ground's normal at (x, z), metres from the centre, in the terrain's space. */
  normalAt(x: number, z: number, target = new Vector3()): Vector3 {
    const { width, depth, heightmapResolution: n } = this.value;
    const dx = width / (n - 1);
    const dz = depth / (n - 1);
    const sx = (this.heightAt(x + dx, z) - this.heightAt(x - dx, z)) / (2 * dx);
    const sz = (this.heightAt(x, z + dz) - this.heightAt(x, z - dz)) / (2 * dz);
    return target.set(-sx, 1, -sz).normalize();
  }

  /** How steep the ground is at (x, z), metres from the centre: degrees from flat. */
  steepnessAt(x: number, z: number): number {
    return (Math.acos(Math.min(this.normalAt(x, z, scratch).y, 1)) * 180) / Math.PI;
  }

  /**
   * Each layer's weight at every alphamap sample from `weights(x, z)`, metres from the centre: one
   * number per layer, in `terrainLayers` order, normalized where they do not add up to 1.
   * `heightAt` and `steepnessAt` there are the usual reasons.
   */
  setAlphamaps(weights: (x: number, z: number) => ArrayLike<number>): void {
    const state = this.value;
    const a = state.alphamapResolution;
    const layers = state.terrainLayers.length;
    if (state.alphamaps.length !== layers * a * a) this.resetWeights();
    for (let r = 0; r < a; r++) {
      const z = -state.depth / 2 + ((r + 0.5) * state.depth) / a;
      for (let c = 0; c < a; c++) {
        const w = weights(-state.width / 2 + ((c + 0.5) * state.width) / a, z);
        let sum = 0;
        for (let l = 0; l < layers; l++) sum += Math.max(w[l] ?? 0, 0);
        for (let l = 0; l < layers; l++) state.alphamaps[l * a * a + r * a + c] = Math.round((sum > 0 ? Math.max(w[l] ?? 0, 0) / sum : l === 0 ? 1 : 0) * 255);
      }
    }
    if (state.splats) fillSplats(state, state.splats);
    this.changed.emit();
  }

  /** Each layer's weight, 0..255, at every alphamap sample, layer after layer, row by row from -z. */
  get alphamaps(): Uint8Array {
    return this.value.alphamaps;
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

  /** What a Unity export reads: the heights in metres and the layers, as plain data. */
  [Symbol.for('scenoco.snapshot')](): Record<string, unknown> {
    const s = this.value;
    return {
      width: s.width,
      depth: s.depth,
      heightmapResolution: s.heightmapResolution,
      heights: Array.from(s.heights, (h) => Math.round(h * 1e4) / 1e4),
      alphamapResolution: s.alphamapResolution,
      alphamaps: Array.from(s.alphamaps),
      terrainLayers: s.terrainLayers.map((l) => ({ name: l.name, tileSize: l.tileSize, color: l.color, textured: !!(l.diffuseTexture ?? this.textureUrls) })),
    };
  }

  protected override async fetch(): Promise<State> {
    const response = await fetch(this.url);
    if (!response.ok) throw new Error(`TerrainData "${this.url}": HTTP ${response.status}`);
    const { header, heights, alphamaps } = await decode(this.url, await response.arrayBuffer());
    const state: State = {
      width: header.size,
      depth: header.size,
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

/** A runtime terrain's layers, from their three textures — loaded by now, or it says which is not — or their colours. */
function packLayers(layers: readonly TerrainLayer[]): Pick<TerrainTextures, 'diffuse' | 'normal'> | null {
  if (layers.length === 0) return null;
  const image = (texture: Texture | null, layer: TerrainLayer, what: string): CanvasImageSource | null => {
    if (!texture) return null;
    const source = texture.image as (CanvasImageSource & { width?: number }) | undefined;
    if (!source || !source.width) {
      throw new Error(`TerrainLayer "${layer.name}": its ${what} has no image yet. Load it first: await loadAssets(texture).`);
    }
    return pixels(source) ?? source;
  };
  const diffuse = layers.map((l) => image(l.diffuseTexture, l, 'diffuseTexture') ?? `#${l.color.getHexString(SRGBColorSpace)}`);
  // A layer with no normal map is flat and of middling height.
  const normal = layers.map((l) => image(l.normalMapTexture, l, 'normalMapTexture') ?? FLAT);
  // In the first texture's own colour space: sRGB for a colour texture, as stored for a game that lights in gamma.
  const textured = layers.find((l) => l.diffuseTexture);
  return { diffuse: stack(diffuse, (textured?.diffuseTexture?.colorSpace as ColorSpace | undefined) ?? SRGBColorSpace), normal: stack(normal) };
}

/** A texture made in code — a `DataTexture`'s RGBA bytes — onto a canvas, so it packs like a loaded image. */
function pixels(source: object): OffscreenCanvas | null {
  const { data, width, height } = source as { data?: ArrayLike<number>; width?: number; height?: number };
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || !width || !height) return null;
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/** Stands in for a missing normal map: straight up, half height. */
const FLAT = 'rgb(128, 128, 128)';

/**
 * Opaque images, or CSS colours, as the slices of one tiling texture array, each drawn at the first one's size, row 0
 * at v = 0. A canvas premultiplies alpha, which would ruin anything stored there: opaque images only.
 */
function stack(images: (CanvasImageSource | string)[], colorSpace?: ColorSpace): DataArrayTexture {
  const first = images.find((i): i is CanvasImageSource => typeof i !== 'string') as (CanvasImageSource & { width: number; height: number }) | undefined;
  const width = first?.width ?? 4;
  const height = first?.height ?? 4;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(width * height * 4 * images.length);
  images.forEach((image, i) => {
    if (typeof image === 'string') {
      context.fillStyle = image;
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
