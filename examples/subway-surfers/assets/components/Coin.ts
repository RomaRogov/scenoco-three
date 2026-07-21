import { Component, component, property, ValueType } from '@scenoco-three/core';

/**
 * A collectible coin. Pure data — no references — `PlayerController` finds it
 * with `other.getComponent(Coin)` on contact and destroys the node itself; the
 * coin never needs to know who picked it up.
 */
@component({ name: 'Coin', description: 'Collectible coin; destroyed and scored on player contact.' })
export class Coin extends Component {
  @property({ type: ValueType.Int, description: 'Points awarded on pickup' })
  value = 10;
}
