import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, type Mesh } from 'three';
import { instantiate, loadAssets, prefab, sharedModel } from '@scenoco-three/core';
import { jsx } from '@scenoco-three/core/jsx-runtime';

afterEach(() => vi.unstubAllGlobals());

describe('models', () => {
  it('loads a meshopt-compressed glTF (gltfpack -cc), vertex colours and all', async () => {
    // A 1 m box with one vertex colour, quantized and meshopt-compressed: 1.6 KB.
    const file = readFileSync(new URL('./fixtures/meshopt-box.glb', import.meta.url));
    vi.stubGlobal('fetch', async () => new Response(file));
    // three's FileLoader reports progress with the browser's ProgressEvent, which Node lacks.
    vi.stubGlobal('ProgressEvent', class extends Event {
      constructor(type: string, init: object = {}) {
        super(type);
        Object.assign(this, init);
      }
    });
    const box = sharedModel('http://assets.test/meshopt-box.glb');
    await loadAssets(box);

    let mesh: Mesh | undefined;
    box.instantiate().traverse((o) => (mesh ??= (o as Mesh).isMesh ? (o as Mesh) : undefined));
    const geometry = mesh!.geometry;
    expect(geometry.getAttribute('color')).toBeDefined();
    geometry.computeBoundingBox();
    // The decoded positions, scaled back from their quantized integers by the node's transform.
    mesh!.updateWorldMatrix(true, false);
    const size = geometry.boundingBox!.clone().applyMatrix4(mesh!.matrixWorld).getSize(geometry.boundingBox!.max.clone());
    expect(size.x).toBeCloseTo(1, 2);
  });

  it('is a prefab: placed by its tag, loaded through it, its meshes casting and taking shadows unless the model says not', async () => {
    const file = readFileSync(new URL('./fixtures/meshopt-box.glb', import.meta.url));
    vi.stubGlobal('fetch', async () => new Response(file));
    vi.stubGlobal('ProgressEvent', class extends Event {});
    const Box = prefab(sharedModel('http://assets.test/prefab-box.glb'));

    // Built before its model arrives, the tag says what was missed.
    expect(() => jsx(Box, {})).toThrow('<prefab-box.glb>: its model is not loaded yet — await loadAssets(…)');
    await loadAssets(Box);

    const placed = jsx(Box, { position: [1, 2, 3], scale: 2 }) as Mesh;
    expect(placed.position.toArray()).toEqual([1, 2, 3]);
    expect(placed.scale.x).toBe(2);
    const meshes: Mesh[] = [];
    instantiate(Box, { parent: new Group() }).traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh));
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => m.castShadow && m.receiveShadow)).toBe(true);

    // Settings are the file's, as a texture's are: every copy after them.
    sharedModel('http://assets.test/prefab-box.glb', { castShadow: false });
    const shaded: Mesh[] = [];
    instantiate(Box, { parent: new Group() }).traverse((o) => (o as Mesh).isMesh && shaded.push(o as Mesh));
    expect(shaded.every((m) => !m.castShadow && m.receiveShadow)).toBe(true);
  });

  it('is empty in a test in Node, where a path has no page to be relative to', async () => {
    const hero = sharedModel('/models/hero.glb');
    await loadAssets(hero);
    expect(hero.instantiate().children).toEqual([]);
  });
});
