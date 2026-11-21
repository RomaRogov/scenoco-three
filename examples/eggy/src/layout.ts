import { TerrainData, TerrainLayer } from '@scenoco-three/terrain';
import { textures } from './assets';

/** The slope's ground: made in code each level by `TerrainMesh`, one layer — TerrainMat, its texture tiled 15 times over the slope's 30 m width. */
export const slope = new TerrainData();
slope.terrainLayers = [new TerrainLayer({ name: 'grass', diffuseTexture: textures.terrain, tileSize: 2 })];
