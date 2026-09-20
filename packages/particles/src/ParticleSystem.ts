import { Component } from '@scenoco-three/core';
import type { ParticleSystem as QuarksSystem } from 'three.quarks';
import type { ParticleEffect } from './config.js';
import { ParticleRenderer } from './ParticleRenderer.js';

/**
 * Plays a particle effect on this node — Unity's Shuriken `ParticleSystem`.
 *
 * ```xml
 * <Group position="y: 1.2">
 *   <Components>
 *     <ParticleSystem effect="../vfx/fire.particle.xml" />
 *   </Components>
 * </Group>
 * ```
 *
 * The effect has the two forms every shared thing in the DSL has, and they mean what they mean
 * for a material. A **path** names a `.particle.xml` that every emitter pointing at it shares, so
 * tuning it is one edit in one place. An **element** gives this emitter its own:
 *
 * ```xml
 * <ParticleSystem>
 *   <ParticleEffect duration="3" startSize="0.4">
 *     <Emission rateOverTime="20" />
 *   </ParticleEffect>
 * </ParticleSystem>
 * ```
 *
 * The text inside is byte-identical to what the file holds, so the two are cut-and-paste in
 * either direction. Write the file when more than one emitter wants the effect; write the element
 * when this one is the only one that does.
 *
 * The emitter joins the scene's `ParticleRenderer` in `awake` and leaves it in `onDestroy`, so
 * nothing scans the scene for emitters that came or went. Disabling the component pauses it and
 * leaves its live particles standing; `stop()` clears them.
 */
export class ParticleSystem extends Component {
  /**
   * The effect to play. Required: an emitter with nothing to emit is a document that meant to
   * say something and did not.
   */
  effect!: ParticleEffect;

  /** Start emitting as soon as the component starts. Unity's `playOnAwake`. */
  playOnAwake = true;

  /** The live three.quarks system. Exists from `awake` until `onDestroy`. */
  get system(): QuarksSystem | null {
    return this._system;
  }

  private _system: QuarksSystem | null = null;

  private renderer: ParticleRenderer | null = null;
  /**
   * Whether a disable interrupted playback. Remembered rather than inferred: a system paused by
   * `pause()` and one paused by being disabled look identical from the outside, and re-enabling
   * must not restart a stopped one.
   */
  private wasPlaying = true;

  // --- lifecycle -------------------------------------------------------------------------

  override awake(): void {
    // A document cannot reach here without an effect: `effect!` has no default, so the compiler
    // reports `missing-attribute`. This is for an emitter built in code. Core catches what a
    // hook throws and reports it with the component and the node, so the message is the whole
    // contribution — and the emitter is left inert rather than half-built.
    if (!this.effect) {
      throw new Error(
        'ParticleSystem has no effect. Point it at a .particle.xml, or write one inside it: ' +
          '<ParticleSystem effect="../vfx/fire.particle.xml" />',
      );
    }
    // `requireSystem` rather than `getSystem`: a scene that never declared `<ParticleRenderer>`
    // still gets one. Declaring it is only ever about ordering it against other systems.
    this.renderer = this.requireSystem(ParticleRenderer);
    this._system = this.renderer.createSystem(this);
    // three.quarks systems emit from the moment they are built.
    if (!this.playOnAwake) this.stop();
  }

  override onEnable(): void {
    if (this.wasPlaying) this.play();
  }

  override onDisable(): void {
    this.wasPlaying = this.isPlaying;
    this.pause();
  }

  override onDestroy(): void {
    this.renderer?.destroySystem(this);
    this.renderer = null;
    this._system = null;
  }

  // --- playback --------------------------------------------------------------------------

  /** True while the system is emitting or stepping its live particles. */
  get isPlaying(): boolean {
    return this.system !== null && !this.system.paused;
  }

  /** How many particles are alive right now. */
  get particleCount(): number {
    return this.system?.particleNum ?? 0;
  }

  /** Start, or resume after `pause()`. */
  play(): void {
    this.system?.play();
    this.wasPlaying = true;
  }

  /** Stop emitting and stepping, leaving the live particles where they are. */
  pause(): void {
    this.system?.pause();
  }

  /** Stop emitting and clear every live particle. */
  stop(): void {
    this.system?.stop();
    this.wasPlaying = false;
  }

  /** Clear the live particles and play the effect from the top. */
  restart(): void {
    this.system?.restart();
    this.wasPlaying = true;
  }
}
