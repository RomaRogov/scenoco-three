import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mesh } from 'three';
import { loadAssets, sharedModel } from '@scenoco-three/core';

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
});
