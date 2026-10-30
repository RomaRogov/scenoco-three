// The UI's images, where USS has no CSS for the effect: `node tools/ui-images.mjs` writes public/ui/.
// Each is a shadow alone, for a `.shade` child `pad` px outside its element (scripts/ui-images.mjs).
import { renderImages } from '../../../scripts/ui-images.mjs';

await renderImages(new URL('../public/ui', import.meta.url).pathname, [
  // The HUD's cards. Pad 24, radius 12: slice 72.
  ['card-shadow.png', 80, 60, 24, 'border-radius:12px;box-shadow:0 4px 18px rgb(0 0 0/.12)'],
  // The touch buttons. Pad 24, radius 16: slice 80.
  ['button-shadow.png', 84, 64, 24, 'border-radius:16px;box-shadow:0 4px 18px rgb(0 0 0/.15)'],
  // The stick's track, shaded inside along its top. Pad 0, radius 32: slice 64.
  ['track-shade.png', 176, 64, 0, 'border-radius:32px;box-shadow:inset 0 2px 10px rgb(0 0 0/.15)'],
  // The stick's knob, a circle: stretched over its shade.
  ['knob-shadow.png', 56, 56, 24, 'border-radius:50%;box-shadow:0 4px 14px rgb(0 0 0/.25)'],
]);
