/**
 * `@scenoco-three/particles` — particle effects on three.quarks, in Unity's Shuriken shape.
 *
 * ```ts
 * // vfx.ts
 * export const fire: ParticleEffect = {
 *   duration: 3, startLifetime: 1.6, startSpeed: 4.5, startColor: new Color('#ffdd66'),
 *   emission: { rateOverTime: 90, bursts: [{ time: 0, count: 10 }] },
 *   shape: { type: 'Cone', radius: 0.35, angle: 14 },
 * };
 * ```
 * ```tsx
 * <Group position={[0, 1.2, 0]}>
 *   <ParticleSystem effect={vfx.fire} />
 * </Group>
 * ```
 *
 * An effect is data typed by `ParticleEffect` — one constant, shared by however many emitters
 * play it. `ParticleSystem` plays one.
 */
export { ParticleSystem } from './ParticleSystem.js';
export {
  configToParameters,
  type Burst,
  type ColorOverLifetime,
  type Emission,
  type Noise,
  type ParticleBlending,
  type ParticleEffect,
  type ParticleRenderMode,
  type ParticleShape,
  type Renderer,
  type RotationOverLifetime,
  type Shape,
  type SimulationSpace,
  type SizeOverLifetime,
} from './config.js';
