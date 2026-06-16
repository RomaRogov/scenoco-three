import { Vector2, Vector3, type Object3D } from 'three';
import { Component, component, property, PrefabRef, type SceneInstance } from '@scenoco-three/core';

/** One stamped grid cell — a spawned prefab instance plus its grid coordinates. */
export interface GridCell {
  instance: SceneInstance;
  root: Object3D;
  row: number;
  col: number;
}

/**
 * Generic, game-agnostic layout component: spawns a `prefab` in a `cols × rows`
 * grid and tracks the instances. Repetition is *parameterised behaviour*, so it
 * lives in a component — the scene XML stays declarative (all data attributes),
 * with no new DSL tag and no build-time expression language. The prefab itself
 * is composer-authored and validated; this just stamps it.
 *
 *   <Object3D id="bricks">
 *     <Components>
 *       <GridLayout prefab="brick.prefab.xml" cols="10" rows="5"
 *                   spacing="1.35 0.55" origin="-6.075 7.5 0" />
 *     </Components>
 *   </Object3D>
 *
 * Cells are parented under this component's node, so the whole grid moves as a
 * unit. The instances are spawned via the engine (tracked + disposed), and this
 * component destroys them on teardown so scene reloads stay clean.
 */
@component({ name: 'GridLayout', description: 'Spawns a prefab in a cols×rows grid and tracks the instances' })
export class GridLayout extends Component {
  @property({ type: 'prefab', description: 'The .prefab.xml stamped at each grid cell' })
  prefab: PrefabRef | null = null;

  @property({ type: 'int', default: 1, description: 'Number of columns' })
  cols = 1;

  @property({ type: 'int', default: 1, description: 'Number of rows' })
  rows = 1;

  @property({ type: 'vec2', default: [1, 1], description: 'Step between cells: x (per column) y (per row)' })
  spacing = new Vector2(1, 1);

  @property({ type: 'vec3', default: [0, 0, 0], description: 'Position of cell (row 0, col 0)' })
  origin = new Vector3();

  private cells: GridCell[] = [];

  override onLoad(): void {
    this.build();
  }

  override onDestroy(): void {
    this.clear();
  }

  /** Cells still in play (removed cells are dropped from this list). */
  liveCells(): readonly GridCell[] {
    return this.cells;
  }

  get liveCount(): number {
    return this.cells.length;
  }

  /** Remove one cell — destroys its spawned subtree and drops it from the grid. */
  remove(cell: GridCell): void {
    const i = this.cells.indexOf(cell);
    if (i === -1) return;
    this.cells.splice(i, 1);
    cell.instance.destroy();
  }

  /** Destroy every cell and respawn the full grid (used on restart). */
  rebuild(): void {
    this.clear();
    this.build();
  }

  private build(): void {
    if (!this.prefab) return;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = this.origin.x + col * this.spacing.x;
        const y = this.origin.y + row * this.spacing.y;
        const instance = this.prefab.spawn({ parent: this.node, position: [x, y, this.origin.z] });
        this.cells.push({ instance, root: instance.root, row, col });
      }
    }
  }

  private clear(): void {
    for (const cell of this.cells) cell.instance.destroy();
    this.cells.length = 0;
  }
}
