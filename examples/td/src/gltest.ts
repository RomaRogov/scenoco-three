/**
 * Development only: which part of the particle shader a phone's GPU driver refuses. Each step draws
 * the game's ember effect in a fresh WebGL context, the shader cut down to less than the real one;
 * the first step that fails names the culprit. It stops there: Chrome blocks WebGL after a few
 * crashes in a row. Results show on the page and go to the dev server as `[phone]` lines.
 */
import { log } from './phoneLog';
import {
  ACESFilmicToneMapping, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer,
} from 'three';
import { BatchedRenderer, ParticleSystem } from 'three.quarks';
import { configToParameters } from '@scenoco-three/particles';
import { vfx } from './vfx';

const MIN_VERTEX = `
attribute vec3 offset;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
  mvPosition.xy += position.xy * 0.3;
  gl_Position = projectionMatrix * mvPosition;
}`;
const MIN_FRAGMENT = `void main() { gl_FragColor = vec4(1.0, 0.5, 0.2, 1.0); }`;

type Step = { name: string; edit?: (m: ShaderMaterial) => void; control?: boolean };
const steps: Step[] = [
  { name: '0 control: MeshBasicMaterial', control: true },
  { name: '1 particle, both shaders minimal', edit: (m) => { m.vertexShader = MIN_VERTEX; m.fragmentShader = MIN_FRAGMENT; } },
  { name: '2 real vertex shader, minimal fragment', edit: (m) => { m.fragmentShader = MIN_FRAGMENT; } },
  { name: '3 minimal vertex, real fragment shader' },
  { name: '4 real shaders, no texture', edit: (m) => { delete m.uniforms.map; m.defines = { ...m.defines }; delete m.defines.USE_MAP; delete m.defines.USE_UV; } },
  { name: '5 real shaders, no tone mapping', edit: (m) => { m.toneMapped = false; } },
  { name: '6 the real thing' },
];

const out = document.getElementById('out')!;
const lines: string[] = [];
const show = (text: string, ok: boolean) => {
  lines.push(`<div class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${text}</div>`);
  out.innerHTML = lines.join('');
};

async function run(step: Step): Promise<boolean> {
  const canvas = document.createElement('canvas');
  document.getElementById('canvases')!.appendChild(canvas);
  let lost = false;
  canvas.addEventListener('webglcontextlost', () => (lost = true));
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(String(args[0]).slice(0, 300)); original(...args); };

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(120, 120, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 1, 4);
  camera.lookAt(0, 0.5, 0);

  if (step.control) {
    scene.add(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: '#ff8800' })));
  } else {
    const batch = new BatchedRenderer();
    const system = new ParticleSystem(configToParameters({ ...vfx.embers, prewarm: true }));
    scene.add(system.emitter);
    batch.addSystem(system);
    scene.add(batch);
    const material = (batch as unknown as { batches: { material: ShaderMaterial }[] }).batches[0]!.material;
    if (step.name.startsWith('3')) {
      // The real fragment shader reads vColor and vUv; the minimal vertex shader passes three's own `color` and `uv` on.
      material.vertexShader = `attribute vec3 offset; varying vec4 vColor; varying vec2 vUv;
        void main() { vColor = color; vUv = uv; vec4 mv = modelViewMatrix * vec4(offset, 1.0); mv.xy += position.xy * 0.3; gl_Position = projectionMatrix * mv; }`;
    } else {
      step.edit?.(material);
    }
    for (let i = 0; i < 20; i++) batch.update(1 / 30);
  }
  for (let frame = 0; frame < 10; frame++) {
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
  }
  await new Promise((r) => setTimeout(r, 400));
  console.error = original;
  const ok = !lost && errors.length === 0;
  log(`gltest ${ok ? 'PASS' : 'FAIL'}`, { step: step.name, lost, errors });
  show(`${step.name}${lost ? ' — context lost' : ''}${errors.length ? ' — ' + errors[0] : ''}`, ok);
  renderer.dispose();
  return ok;
}

for (const step of steps) {
  if (!(await run(step))) {
    log('gltest stopped at', step.name);
    out.innerHTML += '<p>Stopped at the first failure. Tell Claude it is done.</p>';
    break;
  }
}
if (!lines.some((l) => l.includes('bad'))) out.innerHTML += '<p>Every step passed. Tell Claude it is done.</p>';
