import { BoxGeometry, DataTexture, Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '@scenoco-three/core';

const tex = () => new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);

describe('engine: deterministic RNG', () => {
  it('same seed yields the same stream; different seeds diverge', () => {
    const a = new Engine({ seed: 42 });
    const b = new Engine({ seed: 42 });
    const seqA = Array.from({ length: 5 }, () => a.random());
    const seqB = Array.from({ length: 5 }, () => b.random());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Engine({ seed: 43 }).random()).not.toBe(seqA[0]);
    a.dispose();
    b.dispose();
  });

  it('reseed restarts the stream and reports the seed', () => {
    const e = new Engine({ seed: 7 });
    const first = e.random();
    e.random();
    e.reseed(7);
    expect(e.seed).toBe(7);
    expect(e.random()).toBe(first);
    e.dispose();
  });

  it('randomRange / randomInt stay in bounds', () => {
    const e = new Engine({ seed: 1 });
    for (let i = 0; i < 200; i++) {
      const f = e.randomRange(5, 10);
      expect(f).toBeGreaterThanOrEqual(5);
      expect(f).toBeLessThan(10);
      expect([0, 1, 2]).toContain(e.randomInt(0, 3));
    }
    e.dispose();
  });
});

describe('engine: time & timeScale', () => {
  it('advances scaled/unscaled clocks and frame count', () => {
    const e = new Engine();
    e.timeScale = 0.5;
    e.tick(0.1);
    expect(e.deltaTime).toBeCloseTo(0.05);
    expect(e.time).toBeCloseTo(0.05);
    expect(e.unscaledTime).toBeCloseTo(0.1);
    expect(e.frameCount).toBe(1);
    e.dispose();
  });

  it('timeScale 0 pauses sim time but not wall-clock time', () => {
    const e = new Engine();
    e.tick(0.1);
    const t = e.time;
    e.timeScale = 0;
    e.tick(0.1);
    expect(e.deltaTime).toBe(0);
    expect(e.time).toBeCloseTo(t); // frozen
    expect(e.unscaledTime).toBeCloseTo(0.2); // still advancing
    e.dispose();
  });
});

describe('engine: interpolation alpha', () => {
  it('reports the fraction into the next fixed step, in [0, 1)', () => {
    const e = new Engine({ fixedTimeStep: 1 / 60 });
    e.tick(1 / 120); // half a fixed step, no full step consumed
    expect(e.interpolationAlpha).toBeGreaterThanOrEqual(0);
    expect(e.interpolationAlpha).toBeLessThan(1);
    expect(e.interpolationAlpha).toBeCloseTo(0.5, 1);
    e.dispose();
  });
});

describe('engine: texture disposal on scene unload', () => {
  it('frees material map textures and ShaderMaterial uniform textures', () => {
    const e = new Engine();
    const mapTex = tex();
    const uniformTex = tex();
    const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: mapTex }));
    const b = new Mesh(new BoxGeometry(), new ShaderMaterial({ uniforms: { uMap: { value: uniformTex } } }));
    e.scene.add(a, b);
    const mapSpy = vi.spyOn(mapTex, 'dispose');
    const uniformSpy = vi.spyOn(uniformTex, 'dispose');

    e.disposeScene();

    expect(mapSpy).toHaveBeenCalled();
    expect(uniformSpy).toHaveBeenCalled();
    e.dispose();
  });
});
