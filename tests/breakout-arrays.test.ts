import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, type Bundle } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, type ResourceResolver } from '@scenoco-three/compiler';
// Importing the example components registers them (and, transitively, the box2d
// tags + Physics2DSystem) — exactly what the Vite plugin / CLI do for the app.
import { Ball } from '../examples/breakout/components/Ball.js';
import { Brick } from '../examples/breakout/components/Brick.js';
import '../examples/breakout/components/PaddleController.js';
import '@scenoco-three/box2d';

const scenesDir = new URL('../examples/breakout/scenes/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, scenesDir)), 'utf8');

/** Resolve `brick.prefab.xml` from the example's scenes/ directory. */
const resolve: ResourceResolver = (request) =>
  request === 'brick.prefab.xml' ? { path: request, contents: read('brick.prefab.xml') } : null;

/** Compile the real example scene to a runtime bundle, the way the build would. */
function breakoutBundle(): Bundle {
  const result = compileSceneXml(read('breakout.scene.xml'), { path: 'breakout.scene.xml', resolve });
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.diagnostics)}`);
  return bundleScene(result.scene);
}

function ballOf(engine: Engine): Ball {
  const node = engine.scene.getObjectByName('ball')!;
  const ball = engine.getComponents(node).find((c) => c instanceof Ball) as Ball | undefined;
  if (!ball) throw new Error('Ball component not found');
  return ball;
}

describe('breakout example — prefab bricks referenced as an array (box2d)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('compiles the prefab-based scene and wires the bricks array + bounceSpeeds array', () => {
    const engine = new Engine();
    engine.loadScene(breakoutBundle());

    const ball = ballOf(engine);
    // The scalar `['float']` array arrives verbatim.
    expect(ball.bounceSpeeds).toEqual([8, 12, 16]);
    // The `[Brick]` reference array resolves to the 12 placed brick instances.
    expect(ball.bricks).toHaveLength(12);
    expect(ball.bricks.every((b) => b instanceof Brick)).toBe(true);
    // Each reference points at a real, distinct brick node in the scene.
    const b1 = engine.scene.getObjectByName('b1');
    expect(ball.bricks.map((b) => b.node)).toContain(b1 as Object3D);

    engine.dispose();
  });

  it('logs and destroys a brick when Box2D reports the ball hitting it', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(breakoutBundle());

    const ball = ballOf(engine);
    const before = ball.bricks.length;

    // Line the ball up under a brick column (x = 1.35) before the bodies are built
    // — the Physics2DSystem spawns each planck body at its node's position on the
    // first fixed step — then fire it straight up into the wall of bricks.
    engine.scene.getObjectByName('ball')!.position.set(1.35, 5, 0);
    engine.tick(1 / 60);
    ball['body']!.setVelocity(0, 14);

    const hit = () => ball.bricks.find((b) => b.destroyed);
    for (let i = 0; i < 240 && !hit(); i++) engine.tick(1 / 60);

    const struck = hit();
    expect(struck).toBeDefined();
    // The struck brick's node is removed from the scene…
    expect(struck!.node.parent).toBeNull();
    expect(ball.bricks.length).toBe(before); // the array still holds the (now-destroyed) refs
    // …and Box2D drove both the hit log and the random bounce re-roll.
    const messages = log.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('Brick hit!'))).toBe(true);
    expect(messages.some((m) => m.includes('bounce → speed'))).toBe(true);
    // Every logged bounce speed is one of the three declared candidates.
    const speeds = messages.flatMap((m) => {
      const match = /bounce → speed (\d+)/.exec(m);
      return match ? [Number(match[1])] : [];
    });
    expect(speeds.length).toBeGreaterThan(0);
    expect(speeds.every((s) => ball.bounceSpeeds.includes(s))).toBe(true);

    engine.dispose();
  });

  it('loses a life via the bottom sensor and parks the ball above the paddle', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = new Engine({ fixedTimeStep: 1 / 60 });
    engine.loadScene(breakoutBundle());

    const ball = ballOf(engine);
    expect(ball.lives).toBe(3);

    // Park the ball off to the side (clear of the paddle) before bodies build,
    // then drop it straight down through the bottom trigger.
    engine.scene.getObjectByName('ball')!.position.set(5, 5, 0);
    engine.tick(1 / 60);
    ball['body']!.setVelocity(0, -12);
    for (let i = 0; i < 120 && ball.lives === 3; i++) engine.tick(1 / 60);

    expect(ball.lives).toBe(2); // one life lost via onTriggerEnter2D
    const messages = log.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('Ball lost'))).toBe(true);
    // One more step syncs the node to the reset body position — parked above the paddle.
    engine.tick(1 / 60);
    expect(engine.scene.getObjectByName('ball')!.position.y).toBeGreaterThan(0);

    engine.dispose();
  });
});
