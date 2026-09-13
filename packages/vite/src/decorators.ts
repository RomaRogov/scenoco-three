import type { Plugin } from 'vite';

/** The pinned TypeScript, loaded on first use. See the note on the import at the bottom. */
type Transform = typeof import('typescript-transform');
let loading: Promise<Transform> | undefined;

async function typescript(): Promise<Transform> {
  loading ??= import('typescript-transform').catch(() => {
    throw new Error(
      "[scenoco] standardDecorators() needs a TypeScript to lower decorators with, and it is not " +
        'installed. Add it:\n\n  npm i -D typescript-transform@npm:typescript@^6\n\n' +
        'It is a separate, pinned copy because TypeScript 7 dropped `transpileModule`; the ' +
        'plugin does not need it unless you use a decorator.',
    );
  });
  return loading;
}

/**
 * Lowers **TC39 standard decorators** with TypeScript before oxc sees the file.
 *
 * Vite's transformer (oxc) cannot do it, and fails in two different ways
 * depending on config — neither of which looks like a decorator problem:
 *
 *  - with `experimentalDecorators: true` in the nearest tsconfig, oxc applies the
 *    **legacy** transform to standard-decorator source. A field decorator is then
 *    called `(prototype, key)` instead of `(undefined, context)` — so it is handed
 *    a string where it expects its context, and reads nonsense out of it. There is
 *    no error to follow: `@serializeField` silently marks nothing.
 *  - with it `false`, oxc passes the syntax through untouched. The build
 *    *succeeds* and the bundle contains literal `@component(...) class {…}`,
 *    which dies at load with `SyntaxError: Invalid or unexpected token`.
 *
 * `tsc` lowers them correctly, so this runs TypeScript first and hands oxc plain
 * JavaScript. Every `@scenoco-three/*` package builds with tsc already and so
 * needs none of this; it exists for **game code**, which Vite compiles.
 *
 * TypeScript is imported as `typescript-transform` — an alias for a pinned TypeScript 6 —
 * because TypeScript 7 replaced the JS compiler API with a client for the Go compiler and
 * dropped `transpileModule` along with it. The typechecker for the workspace is 7; this is a
 * transform tool, versioned separately because it does one job the 7 API no longer offers.
 *
 * It is loaded **lazily, on the first file that actually has a decorator**, and declared as an
 * optional peer. A static import here would put a second full TypeScript in the dependency graph
 * of every project that installs the plugin — and, until 0.5.1, broke them outright, because the
 * package was resolvable inside this repo's workspace and nowhere else.
 */
export function standardDecorators(options: { include?: (id: string) => boolean } = {}): Plugin {
  const include = options.include ?? (() => true);
  return {
    name: 'scenoco:standard-decorators',
    // Ahead of Vite's own transform, which is the one that would mangle them.
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.ts') || !include(id)) return null;
      // Cheap prefilter: a decorator is the only reason to pay for a transpile,
      // and it must sit at the start of a line (`@` is otherwise common enough
      // in strings and comments to make this worth anchoring).
      if (!/(^|\n)\s*@[A-Za-z_$]/.test(code)) return null;
      // Loaded only now: importing this module must not drag a whole TypeScript into the graph
      // of every project that merely depends on the plugin — `scenoco()` does not use any of it.
      // CJS interop: Node gives `{ default: module.exports, ...named }` for a CommonJS package,
      // and bundlers may hand back the namespace directly. Accept either.
      const loaded = await typescript();
      const ts = (loaded as { default?: Transform }).default ?? loaded;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          experimentalDecorators: false,
          useDefineForClassFields: true,
          // Types are the typechecker's job; this pass only rewrites syntax.
          isolatedModules: true,
          sourceMap: true,
        },
      });
      return {
        code: out.outputText,
        map: out.sourceMapText ? (JSON.parse(out.sourceMapText) as never) : null,
      };
    },
  };
}
