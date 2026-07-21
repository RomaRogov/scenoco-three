import { AnimationClip, Group, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Animator, EASINGS, Tween } from '@scenoco-three/animation';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

describe('Tween (programmatic)', () => {
  it('interpolates from → to, completes, and ships easing curves with 0/1 endpoints', () => {
    const out: number[] = [];
    const t = new Tween([0], [10], (v) => (out[0] = v[0]!), { duration: 1, easing: 'linear' });
    t.update(0.25);
    expect(out[0]).toBeCloseTo(2.5);
    t.update(0.75);
    expect(out[0]).toBeCloseTo(10);
    expect(t.done).toBe(true);
    for (const ease of Object.values(EASINGS)) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
  });

  it('respects delay, fires onComplete once, and pingpong oscillates without completing', () => {
    let completed = 0;
    const delayed = new Tween([0], [1], () => {}, { duration: 1, delay: 0.5, onComplete: () => completed++ });
    delayed.update(0.4);
    expect(delayed.done).toBe(false); // still in delay
    delayed.update(1.1);
    expect(delayed.done).toBe(true);
    delayed.update(1);
    expect(completed).toBe(1);

    const out: number[] = [];
    const pp = new Tween([0], [10], (v) => (out[0] = v[0]!), { duration: 1, easing: 'linear', loop: 'pingpong' });
    pp.update(0.5);
    expect(out[0]).toBeCloseTo(5); // forward
    pp.update(1.5); // phase 2.0 → back to start
    expect(out[0]).toBeCloseTo(0);
    expect(pp.done).toBe(false);
  });
});

describe('<Tween> component', () => {
  it('animates the node toward the target over its duration, flowing through engine.timeScale', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(compile('<Scene><Group id="g"><Components><Tween property="position" to="0 10 0" duration="1" easing="linear" /></Components></Group></Scene>')));
    engine.timeScale = 0.5;
    const g = engine.findObject('g')!;
    engine.tick(1); // scaled to 0.5s of tween time
    expect(g.position.y).toBeCloseTo(5);
    engine.dispose();
  });
});

// A fake loaded glTF: a scene root with a clip that moves it from y=0 to y=2 over 1s.
const clip = new AnimationClip('bob', 1, [new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 2, 0])]);
const fakeModel = () => ({ scene: new Group(), animations: [clip] });
const heroScene = (attrs = 'clip="bob" loop="false"') =>
  compile(`<Scene><Group id="hero"><Attachments><Model src="hero.glb" /></Attachments><Components><Animator ${attrs} /></Components></Group></Scene>`);

describe('<Animator> — glTF clip playback', () => {
  it('plays the model clip on start, advancing the mixer (drives the clone transform)', async () => {
    const engine = new Engine();
    engine.assets.registerLoader(['glb'], async () => fakeModel());
    await engine.loadSceneAsync(bundleScene(heroScene()));
    const clone = engine.findObject('hero')!.children[0]!;
    expect(clone.position.y).toBeCloseTo(0);
    engine.tick(0.5);
    expect(clone.position.y).toBeCloseTo(1, 1); // halfway through the 0→2 clip
    engine.dispose();
  });

  it('respects playOnStart=false until play() is called from code', async () => {
    const engine = new Engine();
    engine.assets.registerLoader(['glb'], async () => fakeModel());
    await engine.loadSceneAsync(bundleScene(heroScene('clip="bob" loop="false" playOnStart="false"')));
    const clone = engine.findObject('hero')!.children[0]!;
    engine.tick(0.5);
    expect(clone.position.y).toBeCloseTo(0); // not playing
    engine.findComponent('hero', Animator)!.play('bob');
    engine.tick(0.5);
    expect(clone.position.y).toBeCloseTo(1, 1);
    engine.dispose();
  });
});
