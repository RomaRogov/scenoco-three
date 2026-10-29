import { Vector2 } from 'three';
import { Behaviour } from '@scenoco-three/core';

/**
 * Keeps its node on a grid while it is moved in the editor, so a level laid out by hand stays
 * lined up: drag a brick and it lands in the next cell. Turn `snap` off on the one that should sit
 * between cells.
 *
 * It works in `onValidate`, which runs as the editor moves the node, and the editor writes the
 * snapped position into the scene file. The game never moves a brick, so it costs nothing in play.
 */
export class GridSnap extends Behaviour {
  /** One cell, in the parent's units: across, then up. */
  cell = new Vector2(1, 1);
  /** Off: the node stays where it is put. */
  snap = true;

  override onValidate(): void {
    if (!this.snap) return;
    const p = this.node.position;
    p.x = onGrid(p.x, this.cell.x);
    p.y = onGrid(p.y, this.cell.y);
  }
}

/** The nearest multiple of `step`, rounded so the file reads 7.65, not 7.6499999999. */
function onGrid(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(Math.round(value / step) * step * 1e4) / 1e4;
}
