import { ACESFilmicToneMapping, Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { play } from '@scenoco-three/core';
import { Run } from './scenes/Run';

const game = play(Run);

// The look: a filmic curve so the emissive bricks do not clip flat, and enough bloom to make them
// read as neon rather than plastic. Three.js's own post-processing, as its docs show it.
game.renderer.toneMapping = ACESFilmicToneMapping;
game.renderer.toneMappingExposure = 1.05;

const composer = new EffectComposer(game.renderer);
// Each level brings its own camera, so the pass is given whichever draws now, every frame — the
// run starts on a scene with none.
const scene = new RenderPass(game.scene, game.camera!);
composer.addPass(scene);
// Threshold 0.5: the emissive paddle and the lit brick faces glow, not only the ball.
composer.addPass(new UnrealBloomPass(new Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.5));
composer.addPass(new OutputPass());
addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));

game.render = () => {
  scene.camera = game.camera!; // render runs only while there is one
  composer.render();
};
