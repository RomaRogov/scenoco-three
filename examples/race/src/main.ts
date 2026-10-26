import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import { loadAssets, play } from '@scenoco-three/core';
import { roadPiece } from './assets';
import { Race } from './scenes/Race';

await loadAssets(roadPiece);
const game = play(Race);
game.renderer.shadowMap.enabled = true;
game.renderer.shadowMap.type = PCFShadowMap;
game.renderer.toneMapping = ACESFilmicToneMapping;
