import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping } from 'three';
import type { Texture } from 'three';
import { sharedModel, sharedTexture } from '@scenoco-three/core';
import { sharedClip } from '@scenoco-three/audio';

import eggUrl from './models/egg.glb?url';
import eggTopUrl from './models/egg_top.glb?url';
import eggBottomUrl from './models/egg_bottom.glb?url';
import friedUrl from './models/fried.glb?url';
import nestUrl from './models/nest.glb?url';
import stone1Url from './models/stone1.glb?url';
import stone2Url from './models/stone2.glb?url';
import stone3Url from './models/stone3.glb?url';

/** The Unity models, exported from their FBX and .blend files at Unity's import scale. */
export const models = {
  egg: sharedModel(eggUrl),
  eggTop: sharedModel(eggTopUrl),
  eggBottom: sharedModel(eggBottomUrl),
  fried: sharedModel(friedUrl),
  nest: sharedModel(nestUrl),
  stone1: sharedModel(stone1Url),
  stone2: sharedModel(stone2Url),
  stone3: sharedModel(stone3Url),
};

// As stored, no colour space: the game lights in gamma, as the Unity project did (gamma.ts).
const tiled = { wrapS: RepeatWrapping, wrapT: RepeatWrapping } as const;

// The models' textures follow glTF's UVs, which count v from the top: not flipped, as GLTFLoader loads its own.
const onModel = { flipY: false } as const;

export const textures = {
  terrain: sharedTexture('textures/terrain.jpg', tiled),
  egg: sharedTexture('textures/egg.jpg', onModel),
  nest: sharedTexture('textures/nest.jpg', { ...tiled, ...onModel }),
  stone: sharedTexture('textures/stone.jpg', { ...tiled, ...onModel }),
  star: sharedTexture('textures/star.png'),
  /** The height stamps the terrain is shaped with: read as data, not drawn. */
  start: sharedTexture('textures/start.png'),
  end: sharedTexture('textures/end.png'),
};

/** Unity's materials, with their values. Glossiness is roughness's opposite. */
export const materials = {
  // Egg.mat: the speckled texture, and the same texture as emission at 0.726.
  egg: new MeshStandardMaterial({ map: textures.egg, emissiveMap: textures.egg, emissive: '#bababa', roughness: 0.49, metalness: 0 }),
  friedWhite: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }),
  friedYolk: new MeshStandardMaterial({ color: '#ffc000', roughness: 0.5 }),
  // Nest.mat tiles its texture 3 times.
  nest: new MeshStandardMaterial({ map: tiling(textures.nest, 3), roughness: 0.5 }),
  // Leafs.mat: the terrain texture, tinted green.
  leaves: new MeshStandardMaterial({ map: textures.terrain, color: '#5f8c45', roughness: 0.5 }),
  // Stone.mat: Legacy Diffuse — no shine at all.
  stone: new MeshStandardMaterial({ map: tiling(textures.stone, 0.5), roughness: 1 }),
  // The floor under the drop: TerrainMat on a 40 m quad, tiled 15 times as the material says.
  floor: new MeshStandardMaterial({ map: tiling(textures.terrain, 15, -3), roughness: 0.89 }),
  // Sprites-Default: unlit, see-through.
  star: new MeshBasicMaterial({ map: textures.star, transparent: true, side: DoubleSide, depthWrite: false }),
};

/**
 * A material's own tiling of a shared texture, as Unity's materials scale and offset theirs. Unity
 * counts v from the bottom: on a model's texture (not flipped) the same tiles start at the top.
 */
function tiling(texture: Texture, scale: number, offset = 0): Texture {
  const copy = texture.clone();
  copy.repeat.set(scale, scale);
  copy.offset.set(offset, texture.flipY ? 0 : 1 - scale);
  return copy;
}

export const sounds = {
  music: sharedClip('sounds/eggy_roll.mp3'),
  roll: sharedClip('sounds/grass_sound2.mp3'),
  star: sharedClip('sounds/star.mp3'),
  win: sharedClip('sounds/level_end.mp3'),
  crash: sharedClip('sounds/egg_crack.mp3'),
  drop: sharedClip('sounds/egg_drop.mp3'),
};

export const allAssets = [...Object.values(models), ...Object.values(textures), ...Object.values(sounds)];
