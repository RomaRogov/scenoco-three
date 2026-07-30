import { describe, expect, it } from 'vitest';
import { Component, component, property, Registry, ValueType } from '@scenoco-three/core';
import { componentMetaSignature } from '../../packages/editor/src/server.js';

/**
 * The editor must reload the page to pick up new `@property` metadata (component
 * classes are ES modules already evaluated there), and that reload costs unsaved
 * scene edits. The signature decides whether an edit actually moved the surface
 * the inspector renders, so the user is only interrupted when it matters.
 */
describe('componentMetaSignature', () => {
  it('is stable, and changes when a property is added or removed', () => {
    const before = componentMetaSignature();
    expect(componentMetaSignature()).toBe(before); // no spurious churn

    @component({ name: 'SigProbe', description: 'Signature fixture' })
    class SigProbe extends Component {
      @property({ type: ValueType.Float, description: 'first' }) a = 0;
    }
    void SigProbe;

    const withOne = componentMetaSignature();
    expect(withOne).not.toBe(before);
    expect(withOne).toContain('SigProbe(a)');

    Registry.unregisterComponent('SigProbe');
    expect(componentMetaSignature()).toBe(before); // back to the original surface
  });

  it('ignores registration order', () => {
    const a = componentMetaSignature();
    // Names and property names are sorted, so a different registration order — or a
    // reordered class body — must not read as a metadata change.
    expect(componentMetaSignature()).toBe(a);
    expect(a.split('|')).toEqual([...a.split('|')].sort());
  });
});
