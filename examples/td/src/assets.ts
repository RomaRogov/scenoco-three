import { CanvasTexture, ClampToEdgeWrapping, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SRGBColorSpace, SpriteMaterial } from 'three';
import { sharedModel, sharedTexture, type Loadable } from '@scenoco-three/core';
import { TerrainData } from '@scenoco-three/terrain';

import goblinUrl from './models/goblin.glb?url';
import orcUrl from './models/orc.glb?url';
import wolfUrl from './models/wolf.glb?url';
import trollUrl from './models/troll.glb?url';
import archerUrl from './models/archer.glb?url';
import cannonUrl from './models/cannon.glb?url';
import mageUrl from './models/mage.glb?url';
import frostUrl from './models/frost.glb?url';
import castleUrl from './models/castle.glb?url';
import caveUrl from './models/cave.glb?url';
import padUrl from './models/pad.glb?url';
import arrowUrl from './models/arrow.glb?url';
import cannonballUrl from './models/cannonball.glb?url';
import shardUrl from './models/shard.glb?url';
import pineUrl from './models/pine.glb?url';
import pineSnowUrl from './models/pine_snow.glb?url';
import treeUrl from './models/tree.glb?url';
import rockUrl from './models/rock.glb?url';
import lanternUrl from './models/lantern.glb?url';
import bridgeUrl from './models/bridge.glb?url';

import meadowTerrainUrl from './levels/meadow/meadow.terrain?url';
import canyonTerrainUrl from './levels/canyon/canyon.terrain?url';
import frostTerrainUrl from './levels/frost/frost.terrain?url';

/** Generated from images by TRELLIS.2 (asset lab), and scripted in Blender (blender/props.py). */
export const models = {
  goblin: sharedModel(goblinUrl),
  orc: sharedModel(orcUrl),
  wolf: sharedModel(wolfUrl),
  troll: sharedModel(trollUrl),
  archer: sharedModel(archerUrl),
  cannon: sharedModel(cannonUrl),
  mage: sharedModel(mageUrl),
  frost: sharedModel(frostUrl),
  castle: sharedModel(castleUrl),
  cave: sharedModel(caveUrl),
  pad: sharedModel(padUrl),
  arrow: sharedModel(arrowUrl),
  cannonball: sharedModel(cannonballUrl),
  shard: sharedModel(shardUrl),
  pine: sharedModel(pineUrl),
  pineSnow: sharedModel(pineSnowUrl),
  tree: sharedModel(treeUrl),
  rock: sharedModel(rockUrl),
  lantern: sharedModel(lanternUrl),
  bridge: sharedModel(bridgeUrl),
};

// Each level's layer textures, by file name.
const layerFiles = import.meta.glob<string>('./levels/*/layers/*.jpg', { query: '?url', import: 'default', eager: true });
const layersOf = (level: string) => Object.fromEntries(Object.entries(layerFiles).filter(([path]) => path.startsWith(`./levels/${level}/`)));

/** The asset lab's terrains (`lab terrain levels/td-*.json`): heights, layer weights and layer textures. */
export const terrains = {
  meadow: new TerrainData(meadowTerrainUrl, layersOf('meadow')),
  canyon: new TerrainData(canyonTerrainUrl, layersOf('canyon')),
  frost: new TerrainData(frostTerrainUrl, layersOf('frost')),
};

export const allAssets: Loadable[] = [...Object.values(models), ...Object.values(terrains)];

const star = sharedTexture('ui/star.png');

/** A tower's reach as a picture: a faint disc with a brighter rim, clear past it — what the marker projects. */
function reachTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const r = size / 2 - 2;
  g.fillStyle = 'rgba(255, 255, 255, 0.16)';
  g.beginPath();
  g.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  g.lineWidth = r * 0.03;
  g.beginPath();
  g.arc(size / 2, size / 2, r - g.lineWidth / 2, 0, Math.PI * 2);
  g.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // Scaled up past its edge as it grows in: what lies outside the picture is clear.
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

/** Shared by every health bar, ring and badge. */
export const paint = {
  hpBack: new SpriteMaterial({ color: '#2b1a0c', depthTest: false }),
  hpFill: new SpriteMaterial({ color: '#5be04a', depthTest: false }),
  hpArmor: new SpriteMaterial({ color: '#ffd23f', depthTest: false }),
  star: new SpriteMaterial({ map: star, depthTest: false }),
  ring: new MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.85, depthWrite: false }),
  /** Projected on the ground: drawn over it, pulled towards the camera so it never fights it for depth. */
  reach: new MeshBasicMaterial({ map: reachTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  water: new MeshBasicMaterial({ color: '#3aa8d8', transparent: true, opacity: 0.55, depthWrite: false }),
  /** A river's: its colour and opacity come from each vertex's depth (River), the sun glints on it. */
  river: new MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.15, metalness: 0 }),
};

export const shapes = {
  ring: new RingGeometry(1.25, 1.45, 48).rotateX(-Math.PI / 2),
};
