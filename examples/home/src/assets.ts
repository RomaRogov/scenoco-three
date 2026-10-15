import { Box3, Vector3 } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import helvetiker from 'three/examples/fonts/helvetiker_bold.typeface.json';

const font = new FontLoader().parse(helvetiker);

/** One letter's mesh, centred on its node, and the size of the box that stands in for it in physics. */
function glyph(char: string) {
  const geometry = new TextGeometry(char, {
    font, size: 1.6, depth: 0.6, curveSegments: 12,
    bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 4,
  });
  geometry.center();
  geometry.computeBoundingBox();
  return { geometry, size: geometry.boundingBox!.getSize(new Vector3()).toArray() };
}

export const glyphs = { s: glyph('s'), c: glyph('c'), e: glyph('e'), n: glyph('n'), o: glyph('o') };

/** What the selection outline draws around: the picked letter's bounds, every frame. */
export const selection = new Box3();
