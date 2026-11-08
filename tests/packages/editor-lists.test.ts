import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { kindOf, listItem } from '../../packages/editor/src/model/values.js';

describe('editor: lists', () => {
  it('edits a list an item a line when every item is one kind it edits, and shows the rest as written', () => {
    // A spline's knots, as arrays or as three's vectors.
    expect(kindOf([[0, 0.15, -3.5], [0.6, -0.6, -9]], 'knots')).toBe('list');
    expect(listItem([new Vector3(1, 2, 3), new Vector3()])).toBe('vector');
    // Numbers, names, a palette, flags.
    expect(listItem([1, 2, 3, 5, 8])).toBe('number');
    expect(listItem(['meadow', 'canyon'])).toBe('string');
    expect(listItem(['#ff0000', '#00ff00'])).toBe('color');
    expect(listItem([true, false])).toBe('boolean');
    // Two to four numbers are one vector; nodes, prefabs, mixed lists and knots with fields of their own are shown.
    expect(kindOf([0, 1, 2], 'position')).toBe('vector');
    expect(listItem([])).toBeUndefined();
    expect(listItem([new Object3D()])).toBeUndefined();
    expect(listItem([() => null])).toBeUndefined();
    expect(listItem([1, 'two'])).toBeUndefined();
    expect(listItem([[0, 0, 0], { position: [1, 0, 0], roll: 0.2 }])).toBeUndefined();
  });
});
