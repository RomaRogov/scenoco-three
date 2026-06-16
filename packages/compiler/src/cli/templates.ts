/**
 * Files written by `scenoco init` — kept as a pure path→content map so the
 * scaffold can be unit-tested without touching the filesystem. The result is a
 * runnable SceNoCo project: a starter component, a scene that uses it, and the
 * Vite wiring so `npm run dev` serves it with no XML parser in the browser.
 */
export function scaffoldFiles(packageName: string, version = '^0.1.0'): Record<string, string> {
  return {
    'package.json': json({
      name: packageName,
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        validate: 'scenoco validate src/scenes/hello.scene.xml --components src/components',
        export: 'scenoco export --out schema --components src/components',
      },
      dependencies: {
        '@scenoco-three/core': version,
        three: '^0.184.0',
      },
      devDependencies: {
        '@scenoco-three/compiler': version,
        '@scenoco-three/vite': version,
        '@types/three': '^0.184.0',
        typescript: '^5.6.0',
        vite: '^5.0.0',
      },
    }),

    'tsconfig.json': json({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        experimentalDecorators: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src', 'vite.config.ts'],
    }),

    'vite.config.ts': `import { defineConfig } from 'vite';
import { bundlePlugin } from '@scenoco-three/vite';

// Compiles \`*.scene.xml?bundle\` imports to bundles in Node, and registers the
// components each scene uses — so the browser ships no XML parser.
export default defineConfig({
  plugins: [bundlePlugin({ componentRoots: ['src/components'] })],
});
`,

    'src/vite-env.d.ts': `/// <reference types="vite/client" />

declare module '*.scene.xml?bundle' {
  const bundle: import('@scenoco-three/core').Bundle;
  export default bundle;
}
`,

    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${packageName}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #1a1d24; }
      canvas { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <canvas id="app"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,

    'src/main.ts': `import { Engine } from '@scenoco-three/core';
import scene from './scenes/hello.scene.xml?bundle';

const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
const engine = new Engine({ canvas });
engine.camera.position.set(0, 1.5, 5);
engine.camera.lookAt(0, 0, 0);
engine.loadScene(scene);
`,

    'src/components/Spin.ts': `import { Component, component, property } from '@scenoco-three/core';

@component({ name: 'Spin', description: 'Spins the host node around its Y axis over time' })
export class Spin extends Component {
  @property({ type: 'float', default: 1, description: 'Rotation speed in radians per second' })
  speed = 1;

  // \`this.node\` IS a THREE.Object3D — use Three.js directly.
  override update(dt: number): void {
    this.node.rotation.y += this.speed * dt;
  }
}
`,

    'src/scenes/hello.scene.xml': `<Scene>
  <AmbientLight intensity="0.4" />
  <DirectionalLight intensity="2" position="2 4 3" />

  <Mesh id="cube" position="0 0 0">
    <BoxGeometry width="1.5" height="1.5" depth="1.5" />
    <MeshStandardMaterial color="#4f8ef7" roughness="0.3" metalness="0.6" />
    <Components>
      <Spin speed="1.2" />
    </Components>
  </Mesh>
</Scene>
`,

    'AGENTS.md': agentsMd(packageName),

    '.gitignore': `node_modules/
dist/
.scenoco/
schema/
`,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function agentsMd(packageName: string): string {
  return `# ${packageName} — SceNoCo agent cheat sheet

SceNoCo: 3D scenes are **XML files**; behaviour is **TypeScript components** decorated with
\`@component\`. The Vite plugin compiles XML → browser bundle at build time — no XML parser ships.

## Edit → validate → run loop

\`\`\`
scenoco new component MyBehavior      # scaffold src/components/MyBehavior.ts
scenoco new scene level1 --type rpg   # scaffold src/scenes/level1.scene.xml
npm run validate                       # XML type-checks; exits non-zero on error
npm run dev                            # live at http://localhost:5173
scenoco check                          # pre-flight: co-location, physics, camera issues
\`\`\`

\`npm run export\` writes \`schema/scene.xsd\` (IDE autocomplete) and \`schema/component-api.md\`
(full tag/attribute reference). Always read \`component-api.md\` before authoring a scene.

## Decorator rules (critical — get these wrong, nothing works)

| Decorator | Use case | Co-location rule |
|-----------|----------|-----------------|
| \`@component({ name })\` | Behaviour + data on one node | Any file |
| \`@system(ComponentType)\` | Cross-entity batch (e.g. all Enemies) | **MUST be in the same file as @component T** |
| \`@attachment({ name })\` | Leaf config (geometry, material, physics) | Any file |
| \`@node({ name })\` | Custom Object3D tag | Any file |

**@system-only files are silently skipped.** If EnemySystem is in its own file, it will never
be imported. Always put \`@system(Enemy)\` and \`@component({ name: 'Enemy' })\` in \`Enemy.ts\`.

## Physics decision tree

- **Arcade bounce / patrol (no gravity needed)** → do NOT use Rapier; write manual velocity math.
- **Gravity / character controller / joints** → import Rapier:
  \`\`\`ts
  // main.ts — MUST come before engine.loadScene()
  import { initRapier } from '@scenoco-three/rapier';
  await initRapier();
  \`\`\`
  Then add \`<Physics gravity="0 -9.81 0" />\`, \`<RigidBody kind="dynamic" />\`, \`<Collider />\` in XML.

## Camera patterns

| Pattern | How |
|---------|-----|
| 2D ortho (Breakout) | \`<OrthographicCamera id="cam" />\` in XML + \`engine.setActiveCamera(engine.findObject('cam')!)\` in main.ts |
| 3rd-person 3D (RPG) | \`ThirdPersonCamera @component\` on player; writes to \`engine.camera\` in \`lateUpdate\` |
| Side-scroll | \`PlatformCamera @component\` lerps \`engine.camera.position.x\` in \`lateUpdate\` |

## Input (touch + keyboard)

Never add \`addEventListener\` inside a component — you don't have reliable DOM access.
Use \`InputManager\` (singleton, init once in main.ts):
\`\`\`ts
InputManager.init(canvas);   // in main.ts
InputManager.isPressed('jump');   // in component fixedUpdate
InputManager.justPressed('fire'); // rising edge — requires update() called before engine.tick()
\`\`\`
Touch buttons: \`<TouchButton action="jump" side="bottomRight" />\` as a component in XML.

## import type footgun

\`import type { GameManager }\` is erased at runtime. Passing it to \`findComponent\` crashes:
\`\`\`ts
// ✗ WRONG — import type erased; GameManager is undefined at runtime
import type { GameManager } from './GameManager.js';
this.engine.findComponent('gm', GameManager); // ReferenceError

// ✓ CORRECT — value import keeps the class reference
import { GameManager } from './GameManager.js';
this.engine.findComponent('gm', GameManager);
// OR — string name, no import needed at all:
this.engine.findComponent('gm', 'GameManager');
\`\`\`

## Level data — avoid XML explosion

48 bricks as 48 \`<Mesh>\` blocks exhausts an 8k context window. Use a spawner component instead:
\`\`\`xml
<Group id="bricks">
  <Components><BrickSpawner data="rrrr/bbbb/gggg" cellW="1.3" cellH="0.6" /></Components>
</Group>
\`\`\`
The component calls \`engine.instantiate\` in \`onLoad\` — one XML line, N objects at runtime.

## Scene transitions (avoid mid-tick disposal)

\`\`\`ts
// Dispatch an event from inside a component:
window.dispatchEvent(new CustomEvent('game:nextlevel'));

// Handle in main.ts — setTimeout defers until after current tick:
window.addEventListener('game:nextlevel', () =>
  setTimeout(() => engine.loadScene(nextBundle), 0)
);
\`\`\`
`;
}

/** Generate a component file boilerplate. */
export function componentFile(name: string): string {
  return `import { Component, component, property } from '@scenoco-three/core';

@component({ name: '${name}', description: '' })
export class ${name} extends Component {
  @property({ type: 'float', default: 1 }) speed = 1;

  override update(dt: number): void {
    // this.node is a THREE.Object3D — use Three.js methods directly.
    // To read input: import { InputManager } from './InputManager.js';
    // To find another component: this.engine.findComponent('id', '${name}');
    // To find a scene object: this.engine.findObject('objectId');
    void dt;
  }
}
`;
}

/** Generate a scene XML skeleton for a given game type. */
export function sceneFile(name: string, type: 'basic' | 'rpg' | 'platformer' | 'breakout' = 'basic'): string {
  if (type === 'breakout') return breakoutScene(name);
  if (type === 'rpg') return rpgScene(name);
  if (type === 'platformer') return platformerScene(name);
  return basicScene(name);
}

function basicScene(_name: string): string {
  return `<Scene>
  <AmbientLight intensity="0.5" />
  <DirectionalLight intensity="2" position="5 10 5" />

  <Mesh id="ground" position="0 -0.1 0">
    <BoxGeometry width="20" height="0.2" depth="20" />
    <MeshStandardMaterial color="#4a7c3a" roughness="0.9" />
  </Mesh>

  <Mesh id="player" position="0 0.5 0">
    <BoxGeometry width="1" height="1" depth="1" />
    <MeshStandardMaterial color="#4488ff" roughness="0.5" />
    <Components>
      <!-- Add your components here: <MyComponent speed="3" /> -->
    </Components>
  </Mesh>
</Scene>
`;
}

function breakoutScene(_name: string): string {
  return `<Scene>
  <!--
    Breakout / 2D ortho pattern.
    AGENT NOTE: Call engine.setActiveCamera(engine.findObject('cam')!) in main.ts.
    Without setActiveCamera the engine uses its default PerspectiveCamera.
  -->
  <OrthographicCamera id="cam" position="0 0 10" left="-7" right="7" top="5" bottom="-5" near="0.1" far="100" />
  <AmbientLight intensity="1" />

  <!-- Walls -->
  <Mesh id="wallL" position="-7.1 0 0" visible="false">
    <BoxGeometry width="0.2" height="12" depth="1" />
  </Mesh>
  <Mesh id="wallR" position="7.1 0 0" visible="false">
    <BoxGeometry width="0.2" height="12" depth="1" />
  </Mesh>
  <Mesh id="wallT" position="0 5.1 0" visible="false">
    <BoxGeometry width="14.2" height="0.2" depth="1" />
  </Mesh>

  <Mesh id="paddle" position="0 -4 0">
    <BoxGeometry width="2" height="0.3" depth="0.3" />
    <MeshStandardMaterial color="#00aaff" roughness="0.3" />
    <Components><Paddle /></Components>
  </Mesh>

  <Mesh id="ball" position="0 -3 0">
    <SphereGeometry radius="0.2" />
    <MeshStandardMaterial color="#ffffff" roughness="0.2" />
    <Components><Ball speed="7" /></Components>
  </Mesh>

  <!-- BrickSpawner: one line → many bricks. Avoids XML context explosion. -->
  <Group id="bricks" position="-3.9 2.5 0">
    <Components><BrickSpawner data="1111111/1111111/1111111" cellW="1.3" cellH="0.6" /></Components>
  </Group>

  <Components><GameManager id="gm" lives="3" level="1" /></Components>
</Scene>
`;
}

function rpgScene(_name: string): string {
  return `<Scene>
  <!--
    3rd-person RPG pattern.
    Physics: kinematic RigidBody for player (no gravity drift); static for environment.
    Camera: ThirdPersonCamera @component handles orbit in lateUpdate.
    AGENT NOTE: await initRapier() must be called in main.ts before loadScene().
  -->
  <Background color="#87ceeb" />
  <Fog color="#9bd5ee" near="30" far="60" />
  <AmbientLight intensity="0.5" />
  <DirectionalLight intensity="2" position="10 20 10" />

  <Physics gravity="0 -20 0" />

  <Mesh id="ground" position="0 -0.1 0">
    <BoxGeometry width="60" height="0.2" depth="60" />
    <MeshStandardMaterial color="#4a7c3a" roughness="0.9" />
    <Components><RigidBody kind="fixed" /><Collider shape="box" halfExtents="30 0.1 30" /></Components>
  </Mesh>

  <!--
    Player: id="player" is REQUIRED — systems use engine.findObject('player').
    RigidBody kind="kinematic" + setNextKinematicTranslation in fixedUpdate.
  -->
  <Group id="player" position="0 1 0">
    <Mesh id="playerBody" position="0 0.5 0">
      <CylinderGeometry radiusTop="0.25" radiusBottom="0.25" height="1.0" />
      <MeshStandardMaterial color="#4466cc" roughness="0.5" />
    </Mesh>
    <Components>
      <RigidBody kind="kinematic" />
      <Collider shape="capsule" halfHeight="0.5" radius="0.3" />
      <PlayerController speed="5" />
      <ThirdPersonCamera armLength="6" height="1.5" />
      <VirtualJoystick side="left" />
    </Components>
  </Group>
</Scene>
`;
}

function platformerScene(_name: string): string {
  return `<Scene>
  <!--
    Side-scrolling platformer pattern.
    Physics: dynamic RigidBody for player (gravity applied by Rapier).
    AGENT NOTE (lockRotation): add angularDamping="100" to RigidBody to prevent toppling;
    also reset rotation each fixedUpdate: body.setRotation({x:0,y:0,z:0,w:1}, false).
    AGENT NOTE: await initRapier() must be called in main.ts before loadScene().
    Camera: PlatformCamera @component lerps engine.camera.x in lateUpdate — no camera node needed.
  -->
  <Background color="#5b8dd9" />
  <AmbientLight intensity="0.6" />
  <DirectionalLight intensity="1.8" position="10 20 5" />

  <Physics gravity="0 -25 0" />

  <Mesh id="ground" position="0 -0.3 0">
    <BoxGeometry width="40" height="0.4" depth="2" />
    <MeshStandardMaterial color="#3a6b2a" roughness="0.9" />
    <Components><RigidBody kind="fixed" /><Collider shape="box" halfExtents="20 0.2 1" /></Components>
  </Mesh>

  <!-- Add platform PrefabInstances here: <PrefabInstance src="platform.prefab.xml" position="3 2 0" /> -->

  <!--
    Player: id="player" is REQUIRED.
    TouchButtons provide mobile input; keyboard fallback goes in main.ts.
  -->
  <Group id="player" position="-4 2 0">
    <Mesh id="playerBody">
      <BoxGeometry width="0.6" height="0.9" depth="0.6" />
      <MeshStandardMaterial color="#4488ff" roughness="0.5" />
    </Mesh>
    <Components>
      <RigidBody kind="dynamic" angularDamping="100" />
      <Collider shape="box" halfExtents="0.3 0.45 0.3" />
      <PlatformerPlayer speed="5" jumpForce="12" />
      <PlatformCamera followSpeed="5" offsetY="3" offsetZ="12" />
      <TouchButton action="left"  side="bottomLeft"   label="◀" />
      <TouchButton action="right" side="bottomCenter"  label="▶" />
      <TouchButton action="jump"  side="bottomRight"   label="▲" />
    </Components>
  </Group>

  <Components><GameManager id="gm" lives="3" level="1" /></Components>
</Scene>
`;
}
