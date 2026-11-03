import { afterEach, describe, expect, it, vi } from 'vitest';
import { Euler, Group, MeshBasicMaterial, Object3D, Quaternion, Scene, Vector3 } from 'three';
import { Behaviour, Ease, LoopType, RotateMode, Time, Tween, destroy, simulate, type Simulation, type Yieldable } from '@scenoco-three/core';

let game: Simulation;
afterEach(() => game?.dispose());

function start(): Object3D {
  const node = new Group();
  game = simulate(() => {
    const scene = new Scene();
    scene.add(node);
    return scene;
  });
  return node;
}

describe('Tween', () => {
  it('moves a node to its end, on the curve, after its delay, and is spent', () => {
    const node = start();
    const done = vi.fn();
    const tween = node.doLocalMove(new Vector3(10, 0, 0), 1).setEase(Ease.Linear).setDelay(0.5).onComplete(done);
    game.step(1); // the frame it was made in has gone: from here it runs
    game.step(30, 1 / 60);
    expect(node.position.x).toBeCloseTo(0, 5);
    game.step(30, 1 / 60);
    expect(node.position.x).toBeCloseTo(5, 5);
    game.step(31, 1 / 60);
    expect(node.position.x).toBe(10);
    expect(done).toHaveBeenCalledOnce();
    expect(tween.isActive()).toBe(false);
  });

  it('holds at timeScale 0, and setUpdate(true) does not', () => {
    const node = start();
    node.doLocalMoveX(1, 1).setEase(Ease.Linear);
    node.doScaleX(3, 1).setEase(Ease.Linear).setUpdate(true);
    game.step(2);
    const x = node.position.x;
    const scale = node.scale.x;
    Time.timeScale = 0;
    game.step(10);
    expect(node.position.x).toBe(x);
    expect(node.scale.x).toBeGreaterThan(scale);
    Time.timeScale = 1;
  });

  it('moves in the world under a moved parent', () => {
    const node = start();
    const parent = new Group();
    parent.position.set(5, 0, 0);
    node.parent!.add(parent);
    parent.add(node);
    node.doMove(new Vector3(6, 0, 0), 0.1);
    game.step(20);
    expect(node.position.x).toBeCloseTo(1, 5);
  });

  it('ends with its node, without calling onComplete', () => {
    const node = start();
    const done = vi.fn();
    const tween = node.doLocalMoveX(1, 1).onComplete(done);
    game.step(2);
    destroy(node);
    game.step(120);
    expect(tween.isActive()).toBe(false);
    expect(done).not.toHaveBeenCalled();
  });

  it('runs a sequence: appended after, joined beside, callbacks in order, as one thing to wait on', () => {
    const node = start();
    const log: string[] = [];
    const tween = Tween.sequence()
      .append(node.doLocalMoveX(1, 0.5).setEase(Ease.Linear).onComplete(() => log.push('moved')))
      .join(node.doScaleX(2, 0.5).setEase(Ease.Linear))
      .appendInterval(0.5)
      .appendCallback(() => log.push('called'))
      .append(node.doLocalMoveY(1, 0.5).setEase(Ease.Linear))
      .onComplete(() => log.push('done'));
    game.step(1);
    game.step(15);
    expect(node.position.x).toBeCloseTo(0.5, 5);
    expect(node.scale.x).toBeCloseTo(1.5, 5);
    expect(node.position.y).toBe(0);
    game.step(46);
    expect(log).toEqual(['moved', 'called']);
    game.step(31);
    expect(node.position.y).toBe(1);
    expect(log).toEqual(['moved', 'called', 'done']);
    expect(tween.isActive()).toBe(false);
  });

  it('loops: yoyo comes back, incremental carries on, relative adds, from starts elsewhere', () => {
    const node = start();
    node.doLocalMoveX(1, 0.5).setEase(Ease.Linear).setLoops(2, LoopType.Yoyo);
    node.doLocalMoveY(1, 0.5).setEase(Ease.Linear).setLoops(3, LoopType.Incremental);
    node.scale.set(2, 1, 1);
    node.doScaleX(3, 0.5).setRelative();
    node.doScaleZ(5, 0.5).from();
    expect(node.scale.z).toBe(5);
    game.step(100);
    expect(node.position.x).toBe(0);
    expect(node.position.y).toBe(3);
    expect(node.scale.x).toBe(5);
    expect(node.scale.z).toBe(1);
  });

  it('turns: the short way by default, whole turns when asked; punch and shake end where they began', () => {
    const node = start();
    node.doLocalRotate(new Euler(0, Math.PI * 4, 0), 1, RotateMode.FastBeyond360).setEase(Ease.Linear);
    game.step(1);
    game.step(15);
    game.step(60);
    expect(node.quaternion.angleTo(new Quaternion())).toBeCloseTo(0, 5);
    node.position.set(1, 2, 3);
    node.doPunchPosition(new Vector3(0, 1, 0), 0.5);
    node.doShakeScale(0.5, 0.5);
    game.step(10);
    expect(node.position.y).not.toBe(2);
    game.step(40);
    expect(node.position.toArray()).toEqual([1, 2, 3]);
    expect(node.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('fades a material, making it transparent; a generic value and a delayed call run on the same clock', () => {
    start();
    const material = new MeshBasicMaterial();
    let hp = 10;
    const called = vi.fn();
    material.doFade(0, 0.1);
    Tween.to(() => hp, (v) => (hp = v), 0, 0.1);
    Tween.delayedCall(0.1, called);
    expect(material.transparent).toBe(true);
    game.step(10);
    expect(material.opacity).toBe(0);
    expect(hp).toBe(0);
    expect(called).toHaveBeenCalledOnce();
  });

  it('is waited on in a coroutine, and killed by its target', () => {
    const log: string[] = [];
    const node = new Group();
    class Waits extends Behaviour {
      override start() {
        this.startCoroutine(this.run());
      }
      *run(): Generator<Yieldable> {
        yield node.doLocalMoveX(1, 0.1).waitForCompletion();
        log.push(`at ${node.position.x}`);
      }
    }
    game = simulate(() => {
      const scene = new Scene();
      scene.add(node);
      node.addComponent(Waits);
      return scene;
    });
    game.step(20);
    expect(log).toEqual(['at 1']);
    const kept = node.doLocalMoveX(5, 1);
    game.step(2);
    node.doKill();
    const x = node.position.x;
    game.step(10);
    expect(kept.isActive()).toBe(false);
    expect(node.position.x).toBe(x);
  });

  it('reads an angle by its type: a Vector3 holds degrees, an Euler radians; relative adds', () => {
    const node = start();
    node.doLocalRotate(new Vector3(0, 90, 0), 0.1);
    game.step(10);
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    node.doLocalRotate(new Euler(0, Math.PI / 4, 0), 0.1);
    game.step(10);
    expect(node.rotation.y).toBeCloseTo(Math.PI / 4, 5);
  });

  it('says each loop ended, and refuses a tween yielded bare with the line to write', () => {
    const node = start();
    const steps = vi.fn();
    node.doLocalMoveX(1, 0.1).setLoops(3).onStepComplete(steps);
    game.step(40);
    expect(steps).toHaveBeenCalledTimes(3);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Bare extends Behaviour {
      override start() {
        this.startCoroutine(this.run());
      }
      *run(): Generator<unknown, void, void> {
        yield node.doLocalMoveX(0, 0.1);
      }
    }
    node.addComponent(Bare);
    game.step(3);
    expect(String(errors.mock.calls[0]?.[1])).toMatch(/yield tween\.waitForCompletion\(\)/);
    errors.mockRestore();
  });

  it('follows the standard curves', () => {
    expect(Ease.OutBack(1)).toBeCloseTo(1, 10);
    expect(Ease.InBack(0.5)).toBeCloseTo(-0.0876975, 5);
    expect(Ease.OutBounce(0.5)).toBeCloseTo(0.765625, 5);
    expect(Ease.InElastic(0.5)).toBeCloseTo(-0.015625, 5);
    expect(Ease.OutElastic(0.5)).toBeCloseTo(1.015625, 5);
  });
});
