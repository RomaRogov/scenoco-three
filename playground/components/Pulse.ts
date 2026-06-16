import { Component, component, property } from '@scenoco-three/core';

/**
 * Scales the host up and down around its base scale. Not used by the turbine
 * scene — it exists to demonstrate (and verify) usage-based importing: a
 * component no scene uses is registered for validation/docs at build time but
 * never shipped to the browser.
 */
@component({ name: 'Pulse', description: 'Pulses the host scale around its base value' })
export class Pulse extends Component {
  @property({ type: 'float', default: 0.1, description: 'Scale amplitude' })
  amplitude = 0.1;

  @property({ type: 'float', default: 1, description: 'Pulses per second' })
  frequency = 1;

  private elapsed = 0;
  private baseScale = 1;

  override onLoad(): void {
    this.baseScale = this.node.scale.x;
  }

  override update(dt: number): void {
    this.elapsed += dt;
    const s = this.baseScale + Math.sin(this.elapsed * this.frequency * Math.PI * 2) * this.amplitude;
    this.node.scale.setScalar(s);
  }
}
