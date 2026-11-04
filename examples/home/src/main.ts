import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import { play } from '@scenoco-three/core';
import { initRapier } from '@scenoco-three/rapier';
import { Home } from './scenes/Home';
import { drawOnlyWhenSeen, installLanding } from './landing';
import { installSourceButton } from './source';

// Before the physics loads: the page scrolls and reads from its first moment.
installLanding();
await initRapier();
// In a view of its own, which the source panel narrows: the camera fits whatever is left.
const game = play(Home, { container: document.getElementById('view')! });
game.renderer.shadowMap.enabled = true;
game.renderer.shadowMap.type = PCFShadowMap;
game.renderer.toneMapping = ACESFilmicToneMapping;
installSourceButton();
drawOnlyWhenSeen(game);
