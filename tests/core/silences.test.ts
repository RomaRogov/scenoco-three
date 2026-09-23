import { Mesh, Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Component,
  SceneManager,
  Time,
  WaitForFixedUpdate,
  type IEnumerator,
} from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

/**
 * Things the runtime used to do quietly and wrongly.
 *
 * None of these threw and none of them logged. Each one produced a game that was subtly off —
 * a coroutine that took two physics steps, a delta that was the frame's rather than the step's,
 * a component that kept ticking after `awake` switched its node off — and every one of them
 * costs a debugging session that starts in the wrong place.
 */
describe('a coroutine', () => {
  it('resumes with what the promise resolved to', async () => {
    const seen: unknown[] = [];
    class Fetcher extends Component {
      override start(): void {
        this.startCoroutine(this.run());
      }
      private *run(): IEnumerator {
        const answer = yield Promise.resolve(42);
        seen.push(answer);
      }
    }
    await SceneManager.load(sceneOf((scene) => scene.createObject('a').addComponent(Fetcher)));
    const clock = new Clock();
    clock.frame();
    await Promise.resolve();
    clock.frames(2);
    expect(seen).toEqual([42]);
  });

  it('throws a rejection at the yield, where the body can catch it', async () => {
    const seen: unknown[] = [];
    class Fetcher extends Component {
      override start(): void {
        this.startCoroutine(this.run());
      }
      private *run(): IEnumerator {
        try {
          yield Promise.reject(new Error('no'));
        } catch (error) {
          seen.push((error as Error).message);
        }
      }
    }
    await SceneManager.load(sceneOf((scene) => scene.createObject('a').addComponent(Fetcher)));
    const clock = new Clock();
    clock.frame();
    await Promise.resolve();
    clock.frames(2);
    expect(seen).toEqual(['no']);
  });

  it('can switch its own component off from inside itself', async () => {
    // `setActive(false)` stops the coroutines of everything on the node — including the one
    // asking for it, whose generator is on the stack. `return()` on a running generator throws
    // "Generator is already running", and `onDisable` never ran.
    const ran: string[] = [];
    class Suicide extends Component {
      override onDisable(): void {
        ran.push('onDisable');
      }
      override start(): void {
        this.startCoroutine(this.run());
      }
      private *run(): IEnumerator {
        yield null;
        this.object3D.setActive(false);
        // The rest of this statement block still runs, as it does in Unity — what must not
        // happen is another resume, or a throw out of the switch-off itself.
        yield null;
        ran.push('never');
      }
    }
    await SceneManager.load(sceneOf((scene) => scene.createObject('a').addComponent(Suicide)));
    const clock = new Clock();
    expect(() => clock.frames(3)).not.toThrow();
    expect(ran).toEqual(['onDisable']);
  });

  it('waits one fixed step for WaitForFixedUpdate, not two', async () => {
    const elapsed: number[] = [];
    class Stepper extends Component {
      private fixed = 0;
      override fixedUpdate(): void {
        this.fixed += 1;
      }
      override start(): void {
        this.startCoroutine(this.run());
      }
      private *run(): IEnumerator {
        const before = this.fixed;
        yield new WaitForFixedUpdate();
        elapsed.push(this.fixed - before);
      }
    }
    Time.fixedDeltaTime = 1 / 60;
    await SceneManager.load(sceneOf((scene) => scene.createObject('a').addComponent(Stepper)));
    new Clock().frames(4, 1 / 60);
    expect(elapsed[0]).toBe(1);
  });
});

describe('a fixed step', () => {
  it('makes Time.deltaTime the step, and puts the frame delta back after', async () => {
    const inside: number[] = [];
    class Probe extends Component {
      override fixedUpdate(): void {
        inside.push(Time.deltaTime);
      }
    }
    Time.fixedDeltaTime = 1 / 50;
    await SceneManager.load(sceneOf((scene) => scene.createObject('a').addComponent(Probe)));
    new Clock().frames(4, 1 / 10);
    expect(inside.every((delta) => delta === 1 / 50)).toBe(true);
    expect(Time.deltaTime).toBeCloseTo(1 / 10);
  });
});

describe('awake', () => {
  it('is believed when it switches its own node off', async () => {
    const ticks: string[] = [];
    class Sleeper extends Component {
      override awake(): void {
        this.object3D.setActive(false);
      }
      override onEnable(): void {
        ticks.push('onEnable');
      }
      override update(): void {
        ticks.push('update');
      }
    }
    await SceneManager.load(sceneOf((scene) => scene.createObject('a').addComponent(Sleeper)));
    new Clock().frames(3);
    expect(ticks).toEqual([]);
  });
});

describe('a destroyed component', () => {
  it('says so, instead of failing on a null node', async () => {
    class Gone extends Component {}
    let gone!: Gone;
    await SceneManager.load(
      sceneOf((scene) => {
        gone = scene.createObject('a').addComponent(Gone);
      }),
    );
    gone.destroy();
    new Clock().frames(2);
    expect(() => gone.getComponent(Gone)).toThrow(/has been destroyed/);
    expect(() => gone.object3D).toThrow(/has been destroyed/);
  });
});

describe('a node taken out of the tree', () => {
  it('is named once, because remove() ends nothing', async () => {
    class Listener extends Component {}
    let node!: Object3D;
    await SceneManager.load(
      sceneOf((scene) => {
        node = scene.createObject('stray');
        node.addComponent(Listener);
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      node.removeFromParent();
      new Clock().frames(3);
      const said = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('not destroyed'));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('Listener');
      expect(said[0]).toContain('remove() only detaches');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('SceneManager.load', () => {
  it('says to pass the class when it is handed a scene', async () => {
    const Level = sceneOf(() => {});
    await expect(SceneManager.load(new Level() as never)).rejects.toThrow(/takes a scene class, not a scene/);
  });

  it('runs two overlapping loads one after the other, leaving one loaded', async () => {
    const A = sceneOf(() => {});
    const B = sceneOf(() => {});
    await Promise.all([SceneManager.load(A), SceneManager.load(B)]);
    expect(SceneManager.loadedScenes).toHaveLength(1);
    expect(SceneManager.isLoaded(B)).toBe(true);
  });
});

describe('a spawn under a parent that is not in a scene yet', () => {
  it('still answers to its id once the subtree is added', async () => {
    class Body extends Component {}
    await SceneManager.load(
      sceneOf((scene) => {
        // Built detached, the way a prefab builds its own contents, then added in one go.
        const rig = new Object3D();
        const template = new Mesh();
        template.addComponent(Body);
        rig.instantiate(template, { id: 'slime3' });
        scene.add(rig);
      }),
    );
    expect(SceneManager.activeScene!.byId('slime3')).not.toBeNull();
  });
});
