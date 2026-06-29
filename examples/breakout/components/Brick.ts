import { Component, component, property } from '@scenoco-three/core';

/**
 * A single Breakout brick — pure data on the brick prefab's node, alongside a
 * static `<RigidBody2D>` + `<BoxCollider2D>` (so Box2D reports the ball's contact).
 *
 * The brick's mesh, material, size and physics all live in `brick.prefab.xml`;
 * this component is just the data the game logic reads off each placed instance.
 * Bricks are placed individually in the scene as `<PrefabInstance>`s and handed
 * to the `Ball` as an array (`bricks="[#b1,#b2,…]"`).
 */
@component({ name: 'Brick', description: 'A Breakout brick: its score value' })
export class Brick extends Component {
  @property({ type: 'int', default: 10, description: 'Score awarded when this brick is destroyed' })
  points = 10;

  /** Set true once the ball has hit it (the Ball then removes the node). */
  destroyed = false;
}
