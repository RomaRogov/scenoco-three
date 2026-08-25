import { afterEach, describe, expect, it } from 'vitest';
import {
  Component,
  SceneManager,
  WaitForSeconds,
  WaitUntil,
  type IEnumerator,
} from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

describe('coroutines', () => {
  it('resumes on the next frame after `yield null`', async () => {
    const steps: number[] = [];
    class Walker extends Component {
      override start() { this.startCoroutine(this.walk()); }
      private *walk(): IEnumerator {
        steps.push(1);
        yield null;
        steps.push(2);
        yield null;
        steps.push(3);
      }
    }
    await SceneManager.load(sceneOf((s) => { s.createObject().addComponent(Walker); }));

    const clock = new Clock();
    clock.frame();
    expect(steps).toEqual([1]);
    clock.frames(2);
    expect(steps).toEqual([1, 2, 3]);
  });

  it('waits out a WaitForSeconds in scaled game time', async () => {
    let done = false;
    class Waiter extends Component {
      override start() { this.startCoroutine(this.run()); }
      private *run(): IEnumerator {
        yield new WaitForSeconds(0.5);
        done = true;
      }
    }
    await SceneManager.load(sceneOf((s) => { s.createObject().addComponent(Waiter); }));

    const clock = new Clock();
    clock.frames(4, 0.1);
    expect(done).toBe(false);
    clock.frames(3, 0.1);
    expect(done).toBe(true);
  });

  it('accepts a bare number as a seconds shorthand', async () => {
    let done = false;
    class Waiter extends Component {
      override start() { this.startCoroutine(this.run()); }
      private *run(): IEnumerator { yield 0.2; done = true; }
    }
    await SceneManager.load(sceneOf((s) => { s.createObject().addComponent(Waiter); }));
    new Clock().frames(6, 0.1);
    expect(done).toBe(true);
  });

  it('holds on a WaitUntil until its predicate turns true', async () => {
    let gate = false;
    let passed = false;
    class Waiter extends Component {
      override start() { this.startCoroutine(this.run()); }
      private *run(): IEnumerator { yield new WaitUntil(() => gate); passed = true; }
    }
    await SceneManager.load(sceneOf((s) => { s.createObject().addComponent(Waiter); }));

    const clock = new Clock();
    clock.frames(3);
    expect(passed).toBe(false);
    gate = true;
    clock.frames(2);
    expect(passed).toBe(true);
  });

  it('stops a component’s coroutines when it is destroyed, so an endless loop is safe', async () => {
    let ticks = 0;
    class Forever extends Component {
      override start() { this.startCoroutine(this.run()); }
      private *run(): IEnumerator { while (true) { ticks++; yield null; } }
    }
    let component!: Forever;
    await SceneManager.load(sceneOf((s) => {
      component = s.createObject().addComponent(Forever);
    }));

    const clock = new Clock();
    clock.frames(3);
    const before = ticks;
    expect(before).toBeGreaterThan(0);

    component.destroy();
    clock.frames(3);
    expect(ticks).toBe(before);
  });
});
