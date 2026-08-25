import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import '@scenoco-three/core';

describe('eulerAngles', () => {
  it('reads and writes the node rotation in degrees', () => {
    const node = new Object3D();
    node.eulerAngles = new Vector3(0, 90, 0);
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(node.eulerAngles.y).toBeCloseTo(90);
  });

  it('hands back the same instance every read, like position does', () => {
    const node = new Object3D();
    expect(node.eulerAngles).toBe(node.eulerAngles);
  });

  it('is a copy, so writing one component is a no-op — assign the whole vector', () => {
    const node = new Object3D();
    node.eulerAngles.y = 90;
    // Unity's `Transform.eulerAngles` behaves exactly this way; pinned so the no-op is a
    // documented property rather than a surprise.
    expect(node.rotation.y).toBe(0);
    expect(node.eulerAngles.y).toBe(0);
  });

  it('tracks a rotation set in radians underneath', () => {
    const node = new Object3D();
    node.rotation.set(0, Math.PI, 0);
    expect(node.eulerAngles.y).toBeCloseTo(180);
  });
});
