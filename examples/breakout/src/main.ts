import { ACESFilmicToneMapping, HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { play } from '@scenoco-three/core';
import { Run } from './scenes/Run';
import './layers';

const game = play(Run);

// The look: a filmic curve so the neon does not clip flat, and bloom on what is brighter than white.
game.renderer.toneMapping = ACESFilmicToneMapping;
game.renderer.toneMappingExposure = 1.1;

// The composer draws into its own target, which the canvas's antialiasing does not reach: this one
// is multisampled, so edges stay smooth, and half-float, so emissive colours brighter than white
// survive until the bloom picks them out — a threshold of 1 then glows the neon and nothing else.
const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
const composer = new EffectComposer(game.renderer, target);
// Each level brings its own camera, so the pass is given whichever draws now, every frame.
const scene = new RenderPass(game.scene, game.camera!);
composer.addPass(scene);
composer.addPass(new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.4, 1));
composer.addPass(new OutputPass());

// Sized from the canvas itself, which the editor's panel may narrow, at the canvas's pixel ratio.
const size = new Vector2();
const drawn = new Vector2();
game.render = () => {
  game.renderer.getSize(size);
  if (!size.equals(drawn)) {
    drawn.copy(size);
    composer.setPixelRatio(game.renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
  }
  scene.camera = game.camera!; // render runs only while there is one
  composer.render();
};
