import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { EASINGS, Tween, TweenComponent } from '@scenoco-three/animation';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

describe('Tween (programmatic)', () => {
  it('interpolates from → to and completes (linear)', () => {
    const out: number[] = [];
    const t = new Tween([0], [10], (v) => (out[0] = v[0]!), { duration: 1, easing: 'linear' });
    t.update(0.25);
    expect(out[0]).toBeCloseTo(2.5);
    t.update(0.25);
    expect(out[0]).toBeCloseTo(5);
    t.update(0.5);
    expect(out[0]).toBeCloseTo(10);
    expect(t.done).toBe(true);
  });

  it('respects delay and fires onComplete once', () => {
    let completed = 0;
    const t = new Tween([0], [1], () => {}, { duration: 1, delay: 0.5, onComplete: () => completed++ });
    t.update(0.4);
    expect(t.done).toBe(false); // still in delay
    t.update(1.1);
    expect(t.done).toBe(true);
    t.update(1);
    expect(completed).toBe(1);
  });

  it('pingpong oscillates and never completes', () => {
    const out: number[] = [];
    const t = new Tween([0], [10], (v) => (out[0] = v[0]!), { duration: 1, easing: 'linear', loop: 'pingpong' });
    t.update(0.5);
    expect(out[0]).toBeCloseTo(5); // forward
    t.update(1.0); // now at phase 1.5 → returning
    expect(out[0]).toBeCloseTo(5);
    t.update(0.5); // phase 2.0 → back to start
    expect(out[0]).toBeCloseTo(0);
    expect(t.done).toBe(false);
  });

  it('ships the standard easing curves (endpoints are 0 and 1)', () => {
    for (const ease of Object.values(EASINGS)) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
  });
});

describe('<Tween> component', () => {
  const load = (attrs: string) => {
    const engine = new Engine();
    engine.loadScene(
      bundleScene(compile(`<Scene><Group id="g"><Components><Tween ${attrs} /></Components></Group></Scene>`)),
    );
    return engine;
  };

  it('animates the node position to the target over the duration', () => {
    const engine = load('property="position" to="0 10 0" duration="1" easing="linear"');
    const g = engine.findObject('g')!;
    engine.tick(0.5);
    expect(g.position.y).toBeCloseTo(5);
    engine.tick(0.5);
    expect(g.position.y).toBeCloseTo(10);
    engine.dispose();
  });

  it('flows through engine.timeScale (slow-motion)', () => {
    const engine = load('property="position" to="0 10 0" duration="1" easing="linear"');
    engine.timeScale = 0.5;
    const g = engine.findObject('g')!;
    engine.tick(1); // scaled to 0.5s of tween time
    expect(g.position.y).toBeCloseTo(5);
    engine.dispose();
  });

  it('play() can be controlled from code (playOnStart=false)', () => {
    const engine = load('property="scale" to="2 2 2" duration="1" easing="linear" playOnStart="false"');
    const g = engine.findObject('g')!;
    engine.tick(0.5);
    expect(g.scale.x).toBeCloseTo(1); // not started
    engine.findComponent('g', TweenComponent)!.play();
    engine.tick(0.5);
    expect(g.scale.x).toBeCloseTo(1.5);
    engine.dispose();
  });
});
