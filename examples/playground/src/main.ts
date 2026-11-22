import { PCFShadowMap } from 'three';
import { play } from '@scenoco-three/core';
import { initRapier } from '@scenoco-three/rapier';
import { Playground } from './scenes/Playground';

// Rapier is WebAssembly: loaded once, before the first scene builds its bodies.
await initRapier();
const game = play(Playground);
game.renderer.shadowMap.enabled = true;
game.renderer.shadowMap.type = PCFShadowMap;
