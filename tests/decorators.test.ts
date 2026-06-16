import { describe, expect, it } from 'vitest';
import { Component, component, property, Registry } from '@scenoco-three/core';

describe('@component / @property', () => {
  @component({ name: 'TestSpinner', description: 'spins things in tests' })
  class TestSpinner extends Component {
    @property({ type: 'float', default: 2, description: 'spin rate' })
    rate = 2;

    @property({ type: 'string', required: true })
    channel = '';
  }

  it('registers the class under its XML tag name', () => {
    const entry = Registry.getComponent('TestSpinner');
    expect(entry).toBeDefined();
    expect(entry!.ctor).toBe(TestSpinner);
    expect(entry!.meta.description).toBe('spins things in tests');
  });

  it('collects explicit property metadata', () => {
    const props = Registry.getComponent('TestSpinner')!.meta.properties;
    expect(props.get('rate')).toEqual({ type: 'float', default: 2, description: 'spin rate' });
    expect(props.get('channel')).toEqual({ type: 'string', required: true });
    expect(props.size).toBe(2);
  });

  it('supports Cocos-style typed component references', () => {
    @component({ name: 'TestFollower' })
    class TestFollower extends Component {
      @property(TestSpinner)
      target: TestSpinner | null = null;

      @property({ type: TestSpinner, description: 'long form' })
      other: TestSpinner | null = null;
    }
    void TestFollower;

    const props = Registry.getComponent('TestFollower')!.meta.properties;
    expect(props.get('target')).toEqual({ type: TestSpinner });
    expect(props.get('other')).toEqual({ type: TestSpinner, description: 'long form' });
  });

  it('inherits @property metadata from base classes', () => {
    abstract class MotionBase extends Component {
      @property({ type: 'float', default: 1 })
      speed = 1;
    }

    @component({ name: 'TestSlider' })
    class TestSlider extends MotionBase {
      @property({ type: 'vec3', default: '1 0 0' })
      direction = '1 0 0';
    }

    const props = Registry.getComponent('TestSlider')!.meta.properties;
    expect(props.get('speed')).toEqual({ type: 'float', default: 1 });
    expect(props.get('direction')).toEqual({ type: 'vec3', default: '1 0 0' });
    expect(Registry.getComponent('TestSlider')!.ctor).toBe(TestSlider);
  });

  it('lets subclasses override inherited property metadata without mutating the base', () => {
    abstract class Base extends Component {
      @property({ type: 'float', default: 1 })
      speed = 1;
    }

    @component({ name: 'TestOverrideA' })
    class A extends Base {
      @property({ type: 'float', default: 99 })
      override speed = 99;
    }

    @component({ name: 'TestOverrideB' })
    class B extends Base {}

    void A;
    void B;
    expect(Registry.getComponent('TestOverrideA')!.meta.properties.get('speed')!.default).toBe(99);
    expect(Registry.getComponent('TestOverrideB')!.meta.properties.get('speed')!.default).toBe(1);
  });

  it('rejects duplicate registrations', () => {
    expect(() => {
      @component({ name: 'TestSpinner' })
      class Duplicate extends Component {}
      void Duplicate;
    }).toThrow(/already registered/);
  });

  it('rejects component names containing "/"', () => {
    expect(() => {
      @component({ name: 'Scoped/Name' })
      class Bad extends Component {}
      void Bad;
    }).toThrow(/reserved for prefab scope paths/);
  });
});
