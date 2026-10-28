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

await initRapier();
// Unity's layer collision matrix: the shell's halves pass through the fried egg.
Physics.ignoreLayerCollision(layers.shell, layers.fried);
await loadAssets(...allAssets);

// See-through, so the page's gradient is the sky — Unity's camera cleared depth only, over a gradient canvas.
const renderer = new WebGLRenderer({ antialias: true, alpha: true });
const game = play(Main, { container: document.getElementById('frame')!, renderer });
game.renderer.setClearAlpha(0);
game.renderer.outputColorSpace = LinearSRGBColorSpace; // gamma.ts: nothing encoded on the way out
game.renderer.shadowMap.enabled = shadowsWork(game.renderer.getContext());
game.renderer.shadowMap.type = PCFSoftShadowMap;
game.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// The canvas goes under the page's title and buttons.
document.getElementById('frame')!.prepend(game.renderer.domElement);
// Development only: the game's three.js objects, for checking from the console.
if (import.meta.env.DEV) Object.assign(window, { game });
