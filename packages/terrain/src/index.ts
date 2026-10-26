/**
 * `@scenoco-three/terrain` — ground from a heightmap, textured by layers, spelled the way Unity's
 * terrain spells it. Loaded from a file, or made in code at runtime.
 *
 * ```tsx
 * // assets.ts: from a file (the asset lab's `lab terrain`), with its layers' textures
 * export const meadow = new TerrainData(meadowUrl, import.meta.glob('./meadow/layers/*', { query: '?url', import: 'default', eager: true }));
 * // main.ts: await loadAssets(meadow);
 * <Group>
 *   <Terrain terrainData={meadow} />
 *   <TerrainCollider terrainData={meadow} />   // @scenoco-three/rapier
 * </Group>
 * ```
 * ```ts
 * // or in code, as in Unity: heights 0..1 of size.y, [row][column]; the ground follows every change
 * const data = new TerrainData();
 * data.heightmapResolution = 257;
 * data.size = new Vector3(80, 12, 30);
 * data.setHeights(0, 0, rows);
 * data.terrainLayers = [new TerrainLayer({ diffuseTexture: sharedTexture(grassUrl), tileSize: 2 })];
 * ```
 *
 * - `TerrainData` — the heights and each ground layer's weight. `setHeights`/`getHeights`,
 *   `setAlphamaps`/`getAlphamaps`, `getInterpolatedHeight`, `getInterpolatedNormal`, `getSteepness`,
 *   `size`, `heightmapResolution`, `terrainLayers`; `changed` after any edit.
 * - `TerrainLayer` — a texture tiled every `tileSize` metres, with an optional normal map.
 * - `Terrain` — draws it under its node in chunks, each as detailed as `heightmapPixelError` asks
 *   from where the camera is; `sampleHeight(worldPosition)`.
 * - `TerrainMaterial` — the layers blended by weight and height, tiling broken up, cliffs projected
 *   from the side; on three's standard material, so lights and shadows are three's.
 */
export { TerrainData, TerrainLayer, MAX_TERRAIN_LAYERS, type TerrainTextures } from './TerrainData.js';
export { Terrain } from './Terrain.js';
export { TerrainMaterial, type TerrainMaterialParameters } from './TerrainMaterial.js';
