import { CanvasTexture, type Texture } from 'three';

/**
 * A soft round particle sprite, generated once (a radial white→transparent
 * gradient). Used as the default map when a `<ParticleSystem>` declares no
 * `texture`, so a system renders as recognisable soft dots out of the box —
 * Unity's default-particle equivalent. Browser-only (needs a canvas); returns
 * null headless, where the render system never runs anyway.
 */
let cached: Texture | null | undefined;

export function defaultParticleTexture(): Texture | null {
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return (cached = null);
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return (cached = null);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return (cached = tex);
}
