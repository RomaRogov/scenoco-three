import { AnimationMixer, LoopOnce, LoopRepeat, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { Component, component, property, ValueType } from '@scenoco-three/core';

/**
 * Plays a model's **premade glTF animation clips** via a `THREE.AnimationMixer`
 * — the Unity `Animator` for SceNoCo. Put it on the same node as a `<Model>`; the
 * clips the model loaded are exposed on the clone's `userData.animations` and
 * picked up here automatically.
 *
 *   <Group>
 *     <Model src="hero.glb" />
 *     <Components><Animator clip="Run" loop="true" speed="1" /></Components>
 *   </Group>
 *
 * Mirrors Unity: `play(name)` (Animator.Play), `crossFade(name, duration)`
 * (Animator.CrossFade), `stop()`. Headless-safe (the mixer only mutates
 * transforms — no WebGL).
 */
@component({ name: 'Animator', description: "Plays a model's glTF animation clips (AnimationMixer)." })
export class Animator extends Component {
  @property({ type: ValueType.String, default: '', description: 'Clip name to play on start (empty = first clip)' })
  clip = '';
  @property({ type: ValueType.Bool, default: true, description: 'Loop the clip' }) loop = true;
  @property({ type: ValueType.Float, default: 1, description: 'Playback speed' }) speed = 1;
  @property({ type: ValueType.Bool, default: true, description: 'Play automatically on start (Unity playAutomatically)' })
  playOnStart = true;

  private mixer?: AnimationMixer;
  private clips: AnimationClip[] = [];
  private action?: AnimationAction;

  override start(): void {
    this.ensureMixer();
  }

  override update(dt: number): void {
    if (!this.mixer) this.ensureMixer(); // a model loaded via streaming may arrive after start
    this.mixer?.update(dt);
  }

  /** Play a clip by name (Unity `Animator.Play`); empty/unknown name → the first clip. */
  play(name = ''): void {
    if (!this.mixer) this.ensureMixer();
    const clip = this.clips.find((c) => c.name === name) ?? this.clips[0];
    if (!clip || !this.mixer) return;
    this.action = this.configure(this.mixer.clipAction(clip)).reset();
    this.action.play();
  }

  /** Crossfade from the current clip to another over `duration` seconds (Unity `Animator.CrossFade`). */
  crossFade(name: string, duration = 0.3): void {
    if (!this.mixer) this.ensureMixer();
    const clip = this.clips.find((c) => c.name === name);
    if (!clip || !this.mixer) return;
    const next = this.configure(this.mixer.clipAction(clip)).reset();
    next.play();
    if (this.action && this.action !== next) this.action.crossFadeTo(next, duration, false);
    this.action = next;
  }

  /** Stop the current clip. */
  stop(): void {
    this.action?.stop();
  }

  override onDestroy(): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
  }

  private configure(action: AnimationAction): AnimationAction {
    action.setLoop(this.loop ? LoopRepeat : LoopOnce, Infinity);
    return action;
  }

  /** Find the loaded model under this node and build the mixer (idempotent). */
  private ensureMixer(): void {
    if (this.mixer) return;
    let root: Object3D | undefined;
    this.node.traverse((o) => {
      if (!root && (o.userData.animations as unknown[] | undefined)?.length) root = o;
    });
    const clips = (root?.userData.animations as AnimationClip[] | undefined) ?? [];
    if (!root || clips.length === 0) return; // model not loaded yet
    this.clips = clips;
    this.mixer = new AnimationMixer(root);
    this.mixer.timeScale = this.speed;
    if (this.playOnStart) this.play(this.clip);
  }
}
