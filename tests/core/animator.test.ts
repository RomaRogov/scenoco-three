import { afterEach, describe, expect, it } from 'vitest';
import { AnimationClip, Group, Scene, VectorKeyframeTrack } from 'three';
import { Animator, Runtime, addComponent, wake } from '@scenoco-three/core';

const runtimes: Runtime[] = [];
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

/** A model's root as `model.instantiate()` leaves it: clips on three's `animations`. */
function model(): Group {
  const root = new Group();
  const slide = (name: string, x: number) => new AnimationClip(name, 1, [new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, x, 0, 0])]);
  root.animations = [slide('Idle', 0), slide('Run', 10)];
  return root;
}

describe('Animator', () => {
  it('plays a model’s clips by name, counts passes, and names the states it has', () => {
    const world = new Scene();
    const runtime = new Runtime(world);
    runtimes.push(runtime);
    const holder = new Group(); // on a node above the model, as in Unity's prefab of a model
    holder.add(model());
    world.add(holder);
    const animator = addComponent(holder, Animator);
    wake(holder);
    const pose = () => holder.children[0]!.position.x;

    animator.play('Run');
    for (let i = 0; i < 30; i++) runtime.update(1 / 60);
    expect(pose()).toBeCloseTo(5, 1);
    expect(animator.getCurrentAnimatorStateInfo().isName('Run')).toBe(true);
    for (let i = 0; i < 60; i++) runtime.update(1 / 60);
    expect(animator.getCurrentAnimatorStateInfo().normalizedTime).toBeCloseTo(1.5, 1); // it loops, and counts

    animator.crossFadeInFixedTime('Idle', 0.5);
    expect(animator.isInTransition()).toBe(true);
    for (let i = 0; i < 60; i++) runtime.update(1 / 60);
    expect(animator.isInTransition()).toBe(false);
    expect(pose()).toBeCloseTo(0, 3);

    expect(() => animator.play('Walk')).toThrow('Animator has no state "Walk". Its states are the model\'s clips: "Idle", "Run".');
  });
});
