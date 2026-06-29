import { Vector3 } from 'three';
import { Component, component, property } from '@scenoco-three/core';
import { Tween, type LoopMode } from './Tween.js';
import { Easing, type EasingName, TweenLoop, TweenProperty } from './easing.js';

/**
 * Declaratively tween a node's `position`, `rotation`, or `scale` from its
 * current value to `to`, over `duration`, with an easing curve — the AI-friendly
 * alternative to animation tables. Self-driven (no system), so it respects the
 * engine's `timeScale`.
 *
 *   <Mesh><BoxGeometry /><MeshStandardMaterial />
 *     <Components>
 *       <Tween property="position" to="0 3 0" duration="1.5" easing="bounceOut" loop="pingpong" />
 *       <Tween property="rotation" to="0 6.283 0" duration="4" easing="linear" loop="loop" />
 *     </Components>
 *   </Mesh>
 *
 * Call `play()` / `stop()` to control it from code.
 */
@component({ name: 'Tween', description: 'Tween a node transform (position/rotation/scale) to a target.' })
export class TweenComponent extends Component {
  @property({ type: TweenProperty, default: 'position', description: 'Which transform to animate' })
  property = 'position';
  // A component `vec3` prop is instantiated as a Vector3 (math type), not an array.
  @property({ type: 'vec3', default: [0, 0, 0], description: 'Target value (animates from the current value)' })
  to = new Vector3();
  @property({ type: 'float', default: 1, description: 'Seconds for one pass' })
  duration = 1;
  @property({ type: Easing, default: 'quadInOut', description: 'Easing curve' })
  easing = 'quadInOut';
  @property({ type: TweenLoop, default: 'none', description: 'Loop mode (none, loop, or ping-pong)' })
  loop = 'none';
  @property({ type: 'float', default: 0, description: 'Delay before starting, seconds' })
  delay = 0;
  @property({ type: 'bool', default: true, description: 'Begin automatically on start' })
  playOnStart = true;

  private tween?: Tween;

  override start(): void {
    if (this.playOnStart) this.play();
  }

  /** Start (or restart) the tween from the node's current value. */
  play(): void {
    const [read, write] = this.channel();
    this.tween = new Tween(read(), this.to.toArray(), (v) => write(v), {
      duration: this.duration,
      easing: this.easing as EasingName,
      loop: this.loop as LoopMode,
      delay: this.delay,
    });
  }

  /** Stop the tween (leaves the node at its current value). */
  stop(): void {
    this.tween = undefined;
  }

  override update(dt: number): void {
    this.tween?.update(dt);
  }

  /** A read/write pair for the selected transform channel (x, y, z). */
  private channel(): [() => number[], (v: readonly number[]) => void] {
    const node = this.node;
    if (this.property === 'rotation') {
      return [
        () => [node.rotation.x, node.rotation.y, node.rotation.z],
        (v) => node.rotation.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0),
      ];
    }
    const vec = this.property === 'scale' ? node.scale : node.position;
    return [() => [vec.x, vec.y, vec.z], (v) => vec.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0)];
  }
}
