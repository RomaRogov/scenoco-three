import { ACESFilmicToneMapping, HalfFloatType, Vector2, WebGLRenderTarget, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { play } from '@scenoco-three/core';
import { Run } from './scenes/Run';
import './layers';

// The loading screen fills as the game gets ready: its code is here, then its fonts, then the first frame.
const loading = document.getElementById('loading')!;
const bar = document.getElementById('loading-fill')!;
const reached = (part: number) => void (bar.style.width = `${part * 100}%`);
reached(1 / 3);
await Promise.all([document.fonts.load('bold 16px Orbitron'), document.fonts.load('italic 800 16px "Exo 2"')]);
reached(2 / 3);

const game = play(Run, { renderer: new WebGLRenderer({ powerPreference: 'high-performance' }) });
// A renderer given to play keeps its own pixel ratio: the screen's, up to 2.
game.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

// The look: a filmic curve so the neon does not clip flat, and bloom on what is brighter than white.
game.renderer.toneMapping = ACESFilmicToneMapping;
game.renderer.toneMappingExposure = 1.1;

// The composer draws into its own target: half-float, so emissive colours brighter than white
// survive until the bloom picks them out — a threshold of 1 then glows the neon and nothing else.
// Not multisampled: crisp edges, as the canvas.
const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
const composer = new EffectComposer(game.renderer, target);
// Each level brings its own camera, so the pass is given whichever draws now, every frame.
const scene = new RenderPass(game.scene, game.camera!);
composer.addPass(scene);
composer.addPass(new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.4, 1));
composer.addPass(new OutputPass());

// Sized from the canvas itself, which the editor's panel may narrow, at the canvas's pixel ratio —
// which `keepFrameRate` may lower as the game runs.
const size = new Vector2();
const drawn = new Vector2();
let ratio = 0;
game.render = () => {
  game.renderer.getSize(size);
  if (!size.equals(drawn) || game.renderer.getPixelRatio() !== ratio) {
    drawn.copy(size);
    ratio = game.renderer.getPixelRatio();
    composer.setPixelRatio(ratio);
    composer.setSize(size.x, size.y);
  }
  scene.camera = game.camera!; // render runs only while there is one
  composer.render();
};

// Gone once the first frame is drawn: compiling its shaders is the last wait, and the screen covers it.
requestAnimationFrame(() => requestAnimationFrame(() => {
  reached(1);
  loading.classList.add('done');
}));
// Its own fade only: the bar's fill ends transitions inside it too.
loading.addEventListener('transitionend', (e) => e.target === loading && loading.remove());

// keepFrameRate (frameRate.ts) is off for now: it took a load's slow frames for a slow device and
// lowered capable ones. Its extras, when it comes back: the bloom (game.render straight to the
// screen), then the balls' lights (BallLights.on = false).
