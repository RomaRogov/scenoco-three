import { WebGLRenderer } from 'three';
import { play } from '@scenoco-three/core';
import { Run } from './scenes/Run';
import './layers';

// The loading screen fills as the game gets ready: its code is here, then its fonts, then the first frame.
const loading = document.getElementById('loading')!;
const bar = document.getElementById('loading-fill')!;
const reached = (part: number) => void (bar.style.width = `${part * 100}%`);
reached(1 / 3);
await Promise.all([document.fonts.load('bold 16px Orbitron'), document.fonts.load('italic 800 16px "Exo 2"')]);
reached(2 / 3);

const game = play(Run, { renderer: new WebGLRenderer({ powerPreference: 'high-performance' }) });
// A renderer given to play keeps its own pixel ratio: the screen's, up to 2.
game.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

// Gone once the first frame is drawn: compiling its shaders is the last wait, and the screen covers it.
requestAnimationFrame(() => requestAnimationFrame(() => {
  reached(1);
  loading.classList.add('done');
}));
// Its own fade only: the bar's fill ends transitions inside it too.
loading.addEventListener('transitionend', (e) => e.target === loading && loading.remove());

// keepFrameRate (frameRate.ts) is off for now: it took a load's slow frames for a slow device and
// lowered capable ones. Its extras, when it comes back: the bloom (its Bloom component off), then the balls' lights (BallLights.on = false).
