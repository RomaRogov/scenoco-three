import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { Component, serialize, serializedFieldsOf } from '@scenoco-three/core';

/**
 * A component carries **no decorators**. Extending `Component` is the whole
 * registration — the build scans the workspace for classes that do — and its
 * public fields are serialized because they are public, the way a Unity
 * MonoBehaviour works.
 *
 * So there is very little for the runtime to be responsible for, and these tests
 * cover exactly that little: the two decorators that exist for what the source
 * cannot say on its own. Everything else — which fields are serialized, their
 * types, defaults and descriptions — is read from the source by the build, and
 * is tested there rather than here.
 */
class Paddle extends Component<Mesh> {
  /** Units per second the paddle travels. */
  speed = 10;
  /** Texture painted on the paddle. */
  @serialize({ asset: 'texture' }) skin = '';
  /** Tuning that should be authored but not part of the public API. */
  @serialize private tuning = 0.5;
  private velocity = 0;

  readTuning(): number {
    return this.tuning;
  }
  readVelocity(): number {
    return this.velocity;
  }
}

class FastPaddle extends Paddle {
  @serialize private boost = 2;
  readBoost(): number {
    return this.boost;
  }
}

class PlainBehaviour extends Component {}

describe('a component needs no decorators', () => {
  it('is registered by extending Component, with nothing else to declare', () => {
    // Nothing to assert about a registry, because there isn't one: no tag name,
    // no `@component`, no import side effect. The class is the declaration.
    const paddle = new Mesh().addComponent(Paddle);
    expect(paddle).toBeInstanceOf(Component);
    expect(paddle.speed).toBe(10);
    expect(paddle.readVelocity()).toBe(0);
  });

  it('leaves public fields entirely alone — they are serialized for being public', () => {
    // `speed` carries no decorator and appears in no runtime metadata. The build
    // reads it from the source; the runtime never needs to know.
    expect(Object.keys(serializedFieldsOf(Paddle)).sort()).toEqual(['skin', 'tuning']);
  });
});

describe('@serialize', () => {
  it('takes a private field the build would otherwise skip', () => {
    expect(serializedFieldsOf(Paddle).tuning).toEqual({});
    expect(new Mesh().addComponent(Paddle).readTuning()).toBe(0.5);
  });

  it('carries the facts a type cannot express', () => {
    // "this string is a texture path" is not something `string` can say.
    expect(serializedFieldsOf(Paddle).skin).toEqual({ asset: 'texture' });
  });

  it('does not let a subclass write into its base class metadata', () => {
    // `context.metadata` prototype-chains onto the base's, so the naive
    // `metadata.serialized ??= {}` mutates the *parent's* bag: FastPaddle's
    // `boost` would show up on Paddle, and on every sibling subclass with it.
    expect(Object.keys(serializedFieldsOf(FastPaddle)).sort()).toEqual(['boost', 'skin', 'tuning']);
    expect(Object.keys(serializedFieldsOf(Paddle)).sort()).toEqual(['skin', 'tuning']);
    expect(new Mesh().addComponent(FastPaddle).readBoost()).toBe(2);
  });
});

describe('a class with no decorators at all', () => {
  it('carries no metadata, so nothing has to be stripped from it', () => {
    expect(serializedFieldsOf(PlainBehaviour)).toEqual({});
  });
});
