# @scenoco-three/compiler

The **build-time** toolchain for [SceNoCo](https://github.com/): the XML parser, the
validator, the scene compiler, the optimized bundle encoder, the XSD/docs exporters,
component discovery, a file watcher, and the `scenoco` CLI. **None of this ships to the
browser** — the runtime (`@scenoco-three/core`) loads only the compiled bundle.

```bash
npm i -D @scenoco-three/compiler
```

- [CLI](#cli) · [Library API](#library-api) · [The compile pipeline](#the-compile-pipeline) ·
  [Prefabs](#prefabs) · [Diagnostics](#diagnostics) · [Standalone & dependencies](#standalone--dependencies)

## CLI

```
scenoco init [dir]                        Scaffold a runnable project
scenoco new <kind> <name>                 Create an asset — run bare to list the kinds
scenoco check                             Pre-flight: scans components, flags physics setup
scenoco validate <file...>                "tsc for scenes": file:line:col diagnostics
scenoco bundle <file> [-o out]            Build the runtime bundle (.bundle.json)
scenoco decompile <bundle.json> [-o out]  Inverse of bundle: back to canonical XML
scenoco watch <file...> [--out dir]       Rebuild bundles on XML/resource changes
scenoco export [--out dir]                Write scene/prefab/material .xsd + scene-api.json (default ./schema)

  --components <dirs>   Comma-separated dirs scanned for @component classes (default "assets")
  --packages <pkgs>     Comma-separated tag packages to register (default: every
                        @scenoco-three/* dependency in the project's package.json)
```

Configuration is zero-config by convention — components/scenes under `assets/`, tag packages
read from `package.json`. The exit code is non-zero when validation fails — wire it straight
into an edit→check→fix loop.

### Assets

`new` and `validate` cover every kind of document a project holds, dispatching on the file
extension. The list is **generated**, not hard-coded: the three built-ins come from the
compiler, and any further kind comes from a tag package that owns a `src=` document format —
so `particle` appears only in projects that depend on `@scenoco-three/particles`.

```
$ scenoco new
Kinds:
  scene      A scene: the <Scene> root with its nodes, attachments and components
  prefab     A reusable node subtree, instantiable at runtime or placed with <PrefabInstance>
  material   A shared material an attachment pulls in with src=
  particle   A particle system / VFX document (Unity Shuriken-style modules)
  component  A @component class: per-instance behaviour, authored in <Components>
  system     A @system class: batch processing for every component of one type
```

Each kind knows where its files go and what to do with one next, and every generated
document is valid and pre-wired to its XSD:

```bash
scenoco new scene main            # assets/scenes/main.scene.xml
scenoco new prefab crate          # assets/scenes/crate.prefab.xml
scenoco new material metal        # assets/materials/metal.material.xml
scenoco new particle sparks       # assets/vfx/sparks.particle.xml
scenoco new component Ball        # assets/components/Ball.ts
scenoco new system SpawnerSystem  # assets/systems/SpawnerSystem.ts
```

`validate` routes each kind to the deepest check available for it: scenes and prefabs are
compiled, a `.material.xml` is checked as a standalone attachment document, and a
package-owned document goes to the format's own compiler — so you get its semantic
diagnostics, not just the structural ones an XSD can express.

```bash
$ scenoco validate assets/vfx/sparks.particle.xml
assets/vfx/sparks.particle.xml:7:1  particle-bad-color  expected a hex color like "#ffcc00", got "notacolor"
```

```bash
scenoco init my-app
scenoco validate assets/scenes/main.scene.xml     # all problems, with fix-its
scenoco bundle   assets/scenes/main.scene.xml -o main.bundle.json
scenoco export   --out schema                     # XSDs for IDE autocomplete + scene-api.json
```

`init` scaffolds an **empty** project: the Vite wiring and one scene holding a camera and a
light, exactly like a new Unity or Cocos scene. Content arrives through `scenoco new`.

## Library API

```ts
import {
  compileSceneXml, compilePrefabXml,  // XML → validated CompiledScene
  bundleScene, bundlePrefab,          // CompiledScene → optimized Bundle
  serializeScene,                     // CompiledScene → canonical XML (round-trip)
  patchSceneXml,                      // surgical, position-preserving edits to XML text
  validateScene, parseScene,          // lower-level passes
  generateXsd, generateApi, generateApiJson, // exporters (from the registry)
  scanComponents, loadComponents,     // discover + register project @component files
  watchSceneFiles,                    // rebuild on source/resource change
  parseUniforms, glslMatches,         // shader uniform parsing/validation helpers
  formatDiagnostic,
} from '@scenoco-three/compiler';
```

### Compile a scene

```ts
const result = compileSceneXml(xml, { path, resolve });
if (result.ok) {
  const bundle = bundleScene(result.scene);
  writeFileSync('scene.bundle.json', JSON.stringify(bundle));
} else {
  for (const d of result.diagnostics) console.error(formatDiagnostic(d, path));
}
```

`CompileOptions`: `path?` (referrer for relative `src=` paths) and `resolve?`
(`ResourceResolver = (request, referrer) => { path, contents } | null`) — required only for
scenes that pull in resource files via `src=`. `CompileResult` is
`{ ok: true; scene } | { ok: false; diagnostics }`.

### Discover project components

```ts
const scan = await loadComponents(['assets'], undefined, { packages: ['@scenoco-three/box2d'] });
// scan.byName: component name → file · scan.byTag: tag → module · scan.files: watched files
```

`loadComponents` compiles project `.ts` (via esbuild) and **registers** the decorated classes
in this Node process, so the validator sees the full vocabulary. `scanComponents` is the
static (non-executing) scan.

### Watch

```ts
const handle = watchSceneFiles({ files: ['scenes/level.scene.xml'], componentRoots: ['assets'] });
handle.on?.((event) => { /* 'diagnostics' | 'success' | 'error' */ });
```

### Exporters

```ts
writeFileSync('schema/scene.xsd', generateXsd());        // IDE autocomplete + inline validation
writeFileSync('schema/scene-api.json', generateApiJson()); // machine-readable API surface
const api = generateApi(); // { nodes, attachments, components, systems, … } — derived from the registry
```

## The compile pipeline

```
XML ──parse(saxes)──► expand prefabs ──► VALIDATE ──► compile (resolve refs/resources) ──► bundle
```

- **parse** — `saxes`, element-only (no text content); positions tracked for diagnostics.
- **validate** — never fail-fasts: one pass returns *every* problem. Unknown tag/attr,
  bad value, dangling `#ref`, cardinality, etc. — each with `file:line:col` and a fix-it.
- **compile** — resolves references and `src=` resources, inlines shader GLSL, validates
  `<Uniform>`s against the shader; produces a flat `CompiledScene`.
- **bundle** — interns a string pool, elides default attrs via bitmasks, integer-encodes
  references and transforms (~73% smaller than naive JSON). Decode is in `core`.

The validator, compiler, and exporters are all generated views of the **same registry** as
the runtime, so the schema cannot drift.

## Prefabs

A **prefab file** has a `<Prefab>` root wrapping one node; a scene places an instance of it
with `<PrefabInstance src="…prefab.xml" id="…">`. Expansion happens **before validation** — the
`<PrefabInstance>` is replaced by the prefab's node subtree, so the validator/compiler/bundle
see ordinary nodes. During expansion:

- the prefab file is parsed, expanded, and **validated standalone** (a prefab is self-contained,
  which is what makes it dynamically spawnable);
- internal ids are **namespaced** into the instance scope (`osc` → `t1/osc`; nested composes to
  `t1/inner/osc`) and internal `#refs` are rewritten to match — so the scene can address an
  instance internal by its scoped id (`<Follow source="#t1/osc"/>`);
- instance **transform attrs** (`position`/`rotation`/`scale`) override the prefab root's.

Per-instance customization uses two children:

```xml
<PrefabInstance src="turbine.prefab.xml" id="t2" position="x: 5">
  <Override target="#osc" amplitude="1.5" />   <!-- patch an internal by prefab-local id -->
  <Components><Highlight color="#f00" /></Components> <!-- extra components on the instance root -->
</PrefabInstance>
```

`<Override>` values are validated against the target's schema, so mistakes point at the
`<Override>` you wrote, not into the prefab file.

### Wiring a prefab internal to a scene reference (the cross-boundary case)

Because a prefab is validated standalone, it can't *name* a scene object. Leave the reference
unset in the prefab and wire it from the instance — the override value is applied **after**
id-scoping, so a scene id passes through unchanged and resolves in the normal scene reference pass:

```xml
<Mesh id="hud"><Components><GameManager id="gm" /></Components></Mesh>
<PrefabInstance src="player.prefab.xml" id="p1">
  <Override target="#controller" gameManager="#gm" />   <!-- #gm is a SCENE id -->
</PrefabInstance>
```

This connects the spawned player's `controller.gameManager` to the scene's `<GameManager>`.
For a prefab spawned at **runtime** (`engine.instantiate` / `PrefabAsset.spawn`, no scene context
at author time), wire it in code instead — see the
[`@scenoco-three/core`](../core/README.md#prefabref) README (spawn → `getComponent` → set field,
or the prefab's script resolving the scene object via `getComponentsOfType` / `findComponent`).

## Diagnostics

```ts
type SceDiagnostic = { code: string; message: string; line: number; column: number; … };
formatDiagnostic(d, filePath); // "level.scene.xml:12:7  unknown attribute 'colour' on <Mesh> — did you mean 'color'?"
```

## Standalone & dependencies

Depends on `@scenoco-three/core` (it imports the registry to know every tag/attr) plus
`saxes` (XML parse), `esbuild` (load project component `.ts` for discovery), and `chokidar`
(watch). It needs **only core** — no `vite` or `editor`. Use it as a library or as the
`scenoco` CLI; the Vite plugin and the editor are thin consumers of this package. Nothing
here is meant for the browser bundle.

See the [repository](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).

## License

[MIT](./LICENSE)
