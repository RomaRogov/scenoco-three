import type { ModuleBinding } from './emit/config.js';

/**
 * The Shuriken vocabulary a `.particle.xml` is written in, mapped onto `ParticleConfig`.
 *
 * Only the *names* are here. What each attribute accepts, whether it exists at all, and what
 * its type is all come from `ParticleConfig`'s own TypeScript declaration — so the particles
 * package gains an attribute the moment it declares a field, with no edit to this table.
 *
 * The table exists because Unity's module names and the config's field names are two different
 * naming conventions, and no type can express the correspondence between them. `<Emission
 * rateOverTime="90">` writes a top-level `rateOverTime`; `<Shape type="Cone">` writes
 * `shape.type`; `<Burst>` appends to `bursts`.
 */
export const PARTICLE_MODULES: readonly ModuleBinding[] = [
  { tag: 'Emission', field: '' },
  { tag: 'Burst', field: '', list: 'bursts' },
  { tag: 'Shape', field: 'shape' },
  { tag: 'Renderer', field: 'renderer' },
  { tag: 'Noise', field: 'noise' },
  { tag: 'ColorOverLifetime', field: 'colorOverLifetime', from: 'colors' },
  { tag: 'SizeOverLifetime', field: 'sizeOverLifetime', from: 'curve' },
  { tag: 'RotationOverLifetime', field: 'rotationOverLifetime', from: 'angularVelocity' },
];

/** Where the particle config type lives, and what it is called. */
export const PARTICLE_CONFIG = {
  module: '@scenoco-three/particles',
  name: 'ParticleConfig',
  rootTag: 'ParticleSystem',
} as const;
