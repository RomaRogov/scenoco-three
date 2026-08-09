import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, Event, component } from '@scenoco-three/core';

/** A brick that announces its own destruction — the emitter side of the idiom. */
@component({ name: 'EventBrick', description: 'Emits when destroyed' })
class EventBrick extends Component {
  readonly destroyed = new Event<[EventBrick]>();
  hit(): void {
    this.destroyed.emit(this);
    this.destroy();
  }
}

/** Counts bricks. Knows nothing about EventBrick beyond the event it listens to. */
@component({ name: 'EventScore', description: 'Counts destroyed bricks' })
class EventScore extends Component {
  score = 0;
  readonly onBrick = (): void => {
    this.score += 10;
  };
}

describe('Event — typed, symbol-based component signals', () => {
  it('delivers to every listener in order and stops after off/once', () => {
    const event = new Event<[number]>();
    const seen: string[] = [];
    const first = (n: number): void => void seen.push(`first:${n}`);
    event.on(first);
    event.once((n) => seen.push(`once:${n}`));
    event.emit(1);
    event.emit(2); // `once` is gone; `first` still subscribed
    event.off(first);
    event.emit(3); // nothing left
    expect(seen).toEqual(['first:1', 'once:1', 'first:2']);
    expect(event.listenerCount).toBe(0);
  });

  it('survives a listener that unsubscribes or subscribes mid-emit', () => {
    const event = new Event();
    const seen: string[] = [];
    const b = (): void => void seen.push('b');
    const a = (): void => {
      seen.push('a');
      event.off(b); // mutating during dispatch must not skip the snapshot
      event.on(() => seen.push('c'));
    };
    event.on(a);
    event.on(b);
    event.emit();
    expect(seen).toEqual(['a', 'b']); // b still ran this round, c starts next round
    event.emit(); // listeners are now [a, c]; a's newly-added c waits for the round after
    expect(seen).toEqual(['a', 'b', 'a', 'c']);
  });

  it('unsubscribes a component listener when it is destroyed, so a dead component is never called', () => {
    const engine = new Engine({ autoStart: false });
    const brickNode = new Object3D();
    const scoreNode = new Object3D();
    engine.scene.add(brickNode, scoreNode);
    const brick = engine.addComponent(brickNode, EventBrick);
    const score = engine.addComponent(scoreNode, EventScore);
    score.listen(brick.destroyed, score.onBrick);

    brick.destroyed.emit(brick);
    expect(score.score).toBe(10);

    // Destruction is deferred: the subscription drops when the engine flushes.
    score.destroy();
    engine.tick(1 / 60);
    expect(brick.destroyed.listenerCount).toBe(0);
    brick.destroyed.emit(brick);
    expect(score.score).toBe(10); // the destroyed listener did not run
    engine.dispose();
  });
});
