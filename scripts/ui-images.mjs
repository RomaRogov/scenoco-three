// The images an example's UI needs where USS has no CSS for the effect — a gradient, a soft shadow, a
// glow, an SVG icon: each drawn once by Chrome from the CSS it replaces, and saved with its
// transparency, at twice its size. Each example lists its own in `tools/ui-images.mjs`.
//
// A shadow or a glow is drawn alone, the element itself left out (an outer box-shadow never paints
// under its box): the page puts it on a `.shade` child placed `pad` px outside its element and
// nine-slices it at `(pad + radius) * 2` image pixels, so the element's own face — background, border,
// radius — stays USS's.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '../node_modules/playwright-core/index.mjs';

/**
 * Draw `images` — `[file, width, height, pad, css, html?]`: an element of that size and CSS, `pad` px of
 * room round it for its shadow — into `dir`. `head` goes into each page: the fonts a text image needs.
 */
export async function renderImages(dir, images, { head = '' } = {}) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const [file, width, height, pad, css, inner = ''] of images) {
    await page.setContent(
      `<head>${head}</head><body style="margin:0;background:transparent"><div id="frame" style="padding:${pad}px;display:inline-block">` +
        `<div style="box-sizing:border-box;width:${width}px;height:${height}px;${css}">${inner}</div></div></body>`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await page.locator('#frame').screenshot({ path: `${dir}/${file}`, omitBackground: true });
    console.log(`${dir}/${file}`);
  }
  await browser.close();
}

/** A file as a `data:` URL, for a texture or an icon an image is drawn with. */
export function dataUrl(path) {
  const type = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${readFileSync(path).toString('base64')}`;
}
