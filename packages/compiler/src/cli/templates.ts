/**
 * Files written by `scenoco init` — kept as a pure path→content map so the
 * scaffold can be unit-tested without touching the filesystem.
 *
 * The result is a runnable but *empty* project: the Vite wiring, and one scene
 * holding a camera and a light. That is deliberately what a new Unity or Cocos
 * scene contains — no sample cube, no sample component. A scaffold that ships
 * demo content leaves every new project starting with a deletion, and teaches
 * the shape of the demo rather than the shape of the tool. `scenoco new` is how
 * content arrives, and `init` says so on its way out.
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
        validate: 'scenoco validate assets/scenes/main.scene.xml',
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
import scene from '../assets/scenes/main.scene.xml?bundle';

const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
const engine = new Engine({ canvas });
// The scene declares a <PerspectiveCamera>; loadScene auto-activates it.
engine.loadScene(scene);
`,

    'assets/scenes/main.scene.xml': sceneFile('main'),

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
  return `import { Component, component, property, ValueType } from '@scenoco-three/core';

// A one-line description is required on every @component and @property — it is
// what people, the editor, and agents/RAG read to understand the API. Fill it in.
@component({ name: '${name}', description: 'TODO: describe what this component does' })
export class ${name} extends Component {
  @property({ type: ValueType.Float, description: 'TODO: describe this property' }) speed = 1;

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

/**
 * A scene skeleton: one camera, one light, nothing else — a fresh Unity or Cocos
 * scene, which is what a new scene should be. Content comes from `scenoco new`,
 * not from a scaffold guessing at it.
 *
 * Every generated document carries the `xsi:noNamespaceSchemaLocation` hint, so
 * IDE completion and `scripts/check-xml.sh` work on it from the first save (a
 * file without the hint is silently skipped by the checker).
 */
export function sceneFile(_name: string): string {
  return `<Scene xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:noNamespaceSchemaLocation="../../schema/scene.xsd">
  <PerspectiveCamera id="camera" position="y: 1; z: 5" />
  <DirectionalLight intensity="2" position="x: 5; y: 10; z: 5" />
</Scene>
`;
}

/**
 * A prefab skeleton: one node, ready to be given attachments and components.
 * A `<Prefab>` root may hold several nodes, but one is the common case and the
 * clearer starting point.
 */
export function prefabFile(name: string): string {
  return `<Prefab xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="../../schema/prefab.xsd">
  <Mesh id="${name}">
    <Attachments>
      <BoxGeometry width="1" height="1" depth="1" />
      <MeshStandardMaterial color="#cccccc" />
    </Attachments>
  </Mesh>
</Prefab>
`;
}

/**
 * A shared material. Scenes pull it in with
 * `<MeshStandardMaterial src="../materials/<name>.material.xml" />`, and inline
 * attributes on that element override what the file sets.
 */
export function materialFile(_name: string): string {
  return `<MeshStandardMaterial xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                      xsi:noNamespaceSchemaLocation="../../schema/material.xsd"
                      color="#cccccc" roughness="0.5" metalness="0" />
`;
}

/**
 * A `@system` boilerplate. A system batch-processes every component of one type
 * each frame — the right shape when per-instance `update()` would repeat work
 * that could be done once (a shared query, a single renderer, one physics step).
 */
export function systemFile(name: string): string {
  const component = name.replace(/System$/, '') || 'Target';
  return `import { System, system } from '@scenoco-three/core';
import { ${component} } from '../components/${component}.js';

// Runs once per frame over every <${component}> in the scene, instead of each
// component updating itself. Worth it when there is shared work to hoist (one
// query, one renderer, one world step); otherwise just use ${component}.update().
//
// The engine starts this automatically whenever a loaded scene contains a
// <${component}>, and only in play mode.
@system(${component})
export class ${name} extends System<${component}> {
  /** Once, when the system starts. Also available: fixedStep, onDetach. */
  override onAttach(): void {}

  override step(dt: number): void {
    for (const c of this.components) {
      void c;
      void dt;
    }
  }
}
`;
}
