import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { Behaviour, Event } from '@scenoco-three/core';
import { containerFor, type SplineContainer } from './SplineContainer.js';
import { FrameReader } from './frames.js';

/**
 * Moves its node along a spline — Unity's `SplineAnimate`: a train on its track, a camera on a rail,
 * a racer that follows the line.
 *
 * ```tsx
 * <Mesh geometry={models.car.geometry}>
 *   <SplineAnimate container={track} animationMethod="speed" maxSpeed={20} loop="loopContinuous" />
 * </Mesh>
 * ```
 *
 * Aligned, the node's +Z points along the spline and +Y up from it.
 */
export class SplineAnimate extends Behaviour {
  /** The spline: a ref to the node holding the `SplineContainer`. Left out, the one on this node. */
  container: SplineContainer | Object3D | null = null;
  /** `'time'`: once along in `duration` seconds. `'speed'`: at `maxSpeed` world units a second. */
  animationMethod: 'time' | 'speed' = 'time';
  duration = 1;
  maxSpeed = 10;
  /** `'once'` stops at the end, `'loopContinuous'` starts over, `'pingPong'` turns back. */
  loop: 'once' | 'loopContinuous' | 'pingPong' = 'loopContinuous';
  /** `'splineElement'` turns the node with the spline; `'none'` only moves it. */
  alignment: 'splineElement' | 'none' = 'splineElement';
  playOnAwake = true;
  /** Where along the spline it starts, 0..1. */
  startOffset = 0;

  /** Raised when a `'once'` run reaches the end. */
  readonly completed = new Event();

  private time = 0;
  private playing = false;
  private reader: FrameReader | null = null;

  /** Playing now. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** Seconds since the start of this run. */
  get elapsedTime(): number {
    return this.time;
  }
  set elapsedTime(seconds: number) {
    this.time = Math.max(0, seconds);
    this.apply();
  }

  /** How far through one pass it is, 0..1 — a ping-pong's way back counts down. */
  get normalizedTime(): number {
    const period = this.period();
    if (period <= 0) return 0;
    const passes = this.time / period;
    if (this.loop === 'once') return Math.min(passes, 1);
    if (this.loop === 'loopContinuous') return passes % 1;
    const p = passes % 2;
    return p <= 1 ? p : 2 - p;
  }
  set normalizedTime(value: number) {
    this.elapsedTime = value * this.period();
  }

  override start(): void {
    this.reader = new FrameReader(containerFor(this, this.container, 'SplineAnimate'), this.node.parent);
    this.apply();
    if (this.playOnAwake) this.play();
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** Back to the start; playing again if `autoplay`. */
  restart(autoplay: boolean): void {
    this.time = 0;
    this.playing = autoplay;
    this.apply();
  }

  override update(dt: number): void {
    if (!this.playing) return;
    this.time += dt;
    if (this.loop === 'once' && this.time >= this.period()) {
      this.time = this.period();
      this.playing = false;
      this.apply();
      this.completed.emit();
      return;
    }
    this.apply();
  }

  private period(): number {
    if (this.animationMethod === 'time') return this.duration;
    const length = this.reader?.length ?? 0;
    return this.maxSpeed > 0 ? length / this.maxSpeed : 0;
  }

  private readonly basis = new Matrix4();
  private readonly left = new Vector3();

  private apply(): void {
    const reader = this.reader;
    if (!reader) return;
    // Past the end only with a start offset: it wraps round, as on a closed track.
    const t = this.startOffset + this.normalizedTime;
    const frame = reader.at(t > 1 ? t % 1 : t);
    this.node.position.copy(frame.position);
    if (this.alignment === 'none') return;
    this.left.copy(frame.right).negate();
    this.basis.makeBasis(this.left, frame.up, frame.forward);
    this.node.quaternion.copy(new Quaternion().setFromRotationMatrix(this.basis));
  }
}
