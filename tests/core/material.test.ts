import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import '@scenoco-three/core';

describe('uniqueMaterial', () => {
  it('clones the shared material once, so one node can opt out of sharing', () => {
    const shared = new MeshBasicMaterial({ color: 0xff0000 });
    const a = new Mesh(new BoxGeometry(), shared);
    const b = new Mesh(new BoxGeometry(), shared);

    const own = a.uniqueMaterial<MeshBasicMaterial>();
    expect(own).not.toBe(shared);
    expect(a.uniqueMaterial()).toBe(own);   // idempotent
    expect(b.material).toBe(shared);        // the other node keeps sharing

    own.color.set(0x00ff00);
    expect(shared.color.getHex()).toBe(0xff0000);
  });

  it('clones every slot of a multi-material mesh', () => {
    const slots = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const mesh = new Mesh(new BoxGeometry(), slots);
    const own = mesh.uniqueMaterial<MeshBasicMaterial[]>();
    expect(own).toHaveLength(2);
    expect(own[0]).not.toBe(slots[0]);
    expect(own[1]).not.toBe(slots[1]);
  });

  it('throws on a node that has no material, instead of hiding the mistake', () => {
    expect(() => new Group().uniqueMaterial()).toThrow(/no material to clone/);
  });
});
