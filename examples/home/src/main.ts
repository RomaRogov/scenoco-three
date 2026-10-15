import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import { play } from '@scenoco-three/core';
import { initRapier } from '@scenoco-three/rapier';
import { Home } from './scenes/Home';

await initRapier();
const game = play(Home);
game.renderer.shadowMap.enabled = true;
game.renderer.shadowMap.type = PCFShadowMap;
game.renderer.toneMapping = ACESFilmicToneMapping;
