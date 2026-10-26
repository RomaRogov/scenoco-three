import { log } from './phoneLog';
import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import { loadAssets, play } from '@scenoco-three/core';
import { allAssets } from './assets';
import { Menu } from './scenes/Menu';
import { sounds } from './Sfx';

/**
 * PowerVR's driver (the Pixel 10's DXT-48) crashes linking three's shadow depth shader, and takes
 * the WebGL context with it. Without shadows everything else draws fine. `?shadows=1` or `=0` forces it.
 */
function shadowsWork(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const forced = new URLSearchParams(location.search).get('shadows');
  if (forced !== null) return forced !== '0';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return !/PowerVR|Imagination/i.test(gpu);
}

log('loading');
await loadAssets(...allAssets, ...Object.values(sounds));
log('assets loaded');
const game = play(Menu);
game.renderer.shadowMap.enabled = shadowsWork(game.renderer.getContext());
game.renderer.shadowMap.type = PCFShadowMap;
game.renderer.toneMapping = ACESFilmicToneMapping;
game.renderer.toneMappingExposure = 1.1;
// Phones have dense screens: past 1.5× the extra pixels cost GPU memory and heat, and show little.
const touch = matchMedia('(pointer: coarse)').matches;
game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, touch ? 1.5 : 2));
document.getElementById('loading')!.classList.add('done');
log('playing', { shadows: game.renderer.shadowMap.enabled, pixelRatio: game.renderer.getPixelRatio(), size: [game.renderer.domElement.width, game.renderer.domElement.height] });
requestAnimationFrame(() => requestAnimationFrame(() => log('first frames drawn', { calls: game.renderer.info.render.calls, programs: game.renderer.info.programs?.length })));
// Development only: the renderer's counters, for checking GPU memory from the console.
if (import.meta.env.DEV) Object.assign(window, { renderer: game.renderer });
