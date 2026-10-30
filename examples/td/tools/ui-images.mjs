// The UI's images, where USS has no CSS for the effect: `node tools/ui-images.mjs` writes
// public/ui/drawn/. A shadow is drawn alone, for a `.shade` child `pad` px outside its element, and
// nine-sliced at (pad + radius) × 2 (scripts/ui-images.mjs); a fixed-size button is drawn whole.
import { dataUrl, renderImages } from '../../../scripts/ui-images.mjs';

const ui = (name) => new URL(`../public/ui/${name}`, import.meta.url).pathname;
const wood = `url(${dataUrl(ui('wood.jpg'))})`;
const paper = `url(${dataUrl(ui('parchment.jpg'))})`;
const star = dataUrl(ui('star.png'));
const RIM = 'inset 0 0 0 2px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.25)';
const PLAY = '<svg viewBox="0 0 24 24" width="24" height="24" style="fill:#fff"><path d="M8 5v14l11-7z" /></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" style="fill:#fff;filter:drop-shadow(0 2px 0 rgba(0,0,0,.45))"><rect x="5" y="4" width="5" height="16" rx="1.5" /><rect x="14" y="4" width="5" height="16" rx="1.5" /></svg>';
const center = 'display:flex;align-items:center;justify-content:center';
/** Half of the wave button's ring — `side` left or right — the other half left out, for a clip to turn it in. */
const half = (side) =>
  `<div style="position:relative;width:110px;height:110px"><div style="position:absolute;top:0;${side === 'right' ? 'left:55px' : 'left:0'};width:55px;height:110px;overflow:hidden">` +
  `<svg viewBox="0 0 110 110" width="110" height="110" style="position:absolute;top:0;left:${side === 'right' ? '-55px' : '0'};filter:drop-shadow(0 0 4px #ffb703)">` +
  '<circle cx="55" cy="55" r="46" style="fill:none;stroke:#ffe066;stroke-width:6" /></svg></div></div>';

await renderImages(new URL('../public/ui/drawn', import.meta.url).pathname, [
  // The wooden chips' lip and shadow. Pad 16, radius 20: slice 72.
  ['chip-shadow.png', 80, 38, 16, 'border-radius:20px;box-shadow:0 3px 0 #2b1a0c,0 6px 12px rgba(0,0,0,.3)'],
  // The round wooden buttons, whole, and the speed one turned on; the pause sign.
  ['round.png', 44, 44, 16, `border-radius:50%;background:${wood} center/120px;box-shadow:${RIM},0 3px 0 #2b1a0c,0 6px 12px rgba(0,0,0,.3)`],
  ['round-on.png', 44, 44, 16, `border-radius:50%;background:${wood} center/120px;background-color:#e8a317;background-blend-mode:multiply;box-shadow:${RIM},0 3px 0 #2b1a0c,0 6px 12px rgba(0,0,0,.3)`],
  ['pause.png', 22, 22, 2, '', PAUSE],
  // The big buttons: each colour's face, stretched, and its lip and shadow. Pad 28, radius 16: slice 88.
  ['btn-green.png', 8, 52, 0, 'background:linear-gradient(#7ed957,#3e9b2b)'],
  ['btn-gold.png', 8, 52, 0, 'background:linear-gradient(#ffe066,#f0a400)'],
  ['btn-red.png', 8, 52, 0, 'background:linear-gradient(#ff7b6b,#d4392a)'],
  ['btn-green-shadow.png', 120, 52, 28, 'border-radius:16px;box-shadow:0 5px 0 #24661a,0 10px 18px rgba(0,0,0,.3)'],
  ['btn-gold-shadow.png', 120, 52, 28, 'border-radius:16px;box-shadow:0 5px 0 #a86a00,0 10px 18px rgba(0,0,0,.3)'],
  ['btn-red-shadow.png', 120, 52, 28, 'border-radius:16px;box-shadow:0 5px 0 #8c1f14,0 10px 18px rgba(0,0,0,.3)'],
  ['btn-wood-shadow.png', 120, 52, 28, 'border-radius:16px;box-shadow:0 5px 0 #2b1a0c,0 10px 18px rgba(0,0,0,.3)'],
  // The light that sweeps across the gold button, stretched over it.
  ['shimmer.png', 200, 52, 0, 'background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%)'],
  // The next-wave button, whole, and its ring's two halves.
  ['next.png', 86, 86, 24, 'border-radius:50%;background:radial-gradient(circle at 50% 35%,#ff9b5c,#d4392a 70%);box-shadow:inset 0 3px 0 rgba(255,255,255,.4),0 5px 0 #7d1c12,0 10px 22px rgba(0,0,0,.4)'],
  ['ring-right.png', 110, 110, 0, '', half('right')],
  ['ring-left.png', 110, 110, 0, '', half('left')],
  // A life lost: the screen's edges flash red. Stretched.
  ['vignette.png', 256, 144, 0, 'box-shadow:inset 0 0 90px 30px rgba(220,30,20,.75)'],
  // The wave banner's ribbon shadow. Pad 28, radius 8: slice 72.
  ['ribbon-shadow.png', 160, 60, 28, 'border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.4)'],
  // The bottom sheets' shadow, cast upwards. Pad 40, radius 22: slice 124.
  ['sheet-shadow.png', 200, 120, 40, 'border-radius:22px 22px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.35)'],
  // A build card's lip. Pad 4, radius 14: slice 36.
  ['card-lip.png', 80, 100, 4, 'border-radius:14px;box-shadow:0 3px 0 #a87b45'],
  // A star not earned, and one earned with its glow.
  ['star-off.png', 22, 22, 0, `background:url(${star}) center/contain no-repeat;filter:grayscale(1) brightness(.6);opacity:.5`],
  ['star-got.png', 88, 88, 12, `background:url(${star}) center/contain no-repeat;filter:drop-shadow(0 4px 6px rgba(160,100,0,.5))`],
  // A stat bar's fill. Stretched.
  ['bar-fill.png', 8, 10, 0, 'background:linear-gradient(#ffcf4a,#e08a00)'],
  // The full-screen panels: their wash, the title's, the panel's shadow (pad 56, radius 24: slice 160),
  // the plaque's (pad 24, radius 12: slice 72) and the red plaque's face.
  ['overlay.png', 256, 144, 0, 'background:radial-gradient(ellipse at center,rgba(20,12,4,.25),rgba(20,12,4,.7))'],
  ['title-wash.png', 8, 256, 0, 'background:linear-gradient(rgba(20,12,4,0),rgba(20,12,4,.45) 60%,rgba(20,12,4,.75))'],
  ['panel-shadow.png', 240, 200, 56, 'border-radius:24px;box-shadow:0 16px 40px rgba(0,0,0,.45)'],
  ['plaque-shadow.png', 160, 56, 24, 'border-radius:12px;box-shadow:0 6px 14px rgba(0,0,0,.35)'],
  ['plaque-red.png', 8, 56, 0, 'background:linear-gradient(#d4392a,#8c1f14)'],
  // The title: the castle and the name, as the page drew them.
  ['logo.png', 360, 300, 24, `${center};flex-direction:column;text-align:center`,
    `<img src="${dataUrl(ui('castle-icon.png'))}" style="width:120px;height:120px;margin-bottom:-18px;filter:drop-shadow(0 8px 10px rgba(0,0,0,.4))" />` +
    "<h1 style=\"margin:0;font-family:'Lilita One';font-weight:400;font-size:92px;line-height:.9;color:#ffe066;text-shadow:0 4px 0 #b86e00,0 8px 0 #5a3000,0 14px 24px rgba(0,0,0,.45)\">TINY" +
    '<span style="display:block;color:#fff;font-size:.62em;text-shadow:0 3px 0 #5a3000,0 8px 16px rgba(0,0,0,.45)">BASTION</span></h1>'],
  // A level's card shadow (pad 30, radius 18: slice 96), its lock, its play button, and the maps of a locked level.
  ['level-shadow.png', 300, 94, 30, 'border-radius:18px;box-shadow:0 5px 0 #4a2a12,0 10px 20px rgba(0,0,0,.35)'],
  ['lock.png', 40, 40, 0, `${center};font-size:30px`, '🔒'],
  ['go.png', 52, 52, 8, `${center};border-radius:50%;background:linear-gradient(#7ed957,#3e9b2b);box-shadow:0 4px 0 #24661a`, PLAY],
  ['go-locked.png', 52, 52, 8, `${center};border-radius:50%;background:linear-gradient(#7ed957,#3e9b2b);box-shadow:0 4px 0 #24661a;filter:grayscale(.85)`, PLAY],
  ...['meadow', 'canyon', 'frost'].map((map) => [`map-${map}-locked.png`, 74, 74, 0, `background:url(${dataUrl(ui(`map-${map}.jpg`))}) center/cover;filter:grayscale(.85)`]),
], { head: '<link href="https://fonts.googleapis.com/css2?family=Lilita+One&display=swap" rel="stylesheet" />' });
