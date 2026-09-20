import type { SncDiagnostic } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { TsModule } from './module.js';
import { buildConstruction } from './resource.js';
import { EmitScope, identifier, type GraphOptions } from './scope.js';
import { emitNode, applyPlacement, partitionChildren } from './nodes.js';
import { claimComponentIds, emitComponentsFor, emitSystems } from './wiring.js';
import { applySceneSettings, emitMainCamera } from './scene.js';
import { STRUCTURAL } from './placement.js';

export type { GraphOptions };

/**
 * Compile one scene or prefab document into a TypeScript class.
 *
 * ### Why a class, and not data
 *
 * Generated code *is* the channel, so nothing decodes authored data at load. `tsc` checks every
 * reference, a bad `#id` is a type error with a real file and line, and nothing has to execute
 * user code to find out what a component is.
 *
 * ### Two passes, and why
 *
 * The tree is built first and components are attached afterwards. A document may reference a
 * node declared further down — breakout's ball lists bricks that appear after it — and a
 * single pass would have to either forward-declare or reorder. Two passes read the same way
 * the XML does, and `start` (which is where components reach each other) does not run until
 * the first tick regardless.
 *
 * ### Where the rest of it lives
 *
 * This file is the assembly: what a scene's `onLoad` contains, in what order, and what a prefab
 * puts in its constructor. Each *kind* of thing it assembles is a module of its own —
 * [nodes](./nodes.ts), [spawns and overrides](./spawn.ts), [components and
 * systems](./wiring.ts), [the scene's own attributes](./scene.ts) — and they share the
 * bookkeeping through [`EmitScope`](./scope.ts) rather than by being methods on one class.
 */
export function emitGraph(
  root: SncElement,
  options: GraphOptions,
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { kind, name, source } = options;
  const module = new TsModule(
    `// GENERATED from ${source} — do not edit.\n// Regenerate with \`scenoco build\`.`,
  );

  if (kind === 'scene' && root.tag !== 'Scene') {
    module.report({
      line: root.line,
      column: root.column,
      code: 'bad-root',
      message: `A scene document must be rooted at <Scene>, not <${root.tag}>.`,
      ...(root.file ? { file: root.file } : {}),
    });
    return { diagnostics: module.diagnostics };
  }

  // The component API lives on `THREE.Object3D` as an augmentation, so a file that calls
  // `addComponent` or `instantiate` has to pull core in for its side effect.
  module.sideEffect('@scenoco-three/core');

  const scope = new EmitScope(module, options);
  const code = kind === 'scene' ? emitScene(scope, root, name) : emitPrefab(scope, root, name);
  return { ...(module.diagnostics.length === 0 ? { code } : {}), diagnostics: module.diagnostics };
}

// --- documents -------------------------------------------------------------------------

function emitScene(scope: EmitScope, root: SncElement, name: string): string {
  // Claimed before anything is imported: a scene called `Breakout` in a project that also has
  // a `Breakout` component must not end up with the class and the import sharing a name.
  const className = scope.module.declare(name);
  const Scene = scope.module.require('three', 'Scene');
  const fields: string[] = [];
  const build: string[] = [];

  scope.stamp(root, 'this', build);
  for (const child of root.children) emitNode(scope, child, 'this', build);

  // Systems are *emitted* after the tree and *run* before it. The two are different
  // questions: reading them here means a system may reference a node with `#id`, because by
  // now every id in the document is known; printing `addSystem` above the tree means a
  // component woken by a spawned prefab still finds the configured system rather than
  // creating a default one. What cannot be moved is the assignment of those references — a
  // node cannot be handed over before it exists — so a system reads them in `start()`,
  // which is exactly what `start()` is for.
  // Every component id first: a system may name one, and nothing has emitted a component yet.
  claimComponentIds(scope, root, 'this');
  const systems: string[] = [];
  const systemWiring: string[] = [];
  emitSystems(scope, root, systems, systemWiring);

  const settings: string[] = [];
  applyPlacement(scope, root, 'this', settings, true);
  applySceneSettings(scope, root, settings);

  const wiring: string[] = [];
  emitComponentsFor(scope, root, 'this', wiring);
  emitMainCamera(scope, root, settings);
  for (const placed of scope.byId.values()) fields.push(`${identifier(placed)}!: ${placed.typeName};`);
  fields.push(...scope.componentFields());

  scope.module.block(`export class ${className} extends ${Scene} {`, () => {
    for (const field of fields) scope.module.line(field);
    if (fields.length > 0) scope.module.line();
    scope.module.block(`override ${onLoadSignature(scope)} {`, () => {
      emitWait(scope);
      for (const line of systems) scope.module.line(line);
      if (systems.length > 0 && build.length > 0) scope.module.line();
      for (const line of build) scope.module.line(line);
      if (settings.length > 0) {
        scope.module.line();
        for (const line of settings) scope.module.line(line);
      }
      if (wiring.length > 0) {
        scope.module.line();
        scope.module.line('// Components last, so every `#id` above is already a real object.');
        for (const line of wiring) scope.module.line(line);
      }
      if (systemWiring.length > 0) {
        scope.module.line();
        // After the components too: a system slot typed as a component — `startButton!: Button` —
        // is `node.getComponent(Button)`, which is null until that component is on the node. It
        // read null here, silently, and the system met `undefined` in `start()`.
        scope.module.line("// A system's references, now that the tree and its components exist.");
        for (const line of systemWiring) scope.module.line(line);
      }
    });
  });
  return scope.module.render();
}

/**
 * `onLoad(): void`, or the async form when something has to arrive first.
 *
 * `Scene.load` awaits `onLoad`, so a scene that names a model or a sound simply becomes async
 * — the same arrangement Unity has, where loading a scene loads what it references and nobody
 * writes the load call. A prefab cannot do this: `instantiate` is synchronous by contract, so
 * a prefab publishes its assets instead and whoever spawns it awaits them.
 */
function onLoadSignature(scope: EmitScope): string {
  return scope.assets.awaited.length > 0 ? 'async onLoad(): Promise<void>' : 'onLoad(): void';
}

/** The wait for everything this document cannot build without. */
function emitWait(scope: EmitScope): void {
  if (scope.assets.awaited.length === 0) return;
  const loadAssets = scope.module.require('@scenoco-three/core', 'loadAssets');
  scope.module.line('// The files this scene is built from, fetched before anything is built.');
  scope.module.line(`await ${loadAssets}(${scope.assets.awaited.join(', ')});`);
  scope.module.line();
}

function emitPrefab(scope: EmitScope, root: SncElement, name: string): string {
  const className = scope.module.declare(name);
  const tag = scope.tagFor(root, 'node');
  if (!tag) return scope.module.render();

  const base = scope.module.require(tag.module, tag.name);
  // What the root is built from goes before `super()`, in the constructor, so every instance
  // `instantiate` makes builds its own — the same `new` per node a scene's inline material gets.
  const construct: string[] = [];
  const { attached, nodes } = partitionChildren(scope, root, tag, construct);
  const { call, assignments } = buildConstruction(
    tag,
    root,
    scope.module,
    scope.context,
    STRUCTURAL,
    attached,
  );
  const superArgs = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'));

  // A system is a scene service; a prefab is a node. Silently dropping the block would leave
  // a physics world that never existed and nothing to explain why.
  for (const child of root.children) {
    if (child.tag !== 'Systems') continue;
    scope.report(
      child,
      'systems-in-prefab',
      '<Systems> belongs to a scene, not a prefab — a system serves the whole scene, and a ' +
        'prefab may be spawned many times. Declare it in the scene that spawns this prefab.',
    );
  }

  const build: string[] = [];
  // The root is `this`, so it never passes through `emitNode` — and it is exactly the node a
  // click on a spawned instance lands on. A scene that spawns this prefab overwrites the stamp
  // with its own `<Prefab>` element, which is the right answer in *that* document.
  scope.stamp(root, 'this', build);
  for (const assignment of assignments) build.push(`this.${assignment}`);
  applyPlacement(scope, root, 'this', build);
  for (const child of nodes) emitNode(scope, child, 'this', build);

  const wiring: string[] = [];
  emitComponentsFor(scope, root, 'this', wiring);

  const fields = [
    ...[...scope.byId.values()]
      .filter((placed) => placed.element !== root)
      .map((placed) => `${identifier(placed)}!: ${placed.typeName};`),
    ...scope.componentFields(),
  ];

  scope.module.block(`export class ${className} extends ${base} {`, () => {
    if (scope.assets.awaited.length > 0) {
      // A prefab cannot await: `instantiate` hands back a finished node. So it publishes what
      // it needs, and whoever spawns it does the waiting — a scene that declares a
      // `<Prefab src>` folds this into its own `loadAssets`, and code spawning one mid-game
      // writes `await loadAssets(...Enemy.assets)`.
      scope.module.line('/** The files this prefab is built from. Await them before spawning it. */');
      scope.module.line(`static readonly assets = [${scope.assets.awaited.join(', ')}] as const;`);
      scope.module.line();
    }
    for (const field of fields) scope.module.line(field);
    if (fields.length > 0) scope.module.line();
    if (superArgs.trim().length > 0) {
      // A prefab class is constructed with no arguments — `instantiate` calls `new Type()` —
      // so whatever the tag's constructor wanted has to be supplied here rather than passed
      // in. Assigning it after `super()` would be wrong for the slots three.js only reads
      // once (`InstancedMesh`'s count, a geometry a Mesh caches).
      scope.module.block('constructor() {', () => {
        for (const line of construct) scope.module.line(line);
        scope.module.line(`super(${superArgs});`);
      });
      scope.module.line();
    }
    scope.module.block('override onLoad(): void {', () => {
      for (const line of build) scope.module.line(line);
      if (wiring.length > 0) {
        scope.module.line();
        scope.module.line('// Components last, so every `#id` above is already a real object.');
        for (const line of wiring) scope.module.line(line);
      }
    });
  });
  return scope.module.render();
}
