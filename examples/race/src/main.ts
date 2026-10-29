import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import { loadAssets, play } from '@scenoco-three/core';
import { initRapier } from '@scenoco-three/rapier';
import { allAssets } from './assets';
import { Race } from './scenes/Race';

await initRapier();
await loadAssets(...allAssets);
const game = play(Race);
game.renderer.shadowMap.enabled = true;
game.renderer.shadowMap.type = PCFShadowMap;
game.renderer.toneMapping = ACESFilmicToneMapping;
