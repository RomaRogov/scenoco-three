import { SceneManager } from '@scenoco-three/core';
import type { LevelId } from './levels';

/**
 * Every scene by name, for the buttons that move between them — each fetched when it is asked for.
 * `SceneManager.loadAsync` is Unity's `LoadSceneAsync`: the level's module, then the ground and models
 * it declares, then the scene. So the menu never waits for a later level's terrain, and each level is
 * its own chunk of the build.
 */
const scenes = {
  menu: () => import('./scenes/Menu').then((m) => m.Menu),
  meadow: () => import('./scenes/Meadow').then((m) => m.Meadow),
  canyon: () => import('./scenes/Canyon').then((m) => m.Canyon),
  frost: () => import('./scenes/Frost').then((m) => m.Frost),
};

export function goTo(name: LevelId | 'menu'): Promise<void> {
  return SceneManager.loadAsync(scenes[name]);
}
