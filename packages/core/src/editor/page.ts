import type { WebGLRenderer } from 'three';

const BAR = 28;

/**
 * The bar along the page's top: the frame rate on the left, Full screen, Hide and Edit on the right. The page's
 * body is laid out under it, as the editor's panel lays it out beside itself, so the game draws in
 * what is left and nothing is hidden behind it. Hidden, it is gone until the page loads again.
 */
export function devBar(edit: () => void): { show(on: boolean): void } {
  const bar = document.createElement('div');
  bar.id = 'scenoco-bar';
  bar.style.cssText =
    `position:fixed;left:0;right:0;top:0;z-index:2147483000;box-sizing:content-box;height:${BAR}px;` +
    'padding:env(safe-area-inset-top) 8px 0;display:flex;align-items:center;gap:6px;background:#0f172a;' +
    'color:#94a3b8;font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;user-select:none;touch-action:manipulation';
  const fps = document.createElement('span');
  fps.style.cssText = 'flex:1;font-variant-numeric:tabular-nums';
  const button = (label: string, title: string, act: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'height:22px;padding:0 10px;border:0;border-radius:4px;background:#1e293b;color:#e2e8f0;font:12px system-ui;cursor:pointer';
    b.addEventListener('click', act);
    return b;
  };
  let hidden = false;
  // The whole page full screen, so the bar and the game's own HTML come with the canvas. Safari on an
  // iPad has only the prefixed calls; where there are none — an iPhone — the button is left out.
  const page = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
  const isFull = () => !!(document.fullscreenElement ?? doc.webkitFullscreenElement);
  const full = button('Full screen', 'Fill the screen with the page (development only)', () => {
    // A browser may refuse — not from a tap, say — and the promise says so: nothing to do about it here.
    const asked = isFull()
      ? (typeof document.exitFullscreen === 'function' ? document.exitFullscreen() : doc.webkitExitFullscreen?.())
      : (typeof page.requestFullscreen === 'function' ? page.requestFullscreen() : page.webkitRequestFullscreen?.());
    void Promise.resolve(asked).catch(() => {});
  });
  const relabel = () => void (full.textContent = isFull() ? 'Exit full screen' : 'Full screen');
  document.addEventListener('fullscreenchange', relabel);
  document.addEventListener('webkitfullscreenchange', relabel);
  if (typeof page.requestFullscreen === 'function' || page.webkitRequestFullscreen) bar.append(fps, full);
  else bar.append(fps);
  bar.append(button('Hide', 'Hide this bar until the page loads again', () => {
    hidden = true;
    show(false);
  }), button('Edit', 'Open the editor (development only)', edit));

  // Frames counted as the browser draws them, said twice a second.
  let frames = 0;
  let since = performance.now();
  let counting = 0;
  const count = (now: number) => {
    frames++;
    if (now - since >= 500) {
      fps.textContent = `${Math.round((frames * 1000) / (now - since))} FPS`;
      frames = 0;
      since = now;
    }
    counting = requestAnimationFrame(count);
  };

  const body = document.body;
  let before: string | null = null;
  const show = (on: boolean) => {
    on &&= !hidden;
    if (on === bar.isConnected) return;
    if (on) {
      // Beside the body, not in it.
      document.documentElement.appendChild(bar);
      before = body.getAttribute('style');
      const top = `calc(${BAR}px + env(safe-area-inset-top))`;
      // A transform makes the body what the page's fixed elements — a HUD at `inset: 0` — are placed
      // in, as the editor's panel does: they move down with it rather than under the bar.
      for (const [name, value] of [['position', 'fixed'], ['margin', '0'], ['overflow', 'hidden'], ['left', '0'], ['right', '0'], ['bottom', '0'], ['top', top], ['width', 'auto'], ['height', 'auto'], ['transform', 'translateZ(0)']]) {
        body.style.setProperty(name!, value!, 'important');
      }
      body.classList.add('scenoco-framed');
      counting = requestAnimationFrame(count);
    } else {
      bar.remove();
      cancelAnimationFrame(counting);
      body.classList.remove('scenoco-framed');
      if (before === null) body.removeAttribute('style');
      else body.setAttribute('style', before);
    }
    // The game sizes itself from the body when the window says it changed.
    dispatchEvent(new Event('resize'));
  };
  return { show };
}

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
