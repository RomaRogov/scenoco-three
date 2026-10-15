/**
 * `@scenoco-three/tools` — what works on scene files rather than in the game: the rule that a
 * `.tsx` file only declares, and the editor's way to read and edit one without losing a byte of
 * what was not touched.
 */
export { checkScene, tsxFiles } from './scenes.js';
export * from './scene-edit.js';
