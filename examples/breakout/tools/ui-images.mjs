// The UI's images, where USS has no CSS for the effect: `node tools/ui-images.mjs` writes public/ui/.
// A glow is drawn alone, for a `.shade` child `pad` px outside its element (scripts/ui-images.mjs).
import { renderImages } from '../../../scripts/ui-images.mjs';

const TINTS = { laser: '#ff3b6b', multi: '#ffd23f', wide: '#3bff9a', slim: '#b18cff' };
const SPEAKER = (color, waves) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" style="fill:none;stroke:${color};stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M4 9v6h4l5 4V5L8 9z" fill="${color}" />${
    waves ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />' : '<path d="M16 9l6 6M22 9l-6 6" />'
  }</svg>`;

await renderImages(new URL('../public/ui', import.meta.url).pathname, [
  // The bar's glass: its face's gradient (stretched), and the shadow round it — pad 40, radius 14: slice 108.
  ['panel-face.png', 8, 64, 0, 'background:linear-gradient(180deg,rgb(20 30 60/.72),rgb(8 12 28/.6))'],
  ['panel-shadow.png', 120, 80, 40, 'border-radius:14px;box-shadow:0 0 0 1px rgb(0 0 0/.4),0 8px 30px rgb(0 0 0/.45)'],
  // A life's glow, and its burst's: stretched over its shade, pad 10.
  ['pip-glow.png', 22, 7, 10, 'border-radius:4px;box-shadow:0 0 8px rgb(255 61 216/.9)'],
  ['pip-burst.png', 22, 7, 10, 'border-radius:4px;box-shadow:0 0 12px #ff3dd8'],
  // A running bonus's glow, one per tint. Pad 16, radius 10: slice 52.
  ...Object.entries(TINTS).map(([bonus, tint]) => [`chip-${bonus}.png`, 74, 40, 16, `border-radius:10px;box-shadow:0 0 14px color-mix(in srgb,${tint} 55%,transparent)`]),
  // The sound switch's glow (stretched, pad 16), and its icon, on and off.
  ['sound-glow.png', 42, 42, 16, 'border-radius:12px;box-shadow:0 0 12px rgb(47 245 210/.25)'],
  ['speaker.png', 22, 22, 0, '', SPEAKER('#2ff5d2', true)],
  ['speaker-off.png', 22, 22, 0, '', SPEAKER('#6f86b3', false)],
  // PLAY's glow, and the brighter one it pulses to. Pad 90, radius 14: slice 208.
  ['play-glow.png', 220, 60, 90, 'border-radius:14px;box-shadow:0 0 18px rgb(47 245 210/.8),0 0 60px rgb(47 245 210/.35)'],
  ['play-glow-bright.png', 220, 60, 90, 'border-radius:14px;box-shadow:0 0 26px rgb(47 245 210/1),0 0 90px rgb(47 245 210/.55)'],
  // Full-screen washes, stretched over their element.
  ['banner.png', 256, 144, 0, 'background:radial-gradient(ellipse at center,rgb(10 6 30/.55),rgb(2 4 10/.9))'],
  ['splash.png', 256, 144, 0, 'background:radial-gradient(ellipse at center,rgb(14 8 40/.6),rgb(2 4 10/.94))'],
  ['flash.png', 256, 144, 0, 'background:radial-gradient(ellipse at center,transparent 45%,rgb(255 40 90/.55))'],
]);
