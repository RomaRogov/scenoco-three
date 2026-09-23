import { Object3D, Scene } from 'three';
import { describe, expect, it } from 'vitest';

/**
 * What core takes from three.js, and what it takes *over*.
 *
 * The augmentation patches shared prototypes, so every name it adds is a name three.js can no
 * longer introduce: a future release declaring one would be silently shadowed, and the
 * declaration merge only catches that when the two types differ. This snapshots the prototypes
 * before core is imported and after, so the day three.js claims one of these names, this fails
 * here rather than in someone's game.
 *
 * The file imports `three` first and core second on purpose. Vitest isolates a module registry
 * per file, so this is the one place where "before" exists.
 */
/** Every member of a prototype, by name, so "replaced" can mean *changed* rather than *present*. */
function membersOf(prototype: object): Map<string, unknown> {
  const members = new Map<string, unknown>();
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)!;
    members.set(name, descriptor.value ?? descriptor.get);
  }
  return members;
}

const before = { object3D: membersOf(Object3D.prototype), scene: membersOf(Scene.prototype) };

await import('@scenoco-three/core');

const after = { object3D: membersOf(Object3D.prototype), scene: membersOf(Scene.prototype) };

/** Names core installed over one three.js already had. */
function replaced(was: Map<string, unknown>, is: Map<string, unknown>): string[] {
  return [...is].filter(([name, value]) => was.has(name) && was.get(name) !== value).map(([name]) => name).sort();
}

/** Names three.js did not have at all. */
function added(was: Map<string, unknown>, is: Map<string, unknown>): string[] {
  return [...is.keys()].filter((name) => !was.has(name)).sort();
}

/**
 * The three.js methods core deliberately replaces, and why.
 *
 * `add` and `remove` are the two doors into the hierarchy, and `copy` is what `clone()` calls —
 * patching them is what keeps the component registry correct with nothing registered by hand.
 * Anything else appearing here is an accident.
 */
const INTENDED_OVERRIDES = new Set(['add', 'remove', 'copy']);

describe('the Object3D augmentation', () => {
  it('replaces only the three methods it means to', () => {
    expect(new Set(replaced(before.object3D, after.object3D))).toEqual(INTENDED_OVERRIDES);
  });

  it('adds the surface the engine is written against', () => {
    expect(added(before.object3D, after.object3D)).toEqual([
      '_activeInHierarchy',
      '_built',
      '_components',
      '_destroyed',
      '_isActive',
      '_pendingDestroy',
      '_pendingId',
      '_runtime',
      'activeInHierarchy',
      'activeSelf',
      'addComponent',
      'components',
      'destroy',
      'destroyImmediate',
      'eulerAngles',
      'getComponent',
      'getComponentInChildren',
      'getComponentInParent',
      'getComponents',
      'getComponentsInChildren',
      'getComponentsInParent',
      'hasComponent',
      'instantiate',
      'isDestroyed',
      'removeComponent',
      'requireComponent',
      'scene',
      'setActive',
    ]);
  });
});

describe('the Scene augmentation', () => {
  it('replaces nothing three.js declares', () => {
    expect(replaced(before.scene, after.scene)).toEqual([]);
  });

  it('adds the scene surface', () => {
    expect(added(before.scene, after.scene)).toEqual([
      '_kept',
      '_loaded',
      '_runtime',
      'addSystem',
      'byId',
      'componentCount',
      'createObject',
      'disposeOnUnload',
      'dontDestroyOnLoad',
      'findObjectOfType',
      'findObjectsOfType',
      'getSystem',
      'isLoaded',
      'keepAlive',
      'load',
      'mainCamera',
      'removeSystem',
      'render',
      'requireSystem',
      'runtime',
      'systems',
      'unload',
    ]);
  });
});
