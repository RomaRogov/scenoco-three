import './gamma';
import { LinearSRGBColorSpace, PCFSoftShadowMap, WebGLRenderer } from 'three';
import { loadAssets, play } from '@scenoco-three/core';
import { initRapier } from '@scenoco-three/rapier';
import { allAssets } from './assets';
import { Main } from './scenes/Main';

await initRapier();
await loadAssets(...allAssets);

// See-through, so the page's gradient is the sky — Unity's camera cleared depth only, over a gradient canvas.
const renderer = new WebGLRenderer({ antialias: true, alpha: true });
const game = play(Main, { container: document.getElementById('frame')!, renderer });
game.renderer.setClearAlpha(0);
game.renderer.outputColorSpace = LinearSRGBColorSpace; // gamma.ts: nothing encoded on the way out
game.renderer.shadowMap.enabled = true;
game.renderer.shadowMap.type = PCFSoftShadowMap;
game.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// The canvas goes under the page's title and buttons.
document.getElementById('frame')!.prepend(game.renderer.domElement);
// Development only: the game's three.js objects, for checking from the console.
if (import.meta.env.DEV) Object.assign(window, { game });
