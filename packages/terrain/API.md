# API

Every public signature of `@scenoco-three/terrain`. Read this instead of `src/`. Everything not here
is three.js, as three.js documents it. Its collider is `TerrainCollider`, in `@scenoco-three/rapier`.

```ts
// ── the data: Unity's TerrainData ────────────────────────────────────────────────────────────
// From a .terrain file (the asset lab's `lab terrain`), with its layers' textures by file name —
//   export const meadow = new TerrainData(meadowUrl, { grass: grassUrl, rock: rockUrl })   then await loadAssets(meadow)
// or made in code, as in Unity: no URL, then the resolution, the size, the heights and the layers.
class TerrainData extends Asset {
  constructor(url?: string, textures?: Record<string, string>);
  readonly changed: Event<[]>;           // after any change to the heights, the size or the layers
  size: Vector3;                         // width (x), height span (y), length (z), in metres
  heightmapResolution: number;           // samples a side: 2^k + 1 — 33, 65, 129, 257, 513, 1025
  alphamapResolution: number;            // weight samples a side
  readonly alphamapLayers: number;       // how many ground layers
  terrainLayers: readonly TerrainLayer[];   // in the order their weights are stored; at most MAX_TERRAIN_LAYERS (8)
  readonly heights: Float32Array;        // metres, row by row from -z
  readonly textures: TerrainTextures | null;   // the layers on the GPU, packed when first drawn; null with no layers
  setHeights(xBase: number, yBase: number, heights: ArrayLike<ArrayLike<number>>): void;   // heights[row][column], 0..1 of size.y — Unity's SetHeights
  getHeights(xBase: number, yBase: number, width: number, height: number): number[][];     // [row][column], 0..1 of size.y
  getHeight(x: number, y: number): number;                    // metres at a sample: x along the row, y the row
  getInterpolatedHeight(x: number, y: number): number;        // metres between samples: x, y 0..1 across the terrain
  getInterpolatedNormal(x: number, y: number, target?: Vector3): Vector3;   // in the terrain's space
  getSteepness(x: number, y: number): number;                 // degrees from flat
  setAlphamaps(x: number, y: number, maps: ArrayLike<ArrayLike<ArrayLike<number>>>): void;  // maps[row][column][layer], 0..1 — Unity's SetAlphamaps
  getAlphamaps(x: number, y: number, width: number, height: number): number[][][];          // [row][column][layer]
}
class TerrainLayer {                     // Unity's: a texture tiled every tileSize metres
  constructor(init?: { name?: string; tileSize?: number; diffuseTexture?: Texture | null; normalMapTexture?: Texture | null });
  name: string;
  tileSize: number;                      // 10
  diffuseTexture: Texture | null;        // loaded before the terrain draws: sharedTexture(url) and loadAssets,
                                         // or a CanvasTexture painted in code
  normalMapTexture: Texture | null;      // none: flat
}
const MAX_TERRAIN_LAYERS = 8;
interface TerrainTextures { splats: DataArrayTexture; diffuse: DataArrayTexture; normal: DataArrayTexture }

// ── drawing it: Unity's Terrain ───────────────────────────────────────────────────────────────
class Terrain extends Behaviour {        // <Terrain terrainData={terrains.meadow} />, centred on its node
  terrainData: TerrainData | null;
  materialTemplate: Material | null;     // draw with this instead of a TerrainMaterial from the layers.
                                         // With neither — no layers yet, or under simulate — it draws plain grey
  heightmapPixelError: number;           // 5: screen pixels the drawn ground may stray from the heights; lower is more triangles
  castShadows: boolean;                  // true; it always receives them
  tileScale: number;                     // 1: every layer's tileSize times this
  sideProjection: boolean;               // true: ground steeper than 45° textured from the side, so cliffs are not stretched
  sampleHeight(worldPosition: Vector3): number;   // the ground's height under a world position — Unity's SampleHeight
  readonly triangleCount: number;        // what heightmapPixelError buys
}
// Heights, size or layers changed in code: the ground is made again before the next frame.

class TerrainMaterial extends MeshStandardMaterial {   // the layers, splatted by their weights: what Terrain draws with
  constructor(terrainData: TerrainData, parameters?: MeshStandardMaterialParameters & {
    heightBlend?: number;                // 0.25: how far a taller layer pushes through a weaker one; 0 is a plain fade
    normalScale?: number;                // 1
    sideProjection?: boolean;            // true
  });
  readonly terrainData: TerrainData;
  tileScale: number;
  sideProjection: boolean;
  refresh(): void;                       // read the layers and size again; Terrain calls it
}
```
