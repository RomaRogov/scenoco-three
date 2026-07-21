import { Component, component, property, ValueType } from '@scenoco-three/core';

/**
 * Destroys the host node after `life` seconds. Used on one-shot VFX prefabs
 * (coin-pickup sparkle, crash burst) so they clean themselves up without the
 * spawning component (PlayerController) needing to track or time them.
 */
@component({ name: 'SelfDestruct', description: 'Destroys the host node after `life` seconds — for one-shot VFX.' })
export class SelfDestruct extends Component {
  @property({ type: ValueType.Float, description: 'Seconds before this node is destroyed' })
  life = 1;

  private age = 0;

  override update(dt: number): void {
    this.age += dt;
    if (this.age >= this.life) this.engine.destroy(this.node);
  }
}
