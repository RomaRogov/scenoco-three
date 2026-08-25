import { Engine, SceneManager } from '@scenoco-three/core';
import { MainScene } from '../assets/scenes/main.scene.gen.js';

const engine = new Engine();
const scene = await SceneManager.load(MainScene);
engine.start();

// A handle for the smoke check to read from.
Object.assign(window as unknown as Record<string, unknown>, { engine, scene, SceneManager });
console.log('[smoke] scene loaded:', scene.children.length, 'root children');
