/**
 * The project `scenoco init` writes.
 *
 * It lives here, beside the per-document templates it shares `PRIMITIVES` with, because a whole
 * project is the same kind of thing as one document: a starter read off what the compiler already
 * knows. A separate `create-scenoco` package would buy the `npm create` spelling and cost a second
 * copy of the primitives to keep in step.
 *
 * Two rules govern what is here.
 *
 * **It must run.** `npm install && npm run dev` shows a lit, spinning cube and nothing else is
 * required — the same rule the per-document starters in `templates.ts` follow, for the same
 * reason: a starter the compiler then rejects teaches the format wrong, and it is the first thing
 * anyone runs. So the diagnostic that makes this framework worth using is offered as an
 * *invitation* in the scene, not sprung as a broken build.
 *
 * **It must show the model, not describe it.** A reader — a person or a model — reproduces what
 * it reads, not what it could have asked for. So every core verb appears here exactly once, in
 * four components of a dozen lines each: a setting, both kinds of slot (`#id` and a prefab path),
 * a getter for runtime state, `Input`, `update` and `lateUpdate`, `instantiate` with its configure
 * callback, and `getComponent`. What the starter does not show gets reinvented from generic
 * three.js, which is the failure the whole framework exists to prevent.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { PRIMITIVES } from './templates.js';

/** One file the scaffolder writes. */
export interface TemplateFile {
  path: string;
  contents: string;
}

/** Dependency ranges the starter pins. Kept here so there is one place to bump them. */
const VERSIONS = {
  scenoco: '^0.6.0',
  three: '^0.184.0',
  vite: '^8.0.0',
  typescript: '^7.0.0',
  typesThree: '^0.184.0',
} as const;

export function templateFiles(projectName: string): TemplateFile[] {
  return [
    {
      path: 'package.json',
      contents:
        JSON.stringify(
          {
            name: projectName,
            private: true,
            version: '0.0.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'vite build',
              preview: 'vite preview',
              check: 'scenoco build && tsc --noEmit',
            },
            dependencies: {
              '@scenoco-three/core': VERSIONS.scenoco,
              three: VERSIONS.three,
            },
            devDependencies: {
              '@scenoco-three/compiler': VERSIONS.scenoco,
              '@scenoco-three/vite': VERSIONS.scenoco,
              '@types/three': VERSIONS.typesThree,
              typescript: VERSIONS.typescript,
              vite: VERSIONS.vite,
            },
          },
          null,
          2,
        ) + '\n',
    },

    {
      path: 'tsconfig.json',
      contents: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  // "strict", and deliberately not "noUncheckedIndexedAccess": it is not part of "strict", and
  // in gameplay code the index is nearly always one the code just computed — waypoints[i] with
  // i kept in range by a "% length". Every measured build of this starter met that flag, and
  // every one answered with a "!", which silences the check everywhere, including the cases
  // worth catching. A flag whose only observed effect is teaching people to write "!" is not
  // buying safety.
  //
  // "assets" is in here because the compiler writes a .gen.ts beside every document, and those
  // are ordinary TypeScript that tsc must check — that check is what catches a bad #id.
  "include": ["src", "assets"]
}
`,
    },

    {
      path: 'vite.config.ts',
      contents: `import { defineConfig } from 'vite';
import { scenoco } from '@scenoco-three/vite';

// The plugin compiles every document under assets/ on start, and again whenever one changes.
export default defineConfig({ plugins: [scenoco()] });
`,
    },

    {
      path: '.gitignore',
      contents: `node_modules/
dist/

# A .gen.ts is a build artifact: it sits beside the .xml it came from and is rewritten on every
# build. The document is the source of truth, so committing both means reviewing every change
# twice and resolving conflicts in generated code.
*.gen.ts
# What the build read from the project's TypeScript, for the editor. Rewritten on every build.
.scenoco/
`,
    },

    {
      path: 'index.html',
      contents: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${projectName}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0b1120; overflow: hidden; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
    },

    {
      path: 'src/main.ts',
      contents: `import { Engine, SceneManager } from '@scenoco-three/core';
import { MainScene } from '../assets/scenes/main.scene.gen.js';

// MainScene is generated from assets/scenes/main.scene.xml — ordinary TypeScript, sitting beside
// the document. Open it if you want to see exactly what the XML became.
const engine = new Engine();
await SceneManager.load(MainScene);
engine.start();
`,
    },

    {
      path: 'src/tags.ts',
      contents: `// The packages whose tags this project's documents use.
//
// Tags are only ever written in XML, so nothing else here would import them — and a package is
// read through a real import, not through package.json. Without this file a fresh project has no
// vocabulary at all, because the .gen.ts files that would otherwise import three do not exist
// until the first build.
//
// Add a line per tag package you install: '@scenoco-three/ui', '@scenoco-three/box2d', and so on.
import 'three';
`,
    },

    {
      path: 'src/Mover.ts',
      contents: `import { MathUtils } from 'three';
import { Component, Input } from '@scenoco-three/core';

/** Drives its node over the ground with the arrow keys. */
export class Mover extends Component {
  /** Units per second. A public field is an attribute: <Mover speed="6"> sets it. */
  speed = 6;
  /** How far from the middle it may go. */
  bounds = 18;

  override update(dt: number): void {
    // Input is sampled once a frame, so every component sees the same keys. Read it here rather
    // than with window.addEventListener: this is also what the observer drives when it simulates
    // the scene, so input written this way is testable without a human at the keyboard.
    // The axes are Unity's: \`Horizontal\` is A/D and the arrows, \`Vertical\` is W/S and the
    // arrows, and both ease in and out. \`getAxisRaw\` is the same pair without the easing.
    const x = Input.getAxis('Horizontal');
    // Forward is -z in three.js, and \`Vertical\` is +1 when you press up.
    const z = -Input.getAxis('Vertical');

    // \`object3D\` is the plain THREE.Object3D this component sits on, with all of three on it.
    const p = this.object3D.position;
    p.x = MathUtils.clamp(p.x + x * this.speed * dt, -this.bounds, this.bounds);
    p.z = MathUtils.clamp(p.z + z * this.speed * dt, -this.bounds, this.bounds);
  }
}
`,
    },

    {
      path: 'src/Spawner.ts',
      contents: `import { Component, Input, KeyCode, type PrefabType } from '@scenoco-three/core';
import { Spinner } from './Spinner.js';

/** Drops a crate where its node stands, on Space. */
export class Spawner extends Component {
  /** A field typed PrefabType is a slot the document fills with a path: crate="../prefabs/crate.prefab.xml". */
  crate!: PrefabType;
  /** No more than this many, ever. */
  limit = 12;

  // Runtime state is private or a getter — a public field would be an XML attribute.
  private count = 0;

  get dropped(): number {
    return this.count;
  }

  override update(): void {
    // \`getKeyDown\` is true for exactly one frame.
    if (!Input.getKeyDown(KeyCode.Space) || this.count >= this.limit) return;
    this.count += 1;

    // instantiate builds the prefab, places it, and only then lets it into the scene, so its
    // components wake with the transform already final. The callback runs in between: that is
    // where you reach into what you made. \`getComponent\` finds by class, never by name.
    // The id is how anything reaches *this* crate later — \`scene.byId('crate3', Mesh)\` in code,
    // \`telemetry\` on \`crate3\` in the editor. Every id is unique, hence the counter.
    const at = this.object3D.position.clone().setY(0.25);
    this.scene.instantiate(this.crate, { id: \`crate\${this.count}\`, position: at }, (crate) => {
      const spinner = crate.getComponent(Spinner);
      if (spinner) spinner.speed *= this.count;
    });
  }
}
`,
    },

    {
      path: 'src/Follow.ts',
      contents: `import { Vector3, type Object3D } from 'three';
import { Component } from '@scenoco-three/core';

/** Keeps its node a fixed offset from another node, looking at it. Lives on the camera. */
export class Follow extends Component {
  /** A field typed as a node is a slot the document fills with an id: target="#player". A wrong id is a build error. */
  target!: Object3D;
  /** Where to sit, relative to the target. */
  offset = new Vector3(0, 4, 8);
  /** How quickly it catches up. Higher is stiffer. */
  stiffness = 6;

  private readonly goal = new Vector3();

  // lateUpdate runs after every update, so the target has already moved this frame.
  override lateUpdate(dt: number): void {
    this.goal.copy(this.target.position).add(this.offset);
    this.object3D.position.lerp(this.goal, 1 - Math.exp(-this.stiffness * dt));
    this.object3D.lookAt(this.target.position);
  }
}
`,
    },

    {
      path: 'src/Spinner.ts',
      contents: `import { MathUtils } from 'three';
import { Component } from '@scenoco-three/core';

/** Turns its node around Y. Lives on the crate prefab. */
export class Spinner extends Component {
  /** Degrees per second. */
  speed = 90;

  override update(dt: number): void {
    this.object3D.rotation.y += MathUtils.degToRad(this.speed) * dt;
  }
}
`,
    },

    {
      path: 'assets/materials/ground.asset.xml',
      contents: `<MeshStandardMaterial color="#243047" roughness="0.95" metalness="0" />
`,
    },

    {
      path: 'assets/materials/block.asset.xml',
      contents: `<MeshStandardMaterial color="#4af0e0" roughness="0.35" metalness="0.1" />
`,
    },

    {
      path: 'assets/materials/crate.asset.xml',
      contents: `<MeshStandardMaterial color="#f0b429" roughness="0.5" metalness="0.1" />
`,
    },

    {
      path: 'assets/prefabs/crate.prefab.xml',
      contents: `<!-- A prefab: the root element IS the node it makes — a Mesh, with no wrapper around it.
     scale="0.5" makes it half a unit on a side. Spawned by src/Spawner.ts, which decides where. -->
<Mesh geometry="../geometry/cube.asset.xml" material="../materials/crate.asset.xml" scale="0.5">
  <Components>
    <Spinner speed="90" />
  </Components>
</Mesh>
`,
    },

    {
      path: 'assets/scenes/main.scene.xml',
      contents: `<!-- The whole project, in one document.

     An element is a class and an attribute is one of its properties — <PerspectiveCamera fov>
     exists because three.js's PerspectiveCamera has a fov, and <Mover speed> exists because your
     Mover class has a public \`speed\`. There is no registry and no second list to keep in step.

     Arrow keys move the block; Space drops a crate; the camera follows. The four components in
     src/ are a dozen lines each and, between them, use everything a component can do.

     The shapes are in assets/geometry, sized as Unity sizes them:

       cube        1 x 1 x 1
       sphere      1 across
       cylinder    1 across, 2 tall     — scale="y: 3" is 6 tall, not 3
       capsule     1 across, 2 tall
       cone        1 across, 1 tall
       quad        1 x 1, standing upright
       plane       10 x 10, standing upright — lay it flat with eulerAngles="x: -90"

     A node's position is the middle of it, so a 1-tall cube resting on the ground is at y: 0.5.

     ── Try this ────────────────────────────────────────────────────────────────────────
     Change speed="6" below to speed="fast", then run:  npx scenoco check
     The compiler will name the file, the line, the column and what to write instead. That
     answer is the reason this framework exists; everything else is machinery. -->
<Scene camera="#camera" background="#0b1120">
  <!-- The camera follows the player. target="#player" fills a field typed Object3D; a wrong id
       is a build error, not a blank screen. -->
  <!-- A camera looks down its own -z until something turns it: here Follow aims it at #player.
       Without Follow, turn it yourself — eulerAngles="x: -90" looks straight down from above. -->
  <PerspectiveCamera id="camera" fov="45" near="0.1" far="200" position="y: 4; z: 8">
    <Components>
      <Follow target="#player" offset="y: 4; z: 8" />
    </Components>
  </PerspectiveCamera>

  <AmbientLight color="#9db8d8" intensity="0.7" />
  <DirectionalLight color="#fff4e0" intensity="2" position="x: 4; y: 8; z: 5" />

  <!-- The ground: the 10 x 10 plane, laid flat and scaled to 40 across. -->
  <Mesh geometry="../geometry/plane.asset.xml" material="../materials/ground.asset.xml"
        eulerAngles="x: -90" scale="4" />

  <!-- The player: a 1 x 1 x 1 cube resting on the ground, with two components on it. -->
  <Mesh id="player" geometry="../geometry/cube.asset.xml"
        material="../materials/block.asset.xml" position="y: 0.5">
    <Components>
      <Mover speed="6" bounds="18" />
      <!-- A field typed PrefabType is filled with a document path. -->
      <Spawner crate="../prefabs/crate.prefab.xml" limit="12" />
    </Components>
  </Mesh>
</Scene>
`,
    },

    ...Object.entries(PRIMITIVES).map(([name, contents]) => ({
      path: `assets/geometry/${name}.asset.xml`,
      contents,
    })),

    {
      path: 'AGENTS.md',
      contents: `# Working in this project

SceNoCo is a Unity-shaped component layer for three.js. Scenes are XML documents compiled to
TypeScript; behaviour is TypeScript classes. If you know Unity, you know this: the names are
Unity's, and \`this.object3D\` is the plain three.js object underneath.

**Start with \`npx scenoco describe\`.** One command, one page: this project's own components
with their settings, its documents, and every shape and material inline — then the vocabulary and
how the pieces fit. It is the whole project without opening a file, and it cannot go stale,
because it is read off the source.

## The model

| | is | you write |
| --- | --- | --- |
| **Component** | MonoBehaviour: behaviour on one node | \`class Mover extends Component\` in \`src/\`, then \`<Mover speed="6" />\` inside a node's \`<Components>\` |
| **System** | your GameManager, without the singleton: rules, score, a physics world | \`class Run extends System\`, then \`<Run />\` under \`<Systems>\`; reach it with \`this.requireSystem(Run)\` |
| **Prefab** | a document whose root element is the node it makes | \`crate.prefab.xml\`; spawn it with \`node.instantiate(this.crate, { position })\` |
| **Scene** | a \`.scene.xml\` | an element is a three.js class or one of your components; an attribute is its public property. \`src/main.ts\` loads one — a new scene runs only once that (or another scene) loads it |

Nothing is registered. A class that extends \`Component\` is a tag, and its public fields are its
attributes. That is the whole registration.

Physics, in-canvas UI, particles, audio and post-processing are **separate packages** —
\`@scenoco-three/box2d\`, \`rapier\`, \`collision\`, \`ui\`, \`particles\`, \`audio\`, \`postfx\`. Depend on one
and import it in \`src/tags.ts\`, and its tags join the vocabulary; depend on none and none of it
ships. Their tags follow the same two rules as yours: a node is an element in the tree
(\`<Canvas>\`, \`<Panel>\`), a component goes in a node's \`<Components>\` (\`<Button />\`,
\`<ParticleSystem>\`), and \`describe\` names which each one is. One may bring a whole kind of
document with it — \`particles\` makes \`.particle.xml\` a thing this project has. \`scenoco describe\`
always lists what is actually wired up.

## Six rules

1. **A public field is a setting the document sets.** Runtime state — score, carried, a timer —
   is \`private\` or a getter.
2. **A field typed as a node or a component is a slot.** \`target!: Object3D\` is filled with
   \`target="#player"\`; \`crate!: PrefabType\` with a prefab path. The compiler checks the id.
   **A list is one attribute, bracketed:** \`waypoints: Vector3[]\` takes
   \`waypoints="[x: 9; z: 9, x: 9; z: -9, x: -9; z: -9]"\`, \`speeds: number[]\` takes
   \`speeds="[1, 2, 3]"\`, and \`marks: Object3D[]\` takes \`marks="[#m1, #m2]"\`. A patrol route
   belongs in the document, not hard-coded in \`awake\`.
3. **Reach a specific thing by its id, a kind of thing by its class.** A slot in the document —
   \`target="#player"\` — is the best spelling: the compiler checks the id. Give every spawn an id,
   \`instantiate(this.crate, { id: \`crate\${n}\`, position })\`, and it is reachable as
   \`this.scene.byId('crate3', Crate)\`, with what the prefab named inside it as \`'crate3/lid'\`.
   \`this.getComponent(Type)\`, \`other.getComponent(Type)\` and \`this.scene.findObjectsOfType(Type)\`
   are for kinds. Never \`traverse\`, \`getObjectByName\`, \`name ===\` or \`any\`.
4. **Input is \`Input.getAxis('Horizontal')\` / \`getButtonDown('Jump')\` / \`getKey\`, read in
   \`update\`.** The axis and button names are Unity's — \`Horizontal\`, \`Vertical\`, \`Jump\`,
   \`Fire1\`, \`Submit\`, \`Cancel\`, \`Mouse X\` — and \`getAxis\` eases in and out the way Unity's
   does, with \`getAxisRaw\` for the bare -1/0/1. \`Input.setAxis('Horizontal', 0.5)\` drives one
   from elsewhere, which is how an on-screen joystick feeds the same code the keyboard feeds.
   Never
   \`window.addEventListener\`: input is sampled once a frame so the editor can drive it.
5. **Time is the \`dt\` handed to \`update\`.** A timer is a countdown field. Never \`setTimeout\`: it
   fires into destroyed objects and cannot be paused or stepped.
6. **No constructors.** Your own state goes in \`awake()\` — a system's too, since components read
   it in their \`start()\`; reaching other components goes in \`start()\`, when everything has awoken.

## Hooks

\`awake\` · \`start\` · \`update(dt)\` · \`fixedUpdate(dt)\` · \`lateUpdate(dt)\` · \`onEnable\` · \`onDisable\` ·
\`onDestroy\`. With \`@scenoco-three/collision\` or \`rapier\` imported in \`src/tags.ts\`, also
\`onTriggerEnter(other)\` / \`onCollisionEnter(other)\` — called on the components of the node that carries the collider, with \`other\` the node that carries the other one: \`other.getComponent(Player)\`.

## About to write… → write instead

| about to write | write |
| --- | --- |
| \`scene.traverse(o => o.name === 'ore')\` | \`this.scene.findObjectsOfType(Ore)\`, or \`this.scene.byId('ore3', Ore)\` |
| \`obj.userData.hp\`, \`(obj as any)._hp\` | a component on that node, with \`hp\` on it |
| \`window.addEventListener('keydown', …)\` | \`Input.getKeyDown(KeyCode.Space)\` in \`update\` |
| \`setTimeout(fn, 500)\` | \`this.left -= dt\` in \`update\`; \`startCoroutine\` for a sequence |
| \`emit('died')\`, \`dispatchEvent\` | \`readonly died = new Event<[Enemy]>()\`; \`this.listen(enemy.died, fn)\` |
| \`mesh.visible = false\` to take it out of play | \`mesh.destroy()\`, or \`mesh.setActive(false)\` to bring it back later. \`visible\` only stops it being drawn — it keeps updating, and on a UI element it keeps its place in the layout |
| \`mesh.material.color.set(…)\` to tint one mesh | clone it once, in \`awake\` of a \`Component<Mesh>\`: \`this.object3D.material = (this.object3D.material as MeshStandardMaterial).clone()\`. In three.js a material is one object shared by every mesh drawn with it, so without the clone the tint reaches all of them |
| \`new Mesh(geometry, material)\` inside a component | a prefab document, and \`instantiate\` |
| \`template.clone()\` of a node in the scene | \`this.scene.instantiate(template, { position })\` — Unity's \`Instantiate\`: its components come too, each with its own values. An inactive template gives an inactive copy; \`setActive(true)\` it |
| \`import { Object3D, Mesh, Vector3 } from '@scenoco-three/core'\` | \`from 'three'\`. Core exports what it adds — \`Component\`, \`System\`, \`Event\`, \`Input\`, \`Time\`, \`KeyCode\` — and three.js's own classes come from \`three\`, with core's additions already on them |
| \`<Cube>\` | \`<Mesh geometry="../geometry/cube.asset.xml" material="…" />\` |

## Commands

- \`npm run check\` — compiles the documents and typechecks. Run it after every edit; it prints
  \`file:line:col\` and the exact text to write instead.
- \`npx scenoco describe <Name> [<Name>…]\` — what a tag, a component or a runtime API accepts,
  read off the same declarations \`tsc\` checks, so there is never a reason to open a \`.d.ts\`.
  Name several at once: \`describe Component Object3D System Input Time Event Coroutine\` is one
  command, and those seven are most of what a component can do.

\`npx scenoco describe\` first — the project and the vocabulary in one page. Then \`src/\` if you
want the prose: four components that, between them, use every verb above.
`,
    },

    {
      path: 'CLAUDE.md',
      contents: `@AGENTS.md
`,
    },

    {
      path: 'README.md',
      contents: `# ${projectName}

Built with [SceNoCo](https://github.com/RomaRogov/scenoco-three) — a Unity-shaped scene and
component layer for three.js, whose scenes are XML documents compiled to TypeScript.

\`\`\`bash
npm install
npm run dev
\`\`\`

## What is where

| | |
| --- | --- |
| \`AGENTS.md\` | The model in a page. Read it first, whoever you are. |
| \`assets/scenes/main.scene.xml\` | The scene. |
| \`assets/prefabs/crate.prefab.xml\` | A prefab: a document whose root is the node it makes. |
| \`assets/geometry/\` | Shared shapes, at Unity's sizes. A mesh names one. |
| \`assets/materials/\` | Shared materials, likewise. |
| \`src/Mover.ts\`, \`Spawner.ts\`, \`Follow.ts\`, \`Spinner.ts\` | Four components. Between them, every verb a component has. |
| \`src/tags.ts\` | Which tag packages are in play. One import per package. |
| \`src/main.ts\` | Loads the scene and starts the loop. |

Each document compiles to a \`.gen.ts\` beside it on every build. Those are artifacts — they are
gitignored, and the XML is the source of truth.

## The two commands worth knowing

\`\`\`bash
npx scenoco check
\`\`\`

Compiles without writing, and reports \`file:line:col\` with the exact text to write instead. This
is also the CI command.

\`\`\`bash
npx scenoco describe Mesh
\`\`\`

What a name means in *this* project — a component's fields with their defaults, a tag's
attributes, or a document's ids. With no name, the whole vocabulary. Try
\`npx scenoco describe main.scene.xml\`, or \`npx scenoco describe Cube\` to see what it says about
shapes.

## Adding things

\`\`\`bash
npx scenoco new scene level-2      # or: prefab, asset, texture, render
\`\`\`

A component needs no scaffolding at all: write a class that extends \`Component\` in \`src/\`, give
it a public field, and it is available as an element with that attribute. That is the whole
registration.

Physics, in-canvas UI, particles, audio and post-processing are separate packages —
\`@scenoco-three/box2d\`, \`rapier\`, \`ui\`, \`particles\`, \`audio\`, \`postfx\`. Install one and its tags
join the vocabulary; install none and none of it ships. A package may bring a whole kind of
document with it — install \`particles\` and \`scenoco new particle sparks\` starts working.
`,
    },
  ];
}

/** Where a scaffolded project ended up, and what went into it. */
export interface ScaffoldResult {
  /** Absolute path of the directory written into. */
  directory: string;
  /** Project-relative paths, in the order they were written. */
  written: string[];
}

/**
 * Write a runnable project into `directory`.
 *
 * Refuses a directory that already has files in it, and there is no `--force`: this exists to
 * make a *new* project, and the failure it would otherwise have — quietly overwriting someone's
 * work because they ran it in the wrong place — is not worth the flag.
 */
export function scaffold(directory: string, projectName?: string): ScaffoldResult {
  const root = resolve(directory);
  const name = projectName ?? (basename(root) || 'scenoco-game');

  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(
      `${root} is not empty.\nName a directory that does not exist yet: scenoco init my-game`,
    );
  }

  const written: string[] = [];
  for (const file of templateFiles(name)) {
    const full = join(root, file.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.contents);
    written.push(file.path);
  }
  return { directory: root, written };
}
