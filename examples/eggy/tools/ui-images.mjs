// The UI's images, where USS has no CSS for the effect: `node tools/ui-images.mjs` writes public/ui/.
import { renderImages } from '../../../scripts/ui-images.mjs';

await renderImages(new URL('../public/ui', import.meta.url).pathname, [
  // Unity's UIGradient behind the scene: color1 at the top, color2 at the bottom. Stretched.
  ['sky.png', 8, 256, 0, 'background:linear-gradient(#fffecb,#d6007b)'],
]);
