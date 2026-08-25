import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';
import { Component } from './Component.js';

/**
 * Plays the animation clips a glTF model ships with — Unity's `Animator`.
 *
 * ```xml
 * <Group>
 *   <Prefab src="../models/hero.glb" />
 *   <Components>
 *     <Animator clip="Run" loop="true" speed="1" />
 *   </Components>
 * </Group>
 * ```
 *
 * ```ts
 * class Hero extends Component {
 *   animator!: Animator;
 *   override update() {
 *     this.animator.crossFade(this.moving ? 'Run' : 'Idle', 0.2);
 *   }
 * }
 * ```
 *
 * `play` is Unity's `Animator.Play`, `crossFade` its `CrossFade`, `speed` its `speed`. The clips
 * come from the model itself: `Model.instantiate` puts them on `Object3D.animations`, three.js's
 * own field for them, and this looks for the nearest node below that has any.
 *
 * ### Why this is in core
 *
 * Clips arrive on `Object3D.animations` when a glTF is instantiated, and glTF loading is core's
 * (`Model`, `sharedModel`, `loadAssets`). A player for them in a separate optional package meant
 * a project that loaded an animated model still had to know to install *and* import something
 * else before it could press play on what it already had.
 *
 * ### What it no longer does
 *
 * v1 rebuilt its mixer in `update` every frame until one appeared, because a model streamed in
 * at some unknown point after `start`. A scene now awaits its models before it builds anything,
 * so the clips are there in `start` — the retry, and the whole class of "it worked on the second
 * frame" bug that comes with it, is gone.
 *
 * The mixer only writes transforms, so this runs headless.
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
  mixer: AnimationMixer | null = null;

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
    this.mixer = new AnimationMixer(root);
    this.mixer.timeScale = this.speed;
    this.appliedSpeed = this.speed;
    if (this.playOnStart) this.play(this.clip);
  }

  override update(deltaTime: number): void {
    if (!this.mixer) return;
    // Assigning `speed` is how a script changes it, so the change has to reach three.js
    // somewhere. Here, rather than behind a setter, keeps the field a plain field — which is
    // what makes it an attribute the compiler can read.
    if (this.speed !== this.appliedSpeed) {
      this.mixer.timeScale = this.speed;
      this.appliedSpeed = this.speed;
    }
    this.mixer.update(deltaTime);
  }

  override onDestroy(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
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
   * Blend into another clip over `duration` seconds — Unity's `Animator.CrossFade`.
   *
   * This is the one to reach for between locomotion states; `play` snaps, which reads as a
   * glitch on anything a character is doing.
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
      // A wrong name is otherwise a character standing perfectly still with nothing to say why,
      // so the message lists what the model actually has.
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
 * The nearest node at or below `root` that carries clips.
 *
 * An `<Animator>` sits on the node a `<Prefab src="…glb">` was spawned under, so the clips are
 * usually one level down — but putting the component on the model's own root has to work too.
 */
function animatedNodeIn(root: Object3D): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((node) => {
    if (!found && node.animations.length > 0) found = node;
  });
  return found;
}
