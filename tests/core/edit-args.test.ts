import { describe, expect, it } from 'vitest';
import { BoxGeometry, HemisphereLight, PerspectiveCamera } from 'three';
import { applyArguments, settableArgument } from '../../packages/core/src/editor/arguments';

describe("the editor's args", () => {
  it('sets each through the property it sets, or makes a geometry again in place', () => {
    // A light: each argument is a property, found by building the class with it changed.
    const light = new HemisphereLight('#ffe9c4', '#6a5a3a', 1.45);
    applyArguments(light as never, ['#ffe9c4', '#203040', 0.5]);
    expect([light.color.getHexString(), light.groundColor.getHexString(), light.intensity]).toEqual(['ffe9c4', '203040', 0.5]);

    // A camera's projection follows its fov.
    const camera = new PerspectiveCamera(40, 1, 0.1, 100);
    const projection = camera.projectionMatrix.clone();
    applyArguments(camera as never, [60, 1, 0.1, 100]);
    expect(camera.fov).toBe(60);
    expect(camera.projectionMatrix.equals(projection)).toBe(false);

    // A geometry: built again and copied into itself, so whatever holds it keeps it.
    const box = new BoxGeometry(1, 2, 3);
    expect(settableArgument(box, [1, 2, 3], 0)).toBe(true);
    applyArguments(box as never, [4, 2, 3]);
    box.computeBoundingBox();
    expect(box.parameters.width).toBe(4);
    expect(box.boundingBox!.max.x - box.boundingBox!.min.x).toBe(4);
  });
});
