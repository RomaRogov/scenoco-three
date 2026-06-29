import { AnimationClip, Group, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Animator } from '@scenoco-three/animation';

// A fake loaded glTF: a scene root with a clip that moves it from y=0 to y=2 over 1s.
const clip = new AnimationClip('bob', 1, [new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 2, 0])]);
const fakeModel = () => ({ scene: new Group(), animations: [clip] });

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

const scene = (animatorAttrs = 'clip="bob" loop="false"') =>
  compile(`<Scene><Group id="hero"><Model src="hero.glb" /><Components><Animator ${animatorAttrs} /></Components></Group></Scene>`);

describe('<Animator> — glTF clip playback', () => {
  it('registers and compiles in a scene with a <Model>', () => {
    expect(scene().components.map((c) => c.type)).toContain('Animator');
  });

  it('plays the model clip, advancing the mixer (drives the clone transform)', async () => {
    const engine = new Engine();
    engine.assets.registerLoader(['glb'], async () => fakeModel());
    await engine.loadSceneAsync(bundleScene(scene()));

    const clone = engine.findObject('hero')!.children[0]!; // the <Model> clone
    expect(clone.position.y).toBeCloseTo(0);
    engine.tick(0.5);
    expect(clone.position.y).toBeCloseTo(1, 1); // halfway through the 0→2 clip
    engine.tick(0.4);
    expect(clone.position.y).toBeCloseTo(1.8, 1); // advancing toward the end
    engine.dispose();
  });

  it('respects playOnStart=false until play() is called from code', async () => {
    const engine = new Engine();
    engine.assets.registerLoader(['glb'], async () => fakeModel());
    await engine.loadSceneAsync(bundleScene(scene('clip="bob" loop="false" playOnStart="false"')));

    const hero = engine.findObject('hero')!;
    const clone = hero.children[0]!;
    engine.tick(0.5);
    expect(clone.position.y).toBeCloseTo(0); // not playing
    engine.findComponent('hero', Animator)!.play('bob');
    engine.tick(0.5);
    expect(clone.position.y).toBeCloseTo(1, 1);
    engine.dispose();
  });
});
