import ts from 'typescript-transform';
import type { Plugin } from 'vite';

/**
 * Lowers **TC39 standard decorators** with TypeScript before oxc sees the file.
 *
 * Vite's transformer (oxc) cannot do it, and fails in two different ways
 * depending on config — neither of which looks like a decorator problem:
 *
 *  - with `experimentalDecorators: true` in the nearest tsconfig, oxc applies the
 *    **legacy** transform to standard-decorator source. A field decorator is then
 *    called `(prototype, key)` instead of `(undefined, context)`, so the first
 *    `context.metadata` access throws `Cannot convert undefined or null to
 *    object` — from inside `@oxc-project/runtime/helpers/decorate.js`, pointing
 *    at a file that never asked for the legacy transform.
 *  - with it `false`, oxc passes the syntax through untouched. The build
 *    *succeeds* and the bundle contains literal `@component(...) class {…}`,
 *    which dies at load with `SyntaxError: Invalid or unexpected token`.
 *
 * `tsc` lowers them correctly, so this runs TypeScript first and hands oxc plain
 * JavaScript. Every `@scenoco-three/*` package builds with tsc already and so
 * needs none of this; it exists for **game code**, which Vite compiles.
 *
 * TypeScript is imported here as `typescript-transform` — an alias for a pinned
 * TypeScript 6 — because TypeScript 7 replaced the JS compiler API with a client
 * for the Go compiler and dropped `transpileModule` along with it. The
 * typechecker for the workspace is 7; this is a transform tool, versioned
 * separately because it does one job the 7 API no longer offers.
 */
export function standardDecorators(options: { include?: (id: string) => boolean } = {}): Plugin {
  const include = options.include ?? (() => true);
  return {
    name: 'scenoco:standard-decorators',
    // Ahead of Vite's own transform, which is the one that would mangle them.
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || !include(id)) return null;
      // Cheap prefilter: a decorator is the only reason to pay for a transpile,
      // and it must sit at the start of a line (`@` is otherwise common enough
      // in strings and comments to make this worth anchoring).
      if (!/(^|\n)\s*@[A-Za-z_$]/.test(code)) return null;
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
