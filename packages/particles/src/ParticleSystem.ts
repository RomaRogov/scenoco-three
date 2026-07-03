import { Component, component, property } from '@scenoco-three/core';
import type { ParticleConfig } from './config.js';
import { ParticleBlending, ParticleRenderMode, ParticleShape, SimulationSpace } from './enums.js';

/**
 * A particle system — Unity's Shuriken `ParticleSystem`, as a SceNoCo component.
 * Put it on a node; `ParticleRenderSystem` builds the three.quarks system from
 * its config, parents the emitter under the node, and steps it each frame (play
 * mode only, like physics).
 *
 * Two authoring tiers, both Unity-named:
 *  - **Inline** — the flat Main/Emission/Shape/Renderer properties below, for
 *    quick effects.
 *  - **`src="fire.particle.xml"`** — pull a full definition (with over-lifetime
 *    modules) from a separate file that has its own grammar + XSD, or a
 *    `src="fire.quarks.json"` exported from the quarks.art editor. When `src` is
 *    set it defines the whole system and the inline props are ignored.
 */
@component({ name: 'ParticleSystem', description: 'Unity-style particle system / VFX emitter (rendered by three.quarks)' })
export class ParticleSystem extends Component {
  // ── Main module ────────────────────────────────────────────────────────────
  @property({ type: 'float', default: 5, description: 'Length of one emission cycle, in seconds' })
  duration = 5;
  @property({ type: 'bool', default: true, description: 'Restart the cycle when it ends' })
  looping = true;
  @property({ type: 'bool', default: false, description: 'On the first cycle, start as if already run one full duration' })
  prewarm = false;
  @property({ type: 'float', default: 5, description: 'Seconds each particle stays alive (Start Lifetime)' })
  startLifetime = 5;
  @property({ type: 'float', default: 5, description: 'Initial speed along the emission direction (Start Speed)' })
  startSpeed = 5;
  @property({ type: 'float', default: 1, description: 'Initial particle size (Start Size)' })
  startSize = 1;
  @property({ type: 'float', default: 0, description: 'Initial roll, in degrees (Start Rotation)' })
  startRotation = 0;
  @property({ type: 'color', default: 0xffffff, description: 'Initial particle color/tint (Start Color)' })
  startColor = 0xffffff;
  @property({ type: 'float', default: 0, description: 'Downward gravity applied over life (Gravity Modifier)' })
  gravityModifier = 0;
  @property({ type: SimulationSpace, default: 'Local', description: 'Local: particles follow the emitter. World: they stay where born.' })
  simulationSpace: string = 'Local';

  // ── Emission module (flattened; <Burst> lives in the .particle.xml tier) ─────
  @property({ type: 'float', default: 10, description: 'Particles emitted per second (Rate over Time)' })
  rateOverTime = 10;

  // ── Shape module ─────────────────────────────────────────────────────────────
  @property({ type: ParticleShape, default: 'Cone', description: 'Emitter shape particles spawn from' })
  shapeType: string = 'Cone';
  @property({ type: 'float', default: 1, description: 'Shape radius (Cone/Sphere/Circle/Donut/…)' })
  shapeRadius = 1;
  @property({ type: 'float', default: 25, description: 'Cone half-angle in degrees (Shape: Cone)' })
  shapeAngle = 25;
  @property({ type: 'float', default: 360, description: 'Arc of the shape swept, in degrees' })
  shapeArc = 360;

  // ── Renderer module ──────────────────────────────────────────────────────────
  @property({ type: ParticleRenderMode, default: 'Billboard', description: 'How each particle is drawn' })
  renderMode: string = 'Billboard';
  @property({ type: ParticleBlending, default: 'Additive', description: 'Sprite blend mode (Additive glows; Alpha is normal)' })
  blending: string = 'Additive';
  @property({ type: 'string', asset: 'texture', default: '', description: 'Sprite texture URL; empty = a soft round default' })
  texture = '';

  /** Set from a `src=` document (`.particle.xml` / `.quarks.json`) before onLoad; overrides the inline props. */
  private srcConfig?: ParticleConfig;

  override applyConfig(config: unknown): void {
    this.srcConfig = config as ParticleConfig;
  }

  /** The effective config: the `src=` document if present, else built from the inline props. */
  toConfig(): ParticleConfig {
    if (this.srcConfig) return this.srcConfig;
    return {
      duration: this.duration,
      looping: this.looping,
      prewarm: this.prewarm,
      startLifetime: this.startLifetime,
      startSpeed: this.startSpeed,
      startSize: this.startSize,
      startRotation: this.startRotation,
      startColor: this.startColor,
      gravityModifier: this.gravityModifier,
      simulationSpace: this.simulationSpace,
      rateOverTime: this.rateOverTime,
      shape: { type: this.shapeType, radius: this.shapeRadius, angle: this.shapeAngle, arc: this.shapeArc },
      renderer: { renderMode: this.renderMode, blending: this.blending, texture: this.texture || undefined },
    };
  }
}
