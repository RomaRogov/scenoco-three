import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import { loadAssets, play } from '@scenoco-three/core';
import { initRapier } from '@scenoco-three/rapier';
import { allAssets } from './assets';
import { Race } from './scenes/Race';

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

// The loading screen fills as each piece arrives: physics, then every model and the ground.
const loading = document.getElementById('loading')!;
const bar = document.getElementById('loading-fill')!;
let done = 0;
const arrived = () => void (bar.style.width = `${(++done / (allAssets.length + 1)) * 100}%`);
await Promise.all([initRapier().then(arrived), ...allAssets.map((asset) => loadAssets(asset).then(arrived))]);

const game = play(Race);
game.renderer.shadowMap.enabled = shadowsWork(game.renderer.getContext());
game.renderer.shadowMap.type = PCFShadowMap;
game.renderer.toneMapping = ACESFilmicToneMapping;
// keepFrameRate (frameRate.ts) is off for now: it took a load's slow frames for a slow device and
// lowered capable ones. Its extras, when it comes back: SunFollow.limit 1024, then 512, then 0.
// Gone once the first frame is drawn: compiling its shaders is the last wait, and the screen covers it.
requestAnimationFrame(() => requestAnimationFrame(() => loading.classList.add('done')));
// Its own fade only: the bar's fill ends transitions inside it too.
loading.addEventListener('transitionend', (e) => e.target === loading && loading.remove());
