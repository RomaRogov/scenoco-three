import { Color, Group, Scene } from 'three';
import { BatchedRenderer } from 'three.quarks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneManager, type SceneType } from '@scenoco-three/core';
import {
  ParticleRenderer,
  ParticleSystem,
  configToParameters,
  type ParticleConfig,
} from '@scenoco-three/particles';
import { Clock, resetEngine } from '../core/helpers.js';

afterEach(resetEngine);

/** A scene built by a callback, the shape generated scene code takes. */
function sceneOf(build: (scene: Scene) => void): SceneType {
  return class extends Scene {
    override onLoad(): void {
      build(this);
    }
  };
}

/** What `fire.particle.xml` compiles to — a plain typed value, the way a geometry does. */
const FIRE: ParticleConfig = {
  duration: 2,
  looping: true,
  startLifetime: 1,
  startSpeed: 2,
  startColor: new Color(0xffdd66),
  rateOverTime: 120,
  bursts: [{ time: 0, count: 5 }],
  shape: { type: 'Sphere', radius: 0.5 },
  colorOverLifetime: [new Color(0xffee88), new Color(0x661100)],
  sizeOverLifetime: [1, 0],
};

function emitterIn(scene: Scene, effect: ParticleConfig = FIRE, init: Partial<ParticleSystem> = {}) {
  const node = new Group();
  scene.add(node);
  // Through `init`, which is what generated code does: the effect is in place before `awake`,
  // so the three.quarks system is built from it rather than patched afterwards.
  return node.addComponent(ParticleSystem, { effect, ...init });
}

describe('the renderer', () => {
  it('is created on demand by the first emitter, and lives in the scene graph', async () => {
    const scene = await SceneManager.load(sceneOf((s) => { emitterIn(s); }));
    const renderer = scene.getSystem(ParticleRenderer)!;
    expect(renderer).toBeInstanceOf(ParticleRenderer);
    // A BatchedRenderer only draws if something renders it, which means being in the graph.
    expect(scene.children).toContain(renderer.renderer);
    expect(renderer.renderer).toBeInstanceOf(BatchedRenderer);
  });

  it('batches every emitter in the scene through one renderer', async () => {
    const scene = await SceneManager.load(
      sceneOf((s) => {
        emitterIn(s);
        emitterIn(s);
        emitterIn(s);
      }),
    );
    expect(scene.children.filter((c) => c instanceof BatchedRenderer)).toHaveLength(1);
  });

  it('parents the emitter under the node, so moving the node moves the effect', async () => {
    let emitter!: ParticleSystem;
    await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s); }));
    expect(emitter.system!.emitter.parent).toBe(emitter.object3D);
  });

  it('frees every system when the scene unloads', async () => {
    let emitter!: ParticleSystem;
    const scene = await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s); }));
    const renderer = scene.getSystem(ParticleRenderer)!;
    const batched = renderer.renderer;
    await SceneManager.unload(scene.constructor as SceneType);
    expect(emitter.system).toBeNull();
    expect(batched.parent).toBeNull();
  });
});

describe('an emitter', () => {
  it('emits its burst and steps its particles with the frame', async () => {
    let emitter!: ParticleSystem;
    await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s); }));
    const clock = new Clock();

    clock.frames(3);
    expect(emitter.isPlaying).toBe(true);
    expect(emitter.particleCount).toBeGreaterThan(0);
  });

  /**
   * The compiler is the first line here: `effect` is declared `effect!: ParticleConfig`, so a
   * document that omits it is a `missing-attribute` build error. This is the second line, for
   * an emitter built in code — and it reports rather than throwing outward, because core
   * catches what a lifecycle hook throws so one bad component cannot take down the frame.
   */
  it('reports a missing effect and stays inert, naming what to write', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let emitter!: ParticleSystem;
    await SceneManager.load(
      sceneOf((s) => {
        const node = new Group();
        s.add(node);
        emitter = node.addComponent(ParticleSystem);
      }),
    );
    const clock = new Clock();
    clock.frames(3);

    expect(emitter.system).toBeNull();
    expect(emitter.particleCount).toBe(0);
    expect(String(errors.mock.calls.at(0))).toContain('ParticleSystem.awake() threw');
    expect(String(errors.mock.calls.at(0))).toContain('effect="../vfx/fire.particle.xml"');
    errors.mockRestore();
  });

  it('stays silent when playOnAwake is false, until something plays it', async () => {
    let emitter!: ParticleSystem;
    await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s, FIRE, { playOnAwake: false }); }));
    const clock = new Clock();

    clock.frames(5);
    expect(emitter.isPlaying).toBe(false);
    expect(emitter.particleCount).toBe(0);

    emitter.play();
    clock.frames(3);
    expect(emitter.particleCount).toBeGreaterThan(0);
  });

  it('pauses with the component and resumes where it left off', async () => {
    let emitter!: ParticleSystem;
    await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s); }));
    const clock = new Clock();
    clock.frames(3);
    const alive = emitter.particleCount;
    expect(alive).toBeGreaterThan(0);

    emitter.enabled = false;
    clock.frames(10);
    // Disabling pauses: the live particles stand rather than being cleared.
    expect(emitter.isPlaying).toBe(false);
    expect(emitter.particleCount).toBe(alive);

    emitter.enabled = true;
    clock.frames(1);
    expect(emitter.isPlaying).toBe(true);
  });

  it('does not restart an emitter that was stopped before it was disabled', async () => {
    let emitter!: ParticleSystem;
    await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s); }));
    const clock = new Clock();
    clock.frames(2);

    emitter.stop();
    emitter.enabled = false;
    emitter.enabled = true;
    clock.frames(3);
    expect(emitter.isPlaying).toBe(false);
  });

  it('clears its particles on stop and fills again on restart', async () => {
    let emitter!: ParticleSystem;
    await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s); }));
    const clock = new Clock();
    clock.frames(3);
    expect(emitter.particleCount).toBeGreaterThan(0);

    emitter.stop();
    clock.frames(1);
    expect(emitter.particleCount).toBe(0);

    emitter.restart();
    clock.frames(3);
    expect(emitter.particleCount).toBeGreaterThan(0);
  });

  it('leaves the renderer when destroyed', async () => {
    let emitter!: ParticleSystem;
    const scene = await SceneManager.load(sceneOf((s) => { emitter = emitterIn(s); }));
    const node = emitter.object3D;
    const clock = new Clock();
    clock.frames(2);

    node.destroy();
    clock.frames(1);
    expect(emitter.system).toBeNull();
    // Stepping the renderer after the emitter is gone must not reach a disposed system.
    expect(() => clock.frames(3)).not.toThrow();
    expect(scene.getSystem(ParticleRenderer)).toBeInstanceOf(ParticleRenderer);
  });
});

describe('the effect, as three.quarks sees it', () => {
  it('reads a THREE.Color rather than a hex number', () => {
    const parameters = configToParameters({ startColor: new Color(0x336699) });
    // three.quarks wants linear rgb in a Vector4; a Color already is one.
    const color = (parameters.startColor as { color: { x: number; y: number; z: number } }).color;
    const expected = new Color(0x336699);
    expect(color.x).toBeCloseTo(expected.r);
    expect(color.y).toBeCloseTo(expected.g);
    expect(color.z).toBeCloseTo(expected.b);
  });

  it('converts the authored degrees to the radians three.quarks wants', () => {
    const parameters = configToParameters({ startRotation: 180 });
    expect((parameters.startRotation as { value: number }).value).toBeCloseTo(Math.PI);
  });

  it('adds a behavior only for the modules the effect actually declares', () => {
    expect(configToParameters({}).behaviors).toHaveLength(0);
    expect(
      configToParameters({ gravityModifier: 1, sizeOverLifetime: [1, 0], noise: { strength: 1 } })
        .behaviors,
    ).toHaveLength(3);
  });

  it('spells World simulation space as three.quarks’ worldSpace', () => {
    expect(configToParameters({ simulationSpace: 'World' }).worldSpace).toBe(true);
    expect(configToParameters({}).worldSpace).toBe(false);
  });
});
