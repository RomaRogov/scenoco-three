import { Vector2, Vector3 } from 'three';
import { Component, type PrefabType } from '@scenoco-three/core';
import { Brick } from './Brick.js';

/**
 * A wall of bricks, laid out from a map.
 *
 * A level used to be one `<Prefab>` element per brick — thirty near-identical lines whose only
 * differences were two numbers, with the readable version of the same thing sitting above them
 * in a comment. This is that comment, promoted to the data it always was:
 *
 * ```xml
 * <Group position="y: 13.9">
 *   <Components>
 *     <BrickField brick="brick.prefab.xml" rows="[1111111, 1111111, .11111.]" />
 *   </Components>
 * </Group>
 * ```
 *
 * Repetition belongs in code, not in a tag that generates elements: the document stays a scene
 * tree where every element is a node, and the loop lives where loops live. What makes it work
 * is that a prefab is nameable — a field declared `PrefabType` is filled by a path, exactly as
 * a geometry or a material is — so the thing being repeated is still authored in the document.
 */
export class BrickField extends Component {
  /** What to place. Authored as a path: `brick="brick.prefab.xml"`. */
  brick!: PrefabType;

  /**
   * The wall, one string per row, **all the same width**, read left to right and downwards.
   *
   * A digit is a brick that takes that many hits; every other character is a gap, so a shorter
   * row is padded with dots rather than left short. The whole wall is centred on this node, so
   * a row that is wider than the others shifts every other row sideways.
   */
  rows: string[] = [];

  /** Distance between brick centres. */
  spacing = new Vector2(2.55, 1);

  override awake(): void {
    const width = Math.max(0, ...this.rows.map((row) => row.length));
    // Rows of different lengths are the one way to get this wrong, and the symptom is a wall
    // that sits slightly off-centre rather than anything that looks like an error. The map is
    // plain data, so nothing checks it before it runs; saying so here is the only place left.
    if (this.rows.some((row) => row.length !== width)) {
      console.error(
        `[BrickField] the rows are ${this.rows.map((row) => row.length).join('/')} wide. Every ` +
          'row of a wall has to be the same width — pad the short ones with "." — or the wall ' +
          'is centred on the longest and the rest drift.',
      );
    }
    for (const [row, cells] of this.rows.entries()) {
      for (const [column, cell] of [...cells].entries()) {
        const hits = Number.parseInt(cell, 10);
        if (!Number.isFinite(hits) || hits <= 0) continue;
        const position = new Vector3(
          (column - (width - 1) / 2) * this.spacing.x,
          -row * this.spacing.y,
          0,
        );
        // The same seam `<Override target="#brick" hits="2" />` compiles to: the prefab has
        // built itself and nothing in it has woken up, so this is the value its `awake` reads.
        this.object3D.instantiate(this.brick, { position }, (node) => {
          const brick = node.getComponent(Brick);
          if (brick) brick.hits = hits;
        });
      }
    }
  }
}
