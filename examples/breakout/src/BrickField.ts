import { Vector2 } from 'three';
import { Behaviour, instantiate } from '@scenoco-three/core';
import { Brick } from './Brick';
import { BrickPrefab } from './scenes/Arena';

/**
 * A wall of bricks, laid out from a map: `<BrickField rows={['1111111', '.11111.']} />`.
 *
 * Thirty `<BrickPrefab>` elements would be thirty near-identical lines differing in two numbers;
 * the map is the readable version of the same thing, and repetition is a behaviour's job — a
 * scene only declares.
 */
export class BrickField extends Behaviour {
  /**
   * The wall, one string per row, **all the same width**, read left to right and downwards.
   *
   * A digit is a brick that takes that many hits; every other character is a gap, so a shorter
   * row is padded with dots rather than left short. The wall is centred on this node.
   */
  rows: string[] = [];

  /** Distance between brick centres. */
  spacing = new Vector2(2.55, 1);

  override awake(): void {
    const width = Math.max(0, ...this.rows.map((row) => row.length));
    // Rows of different lengths are the one way to get this wrong, and the symptom is a wall that
    // sits slightly off-centre rather than anything that looks like an error.
    if (this.rows.some((row) => row.length !== width)) {
      console.error(
        `[BrickField] the rows are ${this.rows.map((row) => row.length).join('/')} wide. Every row of a wall ` +
          'has to be the same width — pad the short ones with "." — or the wall is centred on the longest.',
      );
    }
    for (const [row, cells] of this.rows.entries()) {
      for (const [column, cell] of [...cells].entries()) {
        const hits = Number.parseInt(cell, 10);
        if (!Number.isFinite(hits) || hits <= 0) continue;
        const brick = instantiate(BrickPrefab, {
          parent: this.node,
          position: [(column - (width - 1) / 2) * this.spacing.x, -row * this.spacing.y, 0],
        });
        // In by the brick's `start`, which is where it reads it — Unity's order after `Instantiate`.
        brick.getComponent(Brick)!.hits = hits;
      }
    }
  }
}
