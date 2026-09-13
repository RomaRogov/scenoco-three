import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { Component } from '@scenoco-three/core';
import { serializeField } from '../../packages/compiler/src/serialize.js';

/**
 * The marker has no runtime job: the build reads it from the source. These two tests cover
 * what that leaves — that it changes nothing about the field, and that it refuses a placement
 * the build could never author. Which fields are serialized is tested by the scanner.
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
    const paddle = new Mesh().addComponent(Paddle);
    expect(paddle.readTuning()).toBe(0.5);
    expect(paddle.speed).toBe(10);
  });

  it('refuses a field the build could never author', () => {
    const context = { name: 'shared', static: true } as ClassFieldDecoratorContext<unknown, number>;
    expect(() => serializeField(undefined, context)).toThrow(/static field "shared"/);
  });
});
