import { describe, expect, it } from 'vitest';
import { PlayerPrefs } from '@scenoco-three/core';

describe('PlayerPrefs', () => {
  it('keeps values by key, typed as read, and still works where there is no storage', () => {
    // No localStorage here: the values are kept in memory, as in a private window.
    expect(PlayerPrefs.getInt('level', 1)).toBe(1);
    PlayerPrefs.setInt('level', 3.7);
    PlayerPrefs.setFloat('volume', 0.5);
    PlayerPrefs.setString('name', 'Eggy');
    expect([PlayerPrefs.getInt('level'), PlayerPrefs.getFloat('volume'), PlayerPrefs.getString('name')]).toEqual([3, 0.5, 'Eggy']);
    expect(PlayerPrefs.getInt('name', -1)).toBe(-1); // not a number: the default
    PlayerPrefs.deleteKey('level');
    expect(PlayerPrefs.hasKey('level')).toBe(false);
    PlayerPrefs.deleteAll();
    expect(PlayerPrefs.hasKey('name')).toBe(false);
  });
});
