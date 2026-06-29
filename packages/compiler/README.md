# @scenoco-three/compiler

The **build-time** toolchain for [SceNoCo](https://github.com/): the XML parser, the
validator, the scene compiler, the optimized bundle encoder, the XSD/docs exporters,
component discovery, a file watcher, and the `scenoco` CLI. **None of this ships to the
browser** — the runtime (`@scenoco-three/core`) loads only the compiled bundle.

```bash
npm i -D @scenoco-three/compiler
```

- [CLI](#cli) · [Library API](#library-api) · [The compile pipeline](#the-compile-pipeline) ·
  [Diagnostics](#diagnostics) · [Standalone & dependencies](#standalone--dependencies)

## CLI

```
scenoco init [dir]                        Scaffold a runnable project
scenoco new component <Name>              Generate src/components/<Name>.ts
scenoco new scene <name>                  Generate a scene skeleton
scenoco check                             Pre-flight (@system co-location, physics)
scenoco validate <file...>                "tsc for scenes": file:line:col diagnostics
scenoco bundle <file> [-o out]            Build the runtime bundle (.bundle.json)
scenoco decompile <bundle.json> [-o out]  Inverse of bundle: back to canonical XML
scenoco watch <file...> [--out dir]       Rebuild bundles on XML/resource changes
scenoco export [--out dir]                Write scene.xsd + the API reference (default ./schema)

  --components <dirs>   Comma-separated dirs scanned for @component classes (default "src")
  --packages <pkgs>     Comma-separated tag packages to register (e.g. @scenoco-three/box2d),
                        so their tags validate and appear in the XSD/docs
```

The exit code is non-zero when validation fails — wire it straight into an edit→check→fix loop.

```bash
scenoco init my-app
scenoco validate scenes/level.scene.xml --components src   # all problems, with fix-its
scenoco bundle  scenes/level.scene.xml -o level.bundle.json --components src
scenoco export  --out schema --components src               # scene.xsd for IDE autocomplete
```

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
const scan = await loadComponents(['src'], undefined, { packages: ['@scenoco-three/box2d'] });
// scan.byName: component name → file · scan.byTag: tag → module · scan.files: watched files
```

`loadComponents` compiles project `.ts` (via esbuild) and **registers** the decorated classes
in this Node process, so the validator sees the full vocabulary. `scanComponents` is the
static (non-executing) scan.

### Watch

```ts
const handle = watchSceneFiles({ files: ['scenes/level.scene.xml'], componentRoots: ['src'] });
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
