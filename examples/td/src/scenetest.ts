/**
 * Development only: the title screen rebuilt from its real assets in plain three.js, one ingredient
 * more at each step, each in a fresh WebGL context. The first step a phone's GPU fails on names what
 * crashes it. It stops there; results go to the dev server as `[phone]` lines.
 */
import { log } from './phoneLog';
import {
  ACESFilmicToneMapping, Box3, DirectionalLight, Fog, HemisphereLight, InstancedMesh, Matrix4, type Mesh, type Object3D,
  PCFShadowMap, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer,
} from 'three';
import { BatchedRenderer, ParticleSystem } from 'three.quarks';
import { configToParameters } from '@scenoco-three/particles';
import { loadAssets, sharedModel } from '@scenoco-three/core';
import { models } from './assets';
import meadowGlb from './levels/meadow/terrain.glb?url';

// The lab's mesh of the meadow, one baked colour map: a fixed load for comparing phones.
const meadowMesh = sharedModel(meadowGlb);
import { vfx } from './vfx';

type Options = { antialias: boolean; terrain: boolean; models: boolean; scatter: boolean; shadows: boolean; fogTone: boolean; particles: boolean };
const none: Options = { antialias: false, terrain: false, models: false, scatter: false, shadows: false, fogTone: false, particles: false };
const steps: [string, Options][] = [
  ['1 terrain only', { ...none, terrain: true }],
  ['2 + castle, cave, towers (quantized models)', { ...none, terrain: true, models: true }],
  ['3 + instanced trees', { ...none, terrain: true, models: true, scatter: true }],
  ['4 + fog and ACES tone mapping', { ...none, terrain: true, models: true, scatter: true, fogTone: true }],
  ['5 + antialiasing (MSAA)', { ...none, terrain: true, models: true, scatter: true, fogTone: true, antialias: true }],
  ['6 + shadows', { ...none, terrain: true, models: true, scatter: true, fogTone: true, antialias: true, shadows: true }],
  ['7 + particles: the whole title screen', { antialias: true, terrain: true, models: true, scatter: true, shadows: true, fogTone: true, particles: true }],
];

const out = document.getElementById('out')!;
const lines: string[] = [];
const show = (text: string, ok: boolean) => {
  lines.push(`<div class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${text}</div>`);
  out.innerHTML = lines.join('');
};

function shadowed(root: Object3D, cast: boolean) {
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) { m.castShadow = cast; m.receiveShadow = cast; }
  });
  return root;
}

function place(model: Object3D, x: number, z: number, height: number) {
  const box = new Box3().setFromObject(model);
  const s = height / (box.max.y - box.min.y);
  model.scale.setScalar(s);
  model.position.set(x, 1 - box.min.y * s, z);
  return model;
}

async function run(name: string, o: Options): Promise<boolean> {
  const canvas = document.createElement('canvas');
  document.getElementById('canvases')!.appendChild(canvas);
  let lost = false;
  canvas.addEventListener('webglcontextlost', () => (lost = true));
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(String(args[0]).slice(0, 300)); original(...args); };

  const renderer = new WebGLRenderer({ canvas, antialias: o.antialias });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(300, 560, false);
  if (o.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap; }
  if (o.fogTone) renderer.toneMapping = ACESFilmicToneMapping;
  const scene = new Scene();
  if (o.fogTone) scene.fog = new Fog('#a8dcf5', 50, 110);
  scene.add(new HemisphereLight('#fff4dc', '#56784a', 1.5));
  const sun = new DirectionalLight('#ffffff', 2.3);
  sun.position.set(16, 32, 12);
  sun.castShadow = o.shadows;
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, far: 90 });
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  const camera = new PerspectiveCamera(45, 300 / 560, 0.1, 500);
  camera.position.set(14, 22, 21);
  camera.lookAt(0, 1, 0);

  if (o.terrain) {
    const ground = meadowMesh.instantiate();
    ground.scale.setScalar(0.25);
    scene.add(shadowed(ground, o.shadows));
  }
  if (o.models) {
    scene.add(shadowed(place(models.castle.instantiate(), 0, 26, 5.2), o.shadows));
    scene.add(shadowed(place(models.cave.instantiate(), 0, -30, 3.4), o.shadows));
    scene.add(shadowed(place(models.archer.instantiate(), -4, 3, 3), o.shadows));
    scene.add(shadowed(place(models.goblin.instantiate(), 2, 0, 1), o.shadows));
  }
  if (o.scatter) {
    const root = models.tree.value.scene;
    root.updateMatrixWorld(true);
    root.traverse((p) => {
      const part = p as Mesh;
      if (!part.isMesh) return;
      const mesh = new InstancedMesh(part.geometry, part.material, 60);
      for (let i = 0; i < 60; i++) {
        const at = new Vector3((Math.random() - 0.5) * 50, 1, (Math.random() - 0.5) * 50);
        mesh.setMatrixAt(i, new Matrix4().compose(at, new Quaternion(), new Vector3(2, 2, 2)).multiply(part.matrixWorld));
      }
      mesh.castShadow = mesh.receiveShadow = o.shadows;
      scene.add(mesh);
    });
  }
  let batch: BatchedRenderer | null = null;
  if (o.particles) {
    batch = new BatchedRenderer();
    for (const effect of [vfx.embers, vfx.aura]) {
      const system = new ParticleSystem(configToParameters({ ...effect, prewarm: true }));
      scene.add(system.emitter);
      batch.addSystem(system);
    }
    scene.add(batch);
  }

  for (let frame = 0; frame < 30 && !lost; frame++) {
    batch?.update(1 / 30);
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
  }
  await new Promise((r) => setTimeout(r, 500));
  console.error = original;
  const ok = !lost && errors.length === 0;
  log(`scenetest ${ok ? 'PASS' : 'FAIL'}`, { step: name, lost, errors, programs: renderer.info.programs?.length });
  show(`${name}${lost ? ' — context lost' : ''}${errors.length ? ' — ' + errors[0] : ''}`, ok);
  renderer.dispose();
  return ok;
}

await loadAssets(models.castle, models.cave, models.archer, models.goblin, models.tree, meadowMesh);
out.textContent = 'Running…';
let passed = true;
for (const [name, options] of steps) {
  if (!(await run(name, options))) {
    passed = false;
    log('scenetest stopped at', name);
    out.innerHTML += '<p>Stopped at the first failure. Tell Claude it is done.</p>';
    break;
  }
}
if (passed) out.innerHTML += '<p>Every step passed. Tell Claude it is done.</p>';
