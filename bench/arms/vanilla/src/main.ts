import { WebGLRenderer } from 'three';
import { Yard } from './game.js';

/**
 * The browser entry: a renderer, a frame loop, and the keyboard.
 *
 * All three are here rather than in `Yard` so the game itself has no opinion about where it is
 * running — which is what lets the test harness drive the same code in Node.
 */
const yard = new Yard();

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
renderer.domElement.style.display = 'block';

function resize(): void {
  const { innerWidth: width, innerHeight: height } = window;
  renderer.setSize(width, height, false);
  yard.camera.aspect = width / height;
  yard.camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

const held = new Set<string>();
window.addEventListener('keydown', (event) => held.add(event.code));
window.addEventListener('keyup', (event) => held.delete(event.code));

let last = performance.now();
renderer.setAnimationLoop((now) => {
  // Capped: a tab that has been in the background hands back one enormous delta, and a step that
  // large teleports the player through crates instead of touching them.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const x = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
  const y = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
  yard.setMove(x, y);

  yard.step(dt);
  renderer.render(yard.scene, yard.camera);
});
