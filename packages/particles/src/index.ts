/**
 * `@scenoco-three/particles` — particle systems / VFX for SceNoCo, on three.quarks.
 *
 * ```xml
 * <!-- assets/vfx/fire.particle.xml -->
 * <ParticleEffect duration="3" startLifetime="1.6" startSpeed="4.5" startColor="#ffdd66">
 *   <Emission rateOverTime="90"><Burst time="0" count="10" /></Emission>
 *   <Shape type="Cone" radius="0.35" angle="14" />
 *   <ColorOverLifetime colors="[#ffee88, #ff6622, #661100]" />
 *   <SizeOverLifetime curve="[0.4, 1, 0.2]" />
 * </ParticleEffect>
 * ```
 *
 * ```xml
 * <!-- and in a scene -->
 * <Group position="y: 1.2">
 *   <Components>
 *     <ParticleSystem effect="../vfx/fire.particle.xml" />
 *   </Components>
 * </Group>
 * ```
 *
 * An effect is an **asset**, like a geometry or a material — one file, referenced by however
 * many emitters want it. The `<ParticleSystem>` component plays one; `ParticleRenderer` is the
 * scene system that batches and steps them all.
 *
 * ### Where the format lives
 *
 * Here, and nowhere else. `package.json` says a `.particle.xml` is a {@link ParticleEffect}; the
 * compiler reads that type's declaration and knows the whole document — an attribute exists
 * because a field does, an element because a field holds a named type. Nothing about particles is
 * written down in the toolchain, and adding a module to an effect is adding an interface here.
 */
export { ParticleSystem } from './ParticleSystem.js';
export { ParticleRenderer } from './ParticleRenderer.js';
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
