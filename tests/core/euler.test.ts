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

  it('writes through on a single component', () => {
    const node = new Object3D();
    node.eulerAngles.y = 90;
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(node.eulerAngles.y).toBeCloseTo(90);
  });

  it('writes through from every Vector3 method it inherits', () => {
    const node = new Object3D();
    node.eulerAngles.set(0, 90, 0);
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2);
    node.eulerAngles.copy(new Vector3(0, 180, 0));
    expect(node.rotation.y).toBeCloseTo(Math.PI);
    node.eulerAngles.add(new Vector3(0, 90, 0));
    expect(node.rotation.y).toBeCloseTo(Math.PI * 1.5);
  });

  it('is a live view rather than a snapshot — clone it to keep one', () => {
    const node = new Object3D();
    node.eulerAngles.y = 90;
    const view = node.eulerAngles;
    const snapshot = node.eulerAngles.clone();
    expect(snapshot.y).toBeCloseTo(90); // taken at 90, and detached from the node

    node.rotation.y = Math.PI;
    expect(view.y).toBeCloseTo(180); // follows the node, as `position` does
    expect(snapshot.y).toBeCloseTo(90); // still what it was when it was taken
    // A plain vector, so writing to it cannot reach the node by accident.
    snapshot.y = 45;
    expect(node.eulerAngles.y).toBeCloseTo(180);
  });

  it('is still a Vector3, so anything taking one takes it', () => {
    const node = new Object3D();
    expect(node.eulerAngles).toBeInstanceOf(Vector3);
    expect(node.eulerAngles.isVector3).toBe(true);
    expect(node.eulerAngles.toArray()).toEqual([0, 0, 0]);
  });

  it('tracks a rotation set in radians underneath', () => {
    const node = new Object3D();
    node.rotation.set(0, Math.PI, 0);
    expect(node.eulerAngles.y).toBeCloseTo(180);
  });
});
