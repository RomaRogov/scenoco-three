import { Color } from 'three';
import type { ParticleEffect } from '@scenoco-three/particles';

/** A brick breaking: a burst of sparks in its tier's colour, thrown out and falling. */
function shatter(color: string): ParticleEffect {
  return {
    duration: 0.5,
    looping: false,
    startLifetime: 0.75,
    startSpeed: 7,
    startSize: 0.26,
    startColor: new Color(color),
    gravityModifier: 0.9,
    simulationSpace: 'World',
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: 34 }] },
    shape: { type: 'Sphere', radius: 0.45 },
    renderer: { blending: 'Additive' },
    sizeOverLifetime: { curve: [1, 0.7, 0] },
    colorOverLifetime: { colors: [new Color('#ffffff'), new Color(color), new Color(color).multiplyScalar(0.2)] },
  };
}

export const vfx = {
  /** By a brick's tier: the same colours as `Brick`'s `tints` in the prefab. */
  shatterSoft: shatter('#16d9ff'),
  shatterFirm: shatter('#ff3dd8'),
  shatterHard: shatter('#ffaa1c'),
  /** What the ball leaves behind it: a short comet tail, left where it was made. */
  trail: {
    looping: true,
    startLifetime: 0.32,
    startSpeed: 0.2,
    startSize: 0.5,
    startColor: new Color('#ffcf6b'),
    simulationSpace: 'World',
    emission: { rateOverTime: 90 },
    shape: { type: 'Sphere', radius: 0.08 },
    renderer: { blending: 'Additive' },
    sizeOverLifetime: { curve: [1, 0.45, 0] },
    colorOverLifetime: { colors: [new Color('#fff1c1'), new Color('#ff7a1a'), new Color('#240800')] },
  } satisfies ParticleEffect,
  /** A laser bolt striking: a small hot flash. */
  spark: {
    duration: 0.2,
    looping: false,
    startLifetime: 0.3,
    startSpeed: 5,
    startSize: 0.2,
    startColor: new Color('#ff7d9b'),
    simulationSpace: 'World',
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: 14 }] },
    shape: { type: 'Hemisphere', radius: 0.1 },
    renderer: { blending: 'Additive' },
    sizeOverLifetime: { curve: [1, 0] },
  } satisfies ParticleEffect,
};
