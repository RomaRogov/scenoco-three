import { Engine, SceneManager } from '@scenoco-three/core';
import { MainScene } from '../assets/scenes/main.scene.gen.js';

// MainScene is generated from assets/scenes/main.scene.xml — ordinary TypeScript, sitting beside
// the document. Open it if you want to see exactly what the XML became.
const engine = new Engine();
await SceneManager.load(MainScene);
engine.start();
