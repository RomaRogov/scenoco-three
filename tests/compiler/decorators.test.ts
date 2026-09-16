import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { Component } from '@scenoco-three/core';
import { serializeField } from '../../packages/compiler/src/serialize.js';

/**
 * The marker has no runtime job: the build reads it from the source, and \`scenoco()\` removes it
 * before the page sees it. What is left to check is that, applied, it changes nothing. Which
 * fields are serialized, and a marker placed where it cannot mean anything, the scanner tests.
 */
class Paddle extends Component<Mesh> {
  /** Units per second the paddle travels. */
  speed = 10;
  /** Tuning that should be authored but not part of the public API. */
  @serializeField private tuning = 0.5;

  readTuning(): number {
    return this.tuning;
  }
}

describe('@serializeField', () => {
  it('marks a private field for the build and leaves it exactly as written', () => {
    // A test compiles without \`scenoco()\`, so the marker is really applied here — and does nothing.
    const paddle = new Mesh().addComponent(Paddle);
    expect(paddle.readTuning()).toBe(0.5);
    expect(paddle.speed).toBe(10);
  });
});
