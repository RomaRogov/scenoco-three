import { sharedModel, type Loadable } from '@scenoco-three/core';
import { TerrainData } from '@scenoco-three/terrain';
import roadUrl from './models/road.glb?url';
import carUrl from './models/car.glb?url';
import pineUrl from './models/pine.glb?url';
import treeUrl from './models/tree.glb?url';
import rockUrl from './models/rock.glb?url';
import terrainUrl from './terrain/race.terrain?url';

/** Modelled in Blender: the road piece (blender/road_piece.py) and the car (blender/car.py), through the asset lab. */
export const models = {
  /** 8 m of road with its kerbs, markings and shoulders, for `SplineMesh` to bend along the track. */
  road: sharedModel(roadUrl),
  /** Its `paint` tinted per car; `body` and the four `wheel_*` reached by name. */
  car: sharedModel(carUrl),
  pine: sharedModel(pineUrl),
  tree: sharedModel(treeUrl),
  rock: sharedModel(rockUrl),
};

/**
 * The ground: the asset lab's `lab terrain terrain/track.json` — hills, a rise inside the loop and
 * mountains beyond, with the road's own knots carved flat into it — and its ground layers' textures.
 */
export const ground = new TerrainData(
  terrainUrl,
  import.meta.glob<string>('./terrain/layers/*.jpg', { query: '?url', import: 'default', eager: true }),
);

export const allAssets: Loadable[] = [...Object.values(models), ground];
