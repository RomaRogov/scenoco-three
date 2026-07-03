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
        validate: 'scenoco validate assets/scenes/hello.scene.xml',
        export: 'scenoco export --out schema',
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
      include: ['src', 'assets', 'vite.config.ts'],
    }),

    'vite.config.ts': `import { defineConfig } from 'vite';
import { bundlePlugin } from '@scenoco-three/vite';

// Compiles \`*.scene.xml?bundle\` imports to bundles in Node, and registers the
// components each scene uses — so the browser ships no XML parser. Components are
// scanned from assets/ and tag packages read from package.json by default.
export default defineConfig({
  plugins: [bundlePlugin()],
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
import scene from '../assets/scenes/hello.scene.xml?bundle';

const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
const engine = new Engine({ canvas });
// The scene declares a <PerspectiveCamera>; loadScene auto-activates it.
engine.loadScene(scene);
`,

    'assets/components/Spin.ts': `import { Component, component, property } from '@scenoco-three/core';

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

    'assets/scenes/hello.scene.xml': `<Scene>
  <PerspectiveCamera id="cam" position="0 1 5" />
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

/** Generate a component file boilerplate. */
export function componentFile(name: string): string {
  return `import { Component, component, property } from '@scenoco-three/core';

// A one-line description is required on every @component and @property — it is
// what people, the editor, and agents/RAG read to understand the API. Fill it in.
@component({ name: '${name}', description: 'TODO: describe what this component does' })
export class ${name} extends Component {
  @property({ type: 'float', default: 1, description: 'TODO: describe this property' }) speed = 1;

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

/** A scene XML skeleton — a camera and a light, like a fresh Unity scene. */
export function sceneFile(_name: string): string {
  return `<Scene>
  <PerspectiveCamera id="cam" position="0 1 5" />
  <DirectionalLight intensity="2" position="5 10 5" />
</Scene>
`;
}
