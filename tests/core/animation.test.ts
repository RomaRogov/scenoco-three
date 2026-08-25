import {
  AnimationClip,
  Bone,
  Group,
  NumberKeyframeTrack,
  Object3D,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { Easing, Group as TweenGroup, Tween } from 'three/addons/libs/tween.module.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Animator, AttachTo, Component, SceneManager, Time, Tweens } from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

/** A model as a loader hands one over: a node with clips on it. */
function animatedModel(): Object3D {
  const model = new Group();
  model.name = 'hero';
  const bone = new Bone();
  bone.name = 'mixamorig:RightHand';
  model.add(bone);
  model.animations = [
    new AnimationClip('Idle', 1, [new NumberKeyframeTrack('.scale[x]', [0, 1], [1, 1])]),
    new AnimationClip('Run', 1, [new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 2, 0])]),
  ];
  return model;
}

describe('Animator', () => {
  it('plays a clip the model arrived with, and crossfades to another', async () => {
    let animator!: Animator;
    await SceneManager.load(
      sceneOf((scene) => {
        const holder = scene.createObject('holder');
        holder.add(animatedModel());
        animator = holder.addComponent(Animator, { clip: 'Run', loop: true });
      }),
    );
    new Clock().frames(2);

    expect(animator.clipNames).toEqual(['Idle', 'Run']);
    expect(animator.isPlaying).toBe(true);
    animator.crossFade('Idle', 0.1);
    new Clock().frames(2);
    expect(animator.isPlaying).toBe(true);
  });

  it('says which clips the model has when the name is wrong', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await SceneManager.load(
      sceneOf((scene) => {
        const holder = scene.createObject('holder');
        holder.add(animatedModel());
        holder.addComponent(Animator, { clip: 'Sprint' });
      }),
    );
    new Clock().frame();
    expect(error.mock.calls[0]?.[0]).toContain('Idle, Run');
    error.mockRestore();
  });
});

describe('AttachTo', () => {
  it('reparents onto the named bone, keeping its local transform as the offset', async () => {
    let sword!: Object3D;
    let attach!: AttachTo;
    await SceneManager.load(
      sceneOf((scene) => {
        const hero = scene.createObject('hero');
        hero.add(animatedModel());
        sword = scene.createObject('sword');
        sword.position.set(0, 0.1, 0);
        attach = sword.addComponent(AttachTo, { target: hero, bone: 'mixamorig:RightHand' });
      }),
    );
    new Clock().frame();

    expect(attach.attached?.name).toBe('mixamorig:RightHand');
    expect(sword.parent).toBe(attach.attached);
    // The offset survives the move — it is what the document authored as a grip.
    expect(sword.position.y).toBeCloseTo(0.1);
    // And the bone carries it: the component does no per-frame work.
    attach.attached!.position.set(1, 2, 3);
    attach.attached!.updateMatrixWorld(true);
    expect(sword.getWorldPosition(new Vector3()).y).toBeCloseTo(2.1);
  });

  it('lists what the model does have when the bone name is wrong', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await SceneManager.load(
      sceneOf((scene) => {
        const hero = scene.createObject('hero');
        hero.add(animatedModel());
        scene.createObject('sword').addComponent(AttachTo, { target: hero, bone: 'LeftHand' });
      }),
    );
    new Clock().frame();
    expect(error.mock.calls[0]?.[0]).toContain('mixamorig:RightHand');
    error.mockRestore();
  });
});

describe('Tweens', () => {
  /**
   * The claim that made this worth having: a real tween library, running on the engine's clock,
   * so pause and slow motion reach it. Driven here with three.js's own bundled tween.js.
   */
  it('advances a tween.js group in scaled engine time', async () => {
    const node = new Object3D();
    const group = new TweenGroup();
    let runner!: Tweens;

    class Mover extends Component {
      override awake(): void {
        runner = this.requireSystem(Tweens).track(group);
      }
      override start(): void {
        runner.play(
          new Tween(this.object3D.position, group).to({ y: 10 }, 1000).easing(Easing.Linear.None),
        );
      }
    }

    await SceneManager.load(
      sceneOf((scene) => {
        scene.add(node);
        node.addComponent(Mover);
      }),
    );

    const clock = new Clock();
    clock.frames(30, 1 / 60); // half a second
    expect(node.position.y).toBeGreaterThan(3);
    expect(node.position.y).toBeLessThan(7);

    // A paused game is a stopped clock, so the tween stops with it — which is the whole reason
    // the engine ticks the library rather than the library ticking itself.
    const paused = node.position.y;
    Time.timeScale = 0;
    clock.frames(30, 1 / 60);
    expect(node.position.y).toBe(paused);

    Time.timeScale = 1;
    clock.frames(40, 1 / 60);
    expect(node.position.y).toBeCloseTo(10, 1);
  });

  it('stops advancing what it is told to forget', async () => {
    const ticked: number[] = [];
    const ticker = { update: (time: number) => ticked.push(time) };
    await SceneManager.load(sceneOf(() => {}));
    const tweens = SceneManager.activeScene!.requireSystem(Tweens);
    tweens.track(ticker);

    new Clock().frame();
    expect(ticked).toHaveLength(1);
    tweens.untrack(ticker);
    new Clock().frame();
    expect(ticked).toHaveLength(1);
  });
});
