import type { Game } from '../types.js';
import { check as crateGrid } from './crate-grid.js';
import { check as crateValue } from './crate-value.js';
import { check as fullStackTint } from './full-stack-tint.js';
import { check as groundShader } from './ground-shader.js';
import { check as heavyCrate } from './heavy-crate.js';
import { check as movingDepot } from './moving-depot.js';
import { check as secondDepot } from './second-depot.js';
import { check as stackCap } from './stack-cap.js';
import { check as timeBonus } from './time-bonus.js';

/**
 * A task's examiner: throws — through `expect` — when the task has not been done.
 *
 * Plain functions rather than `it()` blocks, so the same code does two jobs: grade a run, and
 * prove on an untouched arm that the task is not already solved.
 */
export type Check = (game: Game) => void | Promise<void>;

/**
 * Keyed by task id. `repair` has no entry: what it asks for is that the project builds again and
 * behaves as it did, which is the parity suite plus a clean build — not a new assertion.
 */
export const CHECKS: Readonly<Record<string, Check>> = {
  'crate-value': crateValue,
  'heavy-crate': heavyCrate,
  'crate-grid': crateGrid,
  'second-depot': secondDepot,
  'stack-cap': stackCap,
  'time-bonus': timeBonus,
  'full-stack-tint': fullStackTint,
  'ground-shader': groundShader,
  'moving-depot': movingDepot,
};
