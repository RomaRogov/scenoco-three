import { play } from '@scenoco-three/core';
import { Main } from './scenes/Main';

const game = play(Main);
game.renderer.shadowMap.enabled = true; // three.js's renderer, configured as three.js documents it
