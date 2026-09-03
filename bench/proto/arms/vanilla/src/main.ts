import { WebGLRenderer } from 'three';
import { Prototype } from './scene.js';

const prototype = new Prototype();
const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.append(renderer.domElement);

prototype.camera.aspect = window.innerWidth / window.innerHeight;
prototype.camera.updateProjectionMatrix();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  prototype.step((now - last) / 1000);
  last = now;
  renderer.render(prototype.scene, prototype.camera);
});
