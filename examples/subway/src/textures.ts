import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const finish = (c: HTMLCanvasElement, repeat = false) => {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
};

/** Dusk sky, drawn as the scene background. */
const sky = canvas(8, 256);
{
  const g = sky.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1b2160');
  grad.addColorStop(0.35, '#6a3f98');
  grad.addColorStop(0.62, '#e5647f');
  grad.addColorStop(0.82, '#ff9a6a');
  grad.addColorStop(1, '#ffc88a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
}
export const skyTexture = finish(sky);

/** A facade of windows, and the same windows lit, as an emissive map. */
const facade = canvas(256, 384);
const glow = canvas(256, 384);
{
  const f = facade.getContext('2d')!;
  const l = glow.getContext('2d')!;
  f.fillStyle = '#ffffff';
  f.fillRect(0, 0, 256, 384);
  l.fillStyle = '#000000';
  l.fillRect(0, 0, 256, 384);
  const cols = 4;
  const rows = 8;
  const cw = 256 / cols;
  const ch = 384 / rows;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.18;
      const y = r * ch + ch * 0.2;
      const w = cw * 0.64;
      const h = ch * 0.56;
      const lit = rnd() < 0.38;
      f.fillStyle = lit ? '#ffe3a3' : '#2b3050';
      f.fillRect(x, y, w, h);
      if (lit) {
        l.fillStyle = rnd() < 0.8 ? '#ffb85c' : '#9fd4ff';
        l.fillRect(x, y, w, h);
      }
      f.fillStyle = 'rgba(0,0,0,0.25)';
      f.fillRect(c * cw, r * ch + ch - 4, cw, 4);
    }
  }
}
export const facadeTexture = finish(facade, true);
export const glowTexture = finish(glow, true);

/** Gravel bed with sleepers every two metres (the bed is 8.6 m wide, a segment 20 m long). */
const track = canvas(256, 512);
{
  const g = track.getContext('2d')!;
  g.fillStyle = '#4f4859';
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 2600; i++) {
    const v = 60 + ((i * 37) % 60);
    g.fillStyle = `rgb(${v + 20},${v + 12},${v + 30})`;
    g.fillRect((i * 97) % 256, (i * 53) % 512, 3, 3);
  }
  g.fillStyle = '#6d4c3b';
  for (let i = 0; i < 10; i++) g.fillRect(8, i * 51.2 + 18, 240, 15);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 10; i++) g.fillRect(8, i * 51.2 + 33, 240, 4);
}
export const trackTexture = finish(track);
