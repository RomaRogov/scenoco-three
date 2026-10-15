import { play } from '@scenoco-three/core';
import { initRapier } from '@scenoco-three/rapier';
import { ACESFilmicToneMapping } from 'three';
import { Main } from './scenes/Main';

await initRapier();
const game = play(Main);
game.renderer.shadowMap.enabled = true;
game.renderer.toneMapping = ACESFilmicToneMapping;
game.renderer.toneMappingExposure = 1.05;
