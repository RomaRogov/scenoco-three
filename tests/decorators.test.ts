import { describe, expect, it } from 'vitest';
import { Component, component, property, Registry } from '@scenoco-three/core';

describe('@component / @property', () => {
  @component({ name: 'TestSpinner', description: 'spins things in tests' })
  class TestSpinner extends Component {
    @property({ type: 'float', default: 2, description: 'spin rate' })
    rate = 2;

    @property({ type: 'string', required: true, description: 'channel name' })
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
    expect(props.get('channel')).toEqual({ type: 'string', required: true, description: 'channel name' });
    expect(props.size).toBe(2);
  });

  it('supports Cocos-style typed component references', () => {
    @component({ name: 'TestFollower', description: 'follows a spinner' })
    class TestFollower extends Component {
      @property({ type: TestSpinner, description: 'the spinner to follow' })
      target: TestSpinner | null = null;

      @property({ type: TestSpinner, description: 'long form' })
      other: TestSpinner | null = null;
    }
    void TestFollower;

    const props = Registry.getComponent('TestFollower')!.meta.properties;
    expect(props.get('target')).toEqual({ type: TestSpinner, description: 'the spinner to follow' });
    expect(props.get('other')).toEqual({ type: TestSpinner, description: 'long form' });
  });

  it('inherits @property metadata from base classes', () => {
    abstract class MotionBase extends Component {
      @property({ type: 'float', default: 1, description: 'base speed' })
      speed = 1;
    }

    @component({ name: 'TestSlider', description: 'slides along a direction' })
    class TestSlider extends MotionBase {
      @property({ type: 'vec3', default: '1 0 0', description: 'slide direction' })
      direction = '1 0 0';
    }

    const props = Registry.getComponent('TestSlider')!.meta.properties;
    expect(props.get('speed')).toEqual({ type: 'float', default: 1, description: 'base speed' });
    expect(props.get('direction')).toEqual({ type: 'vec3', default: '1 0 0', description: 'slide direction' });
    expect(Registry.getComponent('TestSlider')!.ctor).toBe(TestSlider);
  });

  it('lets subclasses override inherited property metadata without mutating the base', () => {
    abstract class Base extends Component {
      @property({ type: 'float', default: 1, description: 'base speed' })
      speed = 1;
    }

    @component({ name: 'TestOverrideA', description: 'overrides speed' })
    class A extends Base {
      @property({ type: 'float', default: 99, description: 'overridden speed' })
      override speed = 99;
    }

    @component({ name: 'TestOverrideB', description: 'inherits speed' })
    class B extends Base {}

    void A;
    void B;
    expect(Registry.getComponent('TestOverrideA')!.meta.properties.get('speed')!.default).toBe(99);
    expect(Registry.getComponent('TestOverrideB')!.meta.properties.get('speed')!.default).toBe(1);
  });

  it('rejects duplicate registrations', () => {
    expect(() => {
      @component({ name: 'TestSpinner', description: 'duplicate name' })
      class Duplicate extends Component {}
      void Duplicate;
    }).toThrow(/already registered/);
  });

  it('rejects component names containing "/"', () => {
    expect(() => {
      @component({ name: 'Scoped/Name', description: 'bad name' })
      class Bad extends Component {}
      void Bad;
    }).toThrow(/reserved for prefab scope paths/);
  });

  it('rejects a component with a missing/empty description (runtime backstop)', () => {
    // Cast past the (required) TS type to prove the runtime guard fires too —
    // guarantees the registry invariant for JS/`@ts-ignore` consumers.
    expect(() => {
      @component({ name: 'NoDesc' } as unknown as { name: string; description: string })
      class NoDesc extends Component {}
      void NoDesc;
    }).toThrow(/missing a required, non-empty "description"/);

    expect(() => {
      @component({ name: 'BlankDesc', description: '   ' })
      class BlankDesc extends Component {}
      void BlankDesc;
    }).toThrow(/missing a required, non-empty "description"/);
  });

  it('rejects a property with a missing description (runtime backstop)', () => {
    expect(() => {
      @component({ name: 'BadProp', description: 'has a bad prop' })
      class BadProp extends Component {
        @property({ type: 'float', default: 1 } as unknown as { type: 'float'; description: string })
        speed = 1;
      }
      void BadProp;
    }).toThrow(/missing a required, non-empty "description"/);
  });
});
