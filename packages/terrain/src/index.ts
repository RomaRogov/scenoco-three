/**
 * `@scenoco-three/terrain` — ground from a heightmap, textured by layers, drawn the way Unity's
 * terrain draws it. Everything in metres: x and z from the terrain's centre, heights from its node.
 *
 * ```ts
 * // in code, from the height function the game also places things with
 * export const hill = (x: number, z: number) => 4 * Math.exp(-(x * x + z * z) / 200);
 * export const ground = new TerrainData();
 * ground.width = ground.depth = 80;
 * ground.heightmapResolution = 129;
 * ground.setHeights(hill);
 * ground.terrainLayers = [new TerrainLayer({ color: new Color('#5a8a3a') }), new TerrainLayer({ color: new Color('#8a8070') })];
 * ground.setAlphamaps((x, z) => (ground.steepnessAt(x, z) > 30 ? [0, 1] : [1, 0]));
 * // or from a file (the asset lab's `lab terrain`), with its layers' textures; then await loadAssets(meadow)
 * export const meadow = new TerrainData(meadowUrl, import.meta.glob('./meadow/layers/*', { query: '?url', import: 'default', eager: true }));
 * ```
 * ```tsx
 * <Group>
 *   <Terrain terrainData={ground} />
 *   <TerrainCollider terrainData={ground} />   // @scenoco-three/rapier
 * </Group>
 * ```
 *
 * - `TerrainData` — `width`, `depth`, `heightmapResolution`, `setHeights`, `heightAt`, `normalAt`,
 *   `steepnessAt`, `terrainLayers`, `setAlphamaps`; `changed` after any edit.
 * - `TerrainLayer` — a texture tiled every `tileSize` metres, or a plain `color`; an optional normal map.
 * - `Terrain` — draws it under its node in chunks, each as detailed as `heightmapPixelError` asks
 *   from where the camera is; `sampleHeight(worldPosition)`.
 * - `TerrainMaterial` — the layers blended by weight and height, tiling broken up, cliffs projected
 *   from the side; on three's standard material, so lights and shadows are three's.
 */
export { TerrainData, TerrainLayer, MAX_TERRAIN_LAYERS, type TerrainTextures } from './TerrainData.js';
export { Terrain } from './Terrain.js';
export { TerrainMaterial, type TerrainMaterialParameters } from './TerrainMaterial.js';
