import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { Behaviour } from '../kernel/Behaviour.js';

/**
 * Unity's `Animator`, without a controller: the states are the model's clips, by name, and a
 * behaviour moves between them — `play('Run')`, `crossFade('Jump', 0.1)`. Put it on a model's
 * root, or on a node above one: it plays the first node at or below its own that carries clips
 * (`model.instantiate()` sets three's `animations` on the copy).
 *
 * Every state loops. For a one-shot, read `getCurrentAnimatorStateInfo().normalizedTime` — it
 * counts loops, as Unity's does, so `>= 1` means it has played through once.
 */
export class Animator extends Behaviour {
  /** Playback speed of every state: 1 normal, 0 frozen. */
  speed = 1;

  private mixer: AnimationMixer | null = null;
  private clips: readonly AnimationClip[] = [];
  private state: { name: string; action: AnimationAction; time: number } | null = null;
  private fadeEnds = 0;

  /** Jump to a state. Playing the current state again does nothing unless `normalizedTime` says where. */
  play(stateName: string, layer = -1, normalizedTime?: number): void {
    oneLayer(layer);
    if (this.state?.name === stateName && normalizedTime === undefined) return;
    this.enter(stateName, 0, normalizedTime ?? 0, true);
  }

  /** Blend into a state over a fraction of the current state's length. */
  crossFade(stateName: string, normalizedTransitionDuration: number, layer = -1, normalizedTimeOffset = 0): void {
    oneLayer(layer);
    const length = this.state?.action.getClip().duration ?? 0;
    this.fade(stateName, normalizedTransitionDuration * length, normalizedTimeOffset);
  }

  /** Blend into a state over `fixedTransitionDuration` seconds. Fading into the state already playing does nothing. */
  crossFadeInFixedTime(stateName: string, fixedTransitionDuration: number, layer = -1, fixedTimeOffset = 0): void {
    oneLayer(layer);
    const length = this.clip(stateName).duration;
    this.fade(stateName, fixedTransitionDuration, length > 0 ? fixedTimeOffset / length : 0);
  }

  /** Where the current state is: its name, its length, and how far through it — loops included. */
  getCurrentAnimatorStateInfo(layer = 0): AnimatorStateInfo {
    oneLayer(layer);
    const state = this.state;
    const length = state?.action.getClip().duration ?? 0;
    return {
      length,
      normalizedTime: state && length > 0 ? state.time / length : 0,
      speed: this.speed,
      isName: (name: string) => state?.name === name,
    };
  }

  /** Whether a blend from `crossFade` is still under way. */
  isInTransition(layer = 0): boolean {
    oneLayer(layer);
    return this.mixer !== null && this.mixer.time < this.fadeEnds;
  }

  override update(dt: number): void {
    if (!this.mixer || !this.state) return;
    const step = dt * this.speed;
    this.state.time += step;
    this.mixer.update(step);
  }

  override onDestroy(): void {
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.mixer.getRoot());
  }

  private fade(name: string, seconds: number, normalizedTime: number): void {
    if (this.state?.name !== name) this.enter(name, seconds, normalizedTime, false);
  }

  private enter(name: string, fade: number, normalizedTime: number, cut: boolean): void {
    const clip = this.clip(name);
    const mixer = this.mixer!;
    const action = mixer.clipAction(clip);
    action.reset();
    action.time = normalizedTime * clip.duration;
    action.play();
    const previous = this.state?.action;
    if (previous && previous !== action) {
      if (cut || fade <= 0) previous.stop();
      else previous.crossFadeTo(action, fade, false);
    }
    this.fadeEnds = cut || fade <= 0 ? 0 : mixer.time + fade;
    this.state = { name, action, time: action.time };
    mixer.update(0); // the pose shows this frame, not the next
  }

  /** A state by name, building the mixer on first use — the model may arrive after `awake`. */
  private clip(name: string): AnimationClip {
    if (!this.mixer) {
      const root = withClips(this.node);
      if (!root) {
        throw new Error(
          `Animator on "${this.node.name || this.node.type}" has no clips: put it on a model's root ` +
            '(instantiate(model) or model.instantiate()), or on a node above one.',
        );
      }
      this.clips = root.animations;
      this.mixer = new AnimationMixer(root);
    }
    const clip = this.clips.find((c) => c.name === name);
    if (!clip) throw new Error(`Animator has no state "${name}". Its states are the model's clips: ${this.clips.map((c) => `"${c.name}"`).join(', ')}.`);
    return clip;
  }
}

/** Unity's `AnimatorStateInfo`, for the one layer there is. */
export interface AnimatorStateInfo {
  /** Seconds in one pass of the state. */
  readonly length: number;
  /** Passes played: 0.5 halfway through the first, 2.25 a quarter into the third. */
  readonly normalizedTime: number;
  readonly speed: number;
  isName(name: string): boolean;
}

function withClips(node: Object3D): Object3D | undefined {
  let found: Object3D | undefined;
  node.traverse((n) => void (found ??= n.animations.length > 0 ? n : undefined));
  return found;
}

function oneLayer(layer: number): void {
  if (layer !== -1 && layer !== 0) throw new Error(`Animator has one layer, 0; layer ${layer} does not exist.`);
}
