import { Vector3 } from 'three';
import { TerrainData, TerrainLayer } from '@scenoco-three/terrain';
import { textures } from './assets';
import { unityEuler, unityPosition, unityQuaternion } from './unity';

/** Where things stood in the Unity scene and prefabs, with the numbers as written there. */
export const unity = {
  // Prefabs/Game/Egg.prefab placed in Main.unity.
  egg: unityPosition(13.11, 2.36, 0),
  // Prefabs/Game/CamContainer.prefab: the container, and its Main Camera.
  camContainer: unityPosition(5, 2.73, 0),
  camera: unityPosition(9, 7, 0),
  cameraRotation: unityQuaternion(0.24184473, -0.66446304, 0.24184473, 0.66446304),
  // Main.unity's Nest instance, under the level: tuned to sit level at the bottom of the slope.
  nestRotation: unityQuaternion(-0.16740577, 0.9308833, 0.061736196, 0.31877953),
  // Prefabs/Star.prefab's root: the sprite turned to face the camera.
  starRotation: unityQuaternion(-0.24184473, 0.6644631, 0.24184474, 0.66446304),
  // Main.unity's Directional Light, rotated (54.1, 63.7, 69.5): placed 30 m back along its rays.
  sunPosition: new Vector3(0, 0, -1).applyQuaternion(unityEuler(54.122, 63.653, 69.547)).multiplyScalar(-30),
};

/** The slope's ground: made in code each level by `TerrainMesh`, one layer — TerrainMat, its texture tiled 15 times over the slope's 30 m width. */
export const slope = new TerrainData();
slope.terrainLayers = [new TerrainLayer({ name: 'grass', diffuseTexture: textures.terrain, tileSize: 2 })];
