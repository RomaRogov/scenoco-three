import { Component, component, enumOf, property } from '@scenoco-three/core';

/** How the player must avoid contact — jump over, slide under, or dodge (change lanes). */
const ObstacleKind = enumOf('ObstacleKind', ['jump', 'duck', 'dodge']);

/**
 * Marks a spawned obstacle node with how the player survives touching it. Pure
 * data/marker — no references in or out, so it carries zero circular-import risk;
 * `PlayerController` looks it up with `other.getComponent(Obstacle)` inside its
 * `onTriggerEnter` (a method body, evaluated lazily — the safe pattern for a
 * cross-component lookup, see `@scenoco-three/core`'s README on `@property({type})`
 * circularity).
 */
@component({
  name: 'Obstacle',
  description: 'Hazard the player must avoid: jump = must be airborne, duck = must be sliding, dodge = no way through.',
})
export class Obstacle extends Component {
  @property({ type: ObstacleKind, description: 'How the player survives contact' })
  kind: 'jump' | 'duck' | 'dodge' = 'jump';
}
