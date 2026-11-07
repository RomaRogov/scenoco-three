# API

Every public signature of `@scenoco-three/terrain`. Read this instead of `src/`. Everything not here
is three.js, as three.js documents it. Its collider is `TerrainCollider`, in `@scenoco-three/rapier`.

```ts
// ── the data ─────────────────────────────────────────────────────────────────────────────────
// Everything in metres in the terrain's own space: x and z from its centre, heights from its node.
// Made in code from a height function — the same one the game calls to place things on the ground:
//   export const ground = new TerrainData();  ground.width = 80;  ground.depth = 60;  ground.setHeights(hill);
// or from a .terrain file (the asset lab's `lab terrain`), its layers' textures by file name:
//   export const meadow = new TerrainData(meadowUrl, { grass: grassUrl, rock: rockUrl })   then await loadAssets(meadow)
// A Unity export writes it as Unity's TerrainData, in Unity's units.
class TerrainData extends Asset {
  constructor(url?: string, textures?: Record<string, string>);
  readonly changed: Event<[]>;           // after any change to the heights, the size or the layers
  width: number;                         // 100: metres along x
  depth: number;                         // 100: metres along z
  heightmapResolution: number;           // 33: samples a side, 2^k + 1 — 33, 65, 129, 257, 513, 1025; setting it flattens
  readonly heights: Float32Array;        // metres, row by row from -z
  setHeights(height?: (x: number, z: number) => number): void;   // every sample from height(x, z); none: `heights` as written
  heightAt(x: number, z: number): number;                        // metres, between samples
  normalAt(x: number, z: number, target?: Vector3): Vector3;     // in the terrain's space
  steepnessAt(x: number, z: number): number;                     // degrees from flat
  terrainLayers: readonly TerrainLayer[];   // at most MAX_TERRAIN_LAYERS (8); with none it draws plain grey
  alphamapResolution: number;            // 32: weight samples a side
  setAlphamaps(weights: (x: number, z: number) => ArrayLike<number>): void;   // a weight per layer at (x, z), normalized
  readonly alphamaps: Uint8Array;        // 0..255, layer after layer, row by row from -z
  readonly textures: TerrainTextures | null;   // the layers on the GPU, packed when first drawn
}
class TerrainLayer {                     // Unity's: a texture tiled every tileSize metres, or a plain colour
  constructor(init?: { name?: string; tileSize?: number; diffuseTexture?: Texture | null; color?: Color; normalMapTexture?: Texture | null });
  name: string;
  tileSize: number;                      // 10
  diffuseTexture: Texture | null;        // loaded before the terrain draws: sharedTexture(url) and loadAssets, or made in code
  color: Color;                          // #808080: the layer with no diffuseTexture
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
