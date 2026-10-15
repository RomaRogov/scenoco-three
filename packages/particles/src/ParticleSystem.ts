import { Behaviour, service } from '@scenoco-three/core';
import type { ParticleSystem as QuarksSystem } from 'three.quarks';
import type { ParticleEffect } from './config.js';
import { ParticleRenderer } from './ParticleRenderer.js';

/**
 * Plays a particle effect on this node — Unity's Shuriken `ParticleSystem`.
 *
 * ```ts
 * // vfx.ts — an effect is data, typed by `ParticleEffect`
 * export const fire: ParticleEffect = { duration: 3, startSize: 0.4, emission: { rateOverTime: 20 } };
 * ```
 * ```tsx
 * <Group position={[0, 1.2, 0]}>
 *   <ParticleSystem effect={vfx.fire} />
 * </Group>
 * ```
 *
 * Disabling it pauses the effect and leaves its live particles standing; `stop()` clears them.
 */
export class ParticleSystem extends Behaviour {
  /** The effect to play. */
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
    if (!this.effect) throw new Error('ParticleSystem has no effect. Give it one: <ParticleSystem effect={vfx.fire} />, with fire a ParticleEffect.');
    this.renderer = service(this.node, ParticleRenderer);
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
