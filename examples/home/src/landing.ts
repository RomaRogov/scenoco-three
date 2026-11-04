/** The page around the scene: not part of the game, so the source panel leaves it out. */
import type { Game } from '@scenoco-three/core';

/** Shrinks the scene as the page scrolls, reveals the rest as it comes into view. */
export function installLanding(): void {
  const stage = document.getElementById('stage')!;
  const frame = document.getElementById('frame')!;
  const travel = () => stage.offsetHeight - frame.offsetHeight;

  let queued = false;
  const update = () => {
    queued = false;
    const t = travel() > 0 ? Math.min(Math.max(scrollY / travel(), 0), 1) : 1;
    const p = t * t * (3 - 2 * t);
    stage.style.setProperty('--p', p.toFixed(4));
    stage.classList.toggle('settled', p > 0.8);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  update();

  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        reveal.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const element of document.querySelectorAll('[data-reveal]')) {
    element.classList.add('will-reveal');
    reveal.observe(element);
  }
}

/** A reader far down the page is not looking at the scene: its physics runs on, its drawing rests. */
export function drawOnlyWhenSeen(game: Game): void {
  const draw = game.render;
  new IntersectionObserver(([entry]) => {
    game.render = entry!.isIntersecting ? draw : () => {};
  }).observe(document.getElementById('frame')!);
}
