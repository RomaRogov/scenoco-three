import './gamma';
import { LinearSRGBColorSpace, PCFSoftShadowMap, WebGLRenderer } from 'three';
import { loadAssets, play } from '@scenoco-three/core';
import { Physics, initRapier } from '@scenoco-three/rapier';
import { allAssets } from './assets';
import { Main } from './scenes/Main';
import { layers } from './scenes/prefabs';

/**
 * PowerVR's GLES driver (the Pixel 10's DXT-48) crashes in a draw when shadows meet several textured
 * materials, and takes the WebGL context with it — three.js#34311. `?shadows=1` or `=0` forces it.
 */
function shadowsWork(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const forced = new URLSearchParams(location.search).get('shadows');
  if (forced !== null) return forced !== '0';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return !/PowerVR|Imagination/i.test(gpu);
}

// The loading screen fills as each piece arrives: physics, then every model and texture.
const loading = document.getElementById('loading')!;
const bar = document.getElementById('loading-fill')!;
let done = 0;
const arrived = () => void (bar.style.width = `${(++done / (allAssets.length + 1)) * 100}%`);
await Promise.all([initRapier().then(arrived), ...allAssets.map((asset) => loadAssets(asset).then(arrived))]);
// Unity's layer collision matrix: the shell's halves pass through the fried egg.
Physics.ignoreLayerCollision(layers.shell, layers.fried);

// See-through, so the page's gradient is the sky — Unity's camera cleared depth only, over a gradient canvas.
const renderer = new WebGLRenderer({ alpha: true });
// On the page, so the editor's bar comes with it; the canvas is moved into the frame below.
const game = play(Main, { renderer });
game.renderer.setClearAlpha(0);
game.renderer.outputColorSpace = LinearSRGBColorSpace; // gamma.ts: nothing encoded on the way out
game.renderer.shadowMap.enabled = shadowsWork(game.renderer.getContext());
game.renderer.shadowMap.type = PCFSoftShadowMap;
game.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Between the gradient behind it and the UI over it.
document.getElementById('ui')!.before(game.renderer.domElement);
// Gone once the first frame is drawn: compiling its shaders is the last wait, and the screen covers it.
requestAnimationFrame(() => requestAnimationFrame(() => loading.classList.add('done')));
// Its own fade only: the bar's fill ends transitions inside it too.
loading.addEventListener('transitionend', (e) => e.target === loading && loading.remove());
// Development only: the game's three.js objects, for checking from the console.
if (import.meta.env.DEV) Object.assign(window, { game });
