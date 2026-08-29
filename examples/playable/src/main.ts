import { Engine, SceneManager } from '@scenoco-three/core';
import { MainScene } from '../assets/scenes/main.scene.gen.js';

const engine = new Engine();
await SceneManager.load(MainScene);
engine.start();
