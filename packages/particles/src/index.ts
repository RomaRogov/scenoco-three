/**
 * `@scenoco-three/particles` — particle systems / VFX for SceNoCo, on three.quarks.
 *
 * ```xml
 * <!-- assets/vfx/fire.particle.xml -->
 * <ParticleSystem duration="3" startLifetime="1.6" startSpeed="4.5" startColor="#ffdd66">
 *   <Emission rateOverTime="90"><Burst time="0" count="10" /></Emission>
 *   <Shape type="Cone" radius="0.35" angle="14" />
 *   <ColorOverLifetime colors="[#ffee88, #ff6622, #661100]" />
 *   <SizeOverLifetime curve="[0.4, 1, 0.2]" />
 * </ParticleSystem>
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
 * ### What went away in v2
 *
 * The package used to own its own document format: a `registerSrcCompiler` seam, a build-time
 * `./compiler` entry, an XSD, a hand-written `.particle.xml` parser, and a second inline way to
 * spell the same effect on the component. All of it is gone. The compiler reads
 * {@link ParticleConfig}'s own TypeScript declaration to decide what a document may say, so an
 * attribute exists because a field does — and the only thing left that no type could express,
 * the Unity module names, is eight lines in the compiler.
 */
export { ParticleSystem } from './ParticleSystem.js';
export { ParticleRenderer } from './ParticleRenderer.js';
export {
  configToParameters,
  type ParticleBlending,
  type ParticleConfig,
  type ParticleRenderMode,
  type ParticleShape,
  type SimulationSpace,
} from './config.js';
