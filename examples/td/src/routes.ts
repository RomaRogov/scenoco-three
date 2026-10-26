import type { SceneManager } from '@scenoco-three/core';
import type { LevelId } from './levels';
import { Canyon } from './scenes/Canyon';
import { Frost } from './scenes/Frost';
import { Meadow } from './scenes/Meadow';
import { Menu } from './scenes/Menu';

/**
 * Every scene by name, for the buttons that move between them. A function, not a table: the scenes
 * import the behaviours that call this, so a table built at load would read them half-defined.
 */
export function route(name: LevelId | 'menu'): Parameters<typeof SceneManager.load>[0] {
  return { menu: Menu, meadow: Meadow, canyon: Canyon, frost: Frost }[name];
}
