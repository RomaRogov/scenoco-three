import { enumOf } from '@scenoco-three/core';

/**
 * Unity-style particle enums — the names local LLMs know from Shuriken. Stored as
 * their member string; the render layer maps each to the three.quarks primitive
 * (see config.ts), so both the inline component and the `.particle.xml` file
 * speak the same names.
 */

/** Emitter shape (Unity `ParticleSystemShapeType`). */
export const ParticleShape = enumOf('ParticleShape', [
  'Cone',
  'Sphere',
  'Hemisphere',
  'Circle',
  'Donut',
  'Rectangle',
  'Point',
]);

/** How each particle is drawn (Unity `ParticleSystemRenderMode`). */
export const ParticleRenderMode = enumOf('ParticleRenderMode', [
  'Billboard',
  'StretchedBillboard',
  'HorizontalBillboard',
  'VerticalBillboard',
  'Mesh',
]);

/** Whether particles follow the emitter or stay put once born (Unity `ParticleSystemSimulationSpace`). */
export const SimulationSpace = enumOf('SimulationSpace', ['Local', 'World']);

/** Sprite blend mode. */
export const ParticleBlending = enumOf('ParticleBlending', ['Additive', 'Alpha']);
