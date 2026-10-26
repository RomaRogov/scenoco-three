import { CircleGeometry, MeshBasicMaterial, RingGeometry, SpriteMaterial } from 'three';
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

const star = sharedTexture('/ui/star.png');

/** Shared by every health bar, ring and badge. */
export const paint = {
  hpBack: new SpriteMaterial({ color: '#2b1a0c', depthTest: false }),
  hpFill: new SpriteMaterial({ color: '#5be04a', depthTest: false }),
  hpArmor: new SpriteMaterial({ color: '#ffd23f', depthTest: false }),
  star: new SpriteMaterial({ map: star, depthTest: false }),
  ring: new MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.85, depthWrite: false }),
  range: new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false }),
  rangeEdge: new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }),
  water: new MeshBasicMaterial({ color: '#3aa8d8', transparent: true, opacity: 0.55, depthWrite: false }),
};

export const shapes = {
  ring: new RingGeometry(1.25, 1.45, 48).rotateX(-Math.PI / 2),
  disc: new CircleGeometry(1, 64).rotateX(-Math.PI / 2),
  edge: new RingGeometry(0.975, 1, 96).rotateX(-Math.PI / 2),
};
