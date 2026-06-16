import { Engine, type SceneInstance } from '@scenoco-three/core';
import * as THREE from 'three';
// Compiled to bundles in Node at build time — the browser ships no XML parser,
// and each bundle import pulls in exactly the components it uses.
import turbineScene from './scenes/turbine.scene.xml?bundle';
import turbinePrefab from './scenes/turbine.prefab.xml?bundle';

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  const hud = document.querySelector<HTMLDivElement>('#hud');
  if (!canvas || !hud) {
    throw new Error('Playground bootstrap failed: missing #app canvas or #hud');
  }

  const engine = new Engine({ canvas });
  engine.scene.background = new THREE.Color('#1a1d24');
  engine.camera.position.set(3, 5, 13);
  engine.camera.lookAt(3, 1, -1);

  // Ground plane (engine chrome, not part of the authored scene).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  engine.scene.add(ground);

  // The static scene: two prefab instances (one overridden) sharing a steel
  // material, plus an indicator that reaches into instance internals by id.
  engine.loadScene(turbineScene);

  // Dynamic loading: click to spawn a turbine prefab at runtime, capped at a
  // ring of instances — the oldest is destroyed as new ones appear.
  const spawned: SceneInstance[] = [];
  const MAX = 6;

  const updateHud = (): void => {
    hud.textContent =
      'Static scene from a bundle: 2 prefab instances (Turbine_02 overridden) + indicator.\n' +
      `Click anywhere to engine.instantiate() the turbine prefab dynamically — spawned: ${spawned.length}/${MAX}.`;
  };

  canvas.addEventListener('pointerdown', () => {
    const instance = engine.instantiate(turbinePrefab);
    // Positioning the Group root is safe: the Oscillator animates the body
    // within it, so it won't fight this transform.
    instance.root.position.set(-5 + spawned.length * 2, 1, 4);
    spawned.push(instance);
    if (spawned.length > MAX) spawned.shift()!.destroy();
    updateHud();
  });

  updateHud();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
