import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';
import { Component } from '../runtime/Component.js';

/**
 * Plays the animation clips a glTF model ships with — Unity's `Animator`.
 *
 * The clips come from the model itself: instantiating one puts them on `Object3D.animations`,
 * and this takes the nearest node below that has any. Awaiting the model in `onLoad` means they
 * are there by `start`, so nothing here retries.
 */
export class Animator extends Component {
  /** The clip to play on start. Empty means the model's first. */
  clip = '';
  /** Repeat the clip rather than stopping at the end. */
  loop = true;
  /** Playback speed. `1` is the recorded speed; `0.5` is half. */
  speed = 1;
  /** Start playing as soon as the component starts. Unity's `playAutomatically`. */
  playOnStart = true;

  /** The live mixer. Null when there is no animated model below this node. */
  get mixer(): AnimationMixer | null {
    return this._mixer;
  }

  private _mixer: AnimationMixer | null = null;

  private clips: readonly AnimationClip[] = [];
  private action: AnimationAction | null = null;
  private appliedSpeed = 1;

  // --- lifecycle -------------------------------------------------------------------------

  override start(): void {
    const root = animatedNodeIn(this.object3D);
    if (!root) {
      console.error(
        `[scenoco] Animator on "${this.object3D.name || '(unnamed)'}" found no animated model ` +
          'below it. Put it on the node that holds a <Prefab src="…glb">, or above one.',
      );
      return;
    }
    this.clips = root.animations;
    this._mixer = new AnimationMixer(root);
    this._mixer.timeScale = this.speed;
    this.appliedSpeed = this.speed;
    if (this.playOnStart) this.play(this.clip);
  }

  override update(deltaTime: number): void {
    if (!this.mixer) return;
    // Polled rather than set behind a setter, so `speed` stays a plain authorable field.
    if (this.speed !== this.appliedSpeed) {
      this.mixer.timeScale = this.speed;
      this.appliedSpeed = this.speed;
    }
    this.mixer.update(deltaTime);
  }

  override onDestroy(): void {
    this.mixer?.stopAllAction();
    this._mixer = null;
    this.action = null;
  }

  // --- playback --------------------------------------------------------------------------

  /** The names this model has, for a script deciding what to play. */
  get clipNames(): readonly string[] {
    return this.clips.map((clip) => clip.name);
  }

  /** True while a clip is running. */
  get isPlaying(): boolean {
    return this.action?.isRunning() ?? false;
  }

  /** Play a clip from the start, cutting off whatever was playing. Unity's `Animator.Play`. */
  play(name = ''): void {
    const clip = this.find(name);
    if (!clip || !this.mixer) return;
    this.action?.stop();
    this.action = this.configure(this.mixer.clipAction(clip)).reset();
    this.action.play();
  }

  /**
   * Blend into another clip over `duration` seconds — Unity's `CrossFade`, and what to use
   * between locomotion states. `play` snaps.
   */
  crossFade(name: string, duration = 0.3): void {
    const clip = this.find(name);
    if (!clip || !this.mixer) return;
    const next = this.configure(this.mixer.clipAction(clip));
    if (this.action === next) return; // already going there
    next.reset().play();
    this.action?.crossFadeTo(next, duration, false);
    this.action = next;
  }

  /** Stop the current clip. The node stays wherever the clip left it. */
  stop(): void {
    this.action?.stop();
  }

  private find(name: string): AnimationClip | undefined {
    if (name === '') return this.clips[0];
    const clip = this.clips.find((candidate) => candidate.name === name);
    if (!clip) {
      // A wrong name is otherwise a character standing still with nothing to say why.
      console.error(
        `[scenoco] Animator: this model has no clip "${name}". It has: ` +
          `${this.clipNames.join(', ') || '(none)'}.`,
      );
    }
    return clip;
  }

  private configure(action: AnimationAction): AnimationAction {
    action.setLoop(this.loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !this.loop;
    return action;
  }
}

/**
 * The nearest node at or below `root` that carries clips — usually one level down, since the
 * component sits on the node the model was spawned under.
 */
function animatedNodeIn(root: Object3D): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((node) => {
    if (!found && node.animations.length > 0) found = node;
  });
  return found;
}
