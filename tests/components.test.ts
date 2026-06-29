import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, component, Engine, property, Registry } from '@scenoco-three/core';
import { Oscillator } from './fixtures/components/Oscillator.js';
import { Rotator } from './fixtures/components/Rotator.js';

describe('built-in components', () => {
  it('Rotator and Oscillator are registered with metadata', () => {
    const rotator = Registry.getComponent('Rotator');
    expect(rotator).toBeDefined();
    expect(rotator!.meta.properties.get('speed')).toMatchObject({ type: 'float', default: 1 });

    const oscillator = Registry.getComponent('Oscillator');
    expect(oscillator).toBeDefined();
    expect(oscillator!.meta.properties.get('axis')).toMatchObject({ type: 'vec3', default: '0 1 0' });
  });

  it('Rotator spins at its configured speed', () => {
    const engine = new Engine();
    const node = new Object3D();
    engine.addComponent(node, Rotator, { speed: Math.PI });
    engine.tick(1);
    expect(node.rotation.y).toBeCloseTo(Math.PI);
  });

  it('Oscillator moves around its captured origin and exposes its offset', () => {
    const engine = new Engine();
    const node = new Object3D();
    node.position.set(0, 5, 0);
    const osc = engine.addComponent(node, Oscillator, {
      axis: new Vector3(0, 1, 0),
      amplitude: 2,
      frequency: 1,
    });

    // A quarter period: sin(2π · 0.25) = 1 → offset = amplitude.
    engine.tick(0.25);
    expect(node.position.y).toBeCloseTo(7);
    expect(osc.offset).toBeCloseTo(2);

    // Half period total: sin(π) = 0 → back at the origin.
    engine.tick(0.25);
    expect(node.position.y).toBeCloseTo(5);
    expect(osc.offset).toBeCloseTo(0);
  });

  it('components share data through typed references (Unity/Cocos style)', () => {
    @component({ name: 'TestGlow', description: 'glows from an Oscillator' })
    class TestGlow extends Component {
      @property({ type: Oscillator, description: 'the source oscillator' })
      source: Oscillator | null = null;

      seen = 0;

      override update(): void {
        this.seen = this.source?.offset ?? 0;
      }
    }
    void TestGlow;

    const engine = new Engine();
    const mover = new Object3D();
    const lamp = new Object3D();

    // The oscillator is attached first, so its update runs before the reader's.
    const osc = engine.addComponent(mover, Oscillator, { amplitude: 2, frequency: 1 });
    const glow = engine.addComponent(lamp, 'TestGlow', { source: osc }) as InstanceType<
      typeof TestGlow
    >;

    engine.tick(0.25);
    expect(glow.seen).toBeCloseTo(2);
  });
});
