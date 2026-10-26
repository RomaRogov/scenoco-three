import { Vector3 } from 'three';
import type { Terrain } from '@scenoco-three/terrain';

const at = new Vector3();

/** The ground's world y under a world x, z. */
export function groundAt(terrain: Terrain, x: number, z: number): number {
  return terrain.sampleHeight(at.set(x, 0, z)) + terrain.node.getWorldPosition(at).y;
}

/** The highest ground within `radius` of a world x, z: where something wide stands without sinking. */
export function groundUnder(terrain: Terrain, x: number, z: number, radius: number): number {
  let top = groundAt(terrain, x, z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    top = Math.max(top, groundAt(terrain, x + Math.cos(a) * radius, z + Math.sin(a) * radius));
  }
  return top;
}
