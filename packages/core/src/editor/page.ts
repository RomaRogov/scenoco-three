import type { WebGLRenderer } from 'three';

/**
 * @internal Size the canvas while the bar or the editor's panel takes part of the page: to the body
 * they left, and — where the editor scales the page down beside it — at the size it is seen, not
 * more pixels than ever show. False when neither does, and the game sizes itself as usual.
 */
export function sizeCanvas(renderer: WebGLRenderer, host: HTMLElement): boolean {
  const body = document.body;
  if (!body.classList.contains('scenoco-editing') && !body.classList.contains('scenoco-framed')) return false;
  const width = host.clientWidth;
  const height = host.clientHeight;
  renderer.setSize(width, height);
  const seen = renderer.domElement.getBoundingClientRect().width / width;
  if (seen > 0 && seen < 0.999) renderer.setDrawingBufferSize(width * seen, height * seen, renderer.getPixelRatio());
  return true;
}
