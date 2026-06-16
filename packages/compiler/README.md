# @scenoco-three/compiler

The **build-time** toolchain for [SceNoCo](https://github.com/): the XML parser, the
validator, the scene compiler, the optimized bundle encoder, the XSD/docs exporters,
component discovery, a file watcher, and the `scenoco` CLI. None of this ships to the
browser — the runtime (`@scenoco-three/core`) loads only the compiled bundle.

```bash
scenoco init my-app                          # scaffold a runnable project
scenoco validate scene.xml --components src  # "tsc for scenes": file:line:col diagnostics
scenoco bundle scene.xml -o scene.bundle.json
scenoco export --out schema --components src # scene.xsd + component-api.md
```

```ts
import { compileSceneXml, bundleScene } from '@scenoco-three/compiler';
const result = compileSceneXml(xml, { path, resolve });
if (result.ok) writeFileSync('scene.bundle.json', JSON.stringify(bundleScene(result.scene)));
```

The validator never fail-fasts — one pass returns every problem, each with a position and a
fix-it message. The validator, compiler, and exporters are all generated views of the same
registry as the runtime, so the schema cannot drift.

See the [repository](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md).

## License

[MIT](./LICENSE)
