import { afterEach, describe, expect, it } from 'vitest';
import { Component, Event, SceneManager } from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

class Brick extends Component {
  points = 10;
  /** A class field, not a string name — every subscriber is checked by the compiler. */
  readonly destroyed = new Event<[Brick]>();
  hit() { this.destroyed.emit(this); }
}

class Scoreboard extends Component {
  bricks: Brick[] = [];
  score = 0;
  override start() { for (const brick of this.bricks) this.listen(brick.destroyed, this.onBrick); }
  private onBrick = (brick: Brick) => { this.score += brick.points; };
}

describe('typed events', () => {
  it('delivers to every listener in subscription order', () => {
    const event = new Event<[number]>();
    const seen: string[] = [];
    event.on((n) => seen.push(`a${n}`));
    event.on((n) => seen.push(`b${n}`));
    event.emit(1);
    expect(seen).toEqual(['a1', 'b1']);
  });

  it('survives a listener unsubscribing mid-dispatch', () => {
    const event = new Event<[]>();
    const seen: string[] = [];
    const second = () => seen.push('second');
    event.on(() => { event.off(second); seen.push('first'); });
    event.on(second);
    event.emit();
    // The dispatch iterates a snapshot, so the removal takes effect from the next emit.
    expect(seen).toEqual(['first', 'second']);
    event.emit();
    expect(seen).toEqual(['first', 'second', 'first']);
  });

  it('once() fires a single time', () => {
    const event = new Event<[]>();
    let calls = 0;
    event.once(() => calls++);
    event.emit();
    event.emit();
    expect(calls).toBe(1);
  });

  it('unsubscribes a listening component when it is destroyed', async () => {
    let brick!: Brick;
    let board!: Scoreboard;
    await SceneManager.load(sceneOf((scene) => {
      brick = scene.createObject('brick').addComponent(Brick);
      board = scene.createObject('hud').addComponent(Scoreboard);
      board.bricks = [brick];
    }));

    const clock = new Clock();
    clock.frame();
    brick.hit();
    expect(board.score).toBe(10);

    board.destroy();
    clock.frame();
    brick.hit();
    // A destroyed listener can never be called by an event it outlived.
    expect(board.score).toBe(10);
    expect(brick.destroyed.listenerCount).toBe(0);
  });
});
