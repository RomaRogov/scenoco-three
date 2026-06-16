import { Component, component, property } from '@scenoco-three/core';

/**
 * A single Breakout brick — pure data attached to the brick prefab's node.
 *
 * It carries its score value and collision half-extents so the ball can resolve
 * a hit without hard-coding the brick's geometry. The brick's mesh, material,
 * and size all live in `brick.prefab.xml`; this component is the data the game
 * logic reads off each spawned instance.
 */
@component({ name: 'Brick', description: 'A Breakout brick: score value + collision half-extents' })
export class Brick extends Component {
  @property({ type: 'int', default: 10, description: 'Score awarded when destroyed' })
  points = 10;

  @property({ type: 'float', default: 0.6, description: 'Half-width for AABB collision (match the BoxGeometry)' })
  halfWidth = 0.6;

  @property({ type: 'float', default: 0.2, description: 'Half-height for AABB collision (match the BoxGeometry)' })
  halfHeight = 0.2;
}
