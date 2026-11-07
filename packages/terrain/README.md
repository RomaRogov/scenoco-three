# @scenoco-three/terrain

Ground from a heightmap, textured by layers, in the shape of Unity's terrain. Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```bash
npm install @scenoco-three/terrain
```

Everything is in metres: x and z from the terrain's centre, heights from its node. Made in code from
a height function — the same one the game can call to place things on the ground:

```ts
// ground.ts
export const hill = (x: number, z: number) => 4 * Math.exp(-(x * x + z * z) / 200);
export const ground = new TerrainData();
ground.width = 80;                              // metres along x
ground.depth = 80;                              // metres along z
ground.heightmapResolution = 129;               // 2^k + 1 samples a side
ground.setHeights(hill);
ground.terrainLayers = [
  new TerrainLayer({ diffuseTexture: sharedTexture(grassUrl), tileSize: 2 }),
  new TerrainLayer({ color: new Color('#8a8070') }),       // no texture: a plain colour
];
ground.setAlphamaps((x, z) => (ground.steepnessAt(x, z) > 30 ? [0, 1] : [1, 0]));
```

```tsx
<Group>
  <Terrain terrainData={ground} />
  <TerrainCollider terrainData={ground} />      {/* @scenoco-three/rapier */}
</Group>
```

Or loaded from a `.terrain` file, its layer textures found by name among the URLs given:

```ts
export const meadow = new TerrainData(meadowUrl, import.meta.glob('./meadow/layers/*', { query: '?url', import: 'default', eager: true }));
// main.ts: await loadAssets(meadow);
```

- `TerrainData` — the heights and each layer's weights: `setHeights`/`getHeights`,
  `setAlphamaps`/`getAlphamaps`, `getInterpolatedHeight`, `getInterpolatedNormal`, `getSteepness`,
  `size`, `heightmapResolution`, `alphamapResolution`, `terrainLayers`, and a `changed` event after
  any edit. Up to 8 layers.
- `TerrainLayer` — a texture tiled every `tileSize` metres, with an optional normal map whose blue
  channel can carry the layer's height.
- `Terrain` — draws the data under its node in chunks, each as detailed as `heightmapPixelError`
  asks from where the camera is (Martini), rebuilt once a frame after a change;
  `sampleHeight(worldPosition)`, `castShadows`, `materialTemplate`, `tileScale` — every
  layer's tile size times it — and `sideProjection`, both changeable while the game runs.
- `TerrainMaterial` — the two heaviest layers of each pixel blended by height, tiling broken up,
  ground steeper than 45° textured from the side instead of from above, with no extra reads (off
  with `sideProjection`); a small, fixed amount of work per pixel, so it suits phones. Three's standard
  material underneath, so lights and shadows are three's.

A `.terrain` file is small: the heights are predicted from their neighbours and gzipped, the weights
are a byte each. Its layout is written down above `decode` in
[`TerrainData.ts`](https://github.com/RomaRogov/scenoco-three/blob/main/packages/terrain/src/TerrainData.ts).
