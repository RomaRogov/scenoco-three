import type { Scene } from 'three';
import type { Reach } from '../kernel/runtime.js';
import { loadInto } from '../scenes.js';
import type { OpenedScene } from './EditHost.js';

/**
 * What the page remembers across a reload, for this tab only: the editor was open, a reset asked to
 * hold the first frame and how far behaviours go, and which scene the editor opened.
 */
const KEY = 'scenoco-editor';
const SCENE_KEY = 'scenoco-editor-scene';

/** Open, or a reset asked for — with how far behaviours go. */
export type State = 'open' | Reach;
const STATES: readonly State[] = ['open', 'none', 'awake', 'onEnable', 'start', 'frame'];

export function read(): State | null {
  try {
    const value = sessionStorage.getItem(KEY) as State | null;
    return value && STATES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function write(value: State | null): void {
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    // No storage: the editor still works, it just does not reopen after a reload.
  }
}

/** @internal the scene the editor opened, which the page starts in instead of its own. */
export function openedScene(): OpenedScene | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SCENE_KEY) ?? 'null') as OpenedScene | null;
    return value && typeof value.file === 'string' && typeof value.name === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** @internal */
export function writeOpened(value: OpenedScene | null): void {
  try {
    if (value) sessionStorage.setItem(SCENE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SCENE_KEY);
  } catch {
    // No storage: the page starts its own way.
  }
}

/**
 * @internal Start the page in the scene the editor opened, once its module has loaded — or null when
 * none was, and the game starts its own way. If it cannot be loaded, the game's own scene starts.
 */
export function startOpenedScene(scene: Scene, build: () => unknown): Promise<void> | null {
  const opened = openedScene();
  if (!opened) return null;
  return import(/* @vite-ignore */ opened.file)
    .then((module: Record<string, unknown>) => {
      const chosen = module[opened.name];
      if (typeof chosen !== 'function') throw new Error(`${opened.file} exports no scene "${opened.name}"`);
      loadInto(scene, chosen as () => unknown, false);
    })
    .catch((error: unknown) => {
      console.warn(`The editor's scene could not be opened, so the game starts its own way: ${error instanceof Error ? error.message : String(error)}`);
      writeOpened(null);
      loadInto(scene, build, false);
    });
}
