import { resolve } from 'node:path';
import { build, formatDiagnostic, type ProjectModel } from '@scenoco-three/compiler';
import type { Plugin, ViteDevServer } from 'vite';

export interface ScenocoOptions {
  /** Project root — the directory holding `tsconfig.json` and `assets/`. Defaults to Vite's root. */
  root?: string;
  /** Defaults to `<root>/tsconfig.json`. */
  tsconfig?: string;
  /**
   * Packages whose tags the documents may use, beyond `three` — `@scenoco-three/box2d`,
   * `@scenoco-three/ui`. A package is only readable when the project actually imports it
   * somewhere, so this is the list, not a guess.
   */
  modules?: readonly string[];
}

/**
 * Compiles every SceNoCo document in the project, and keeps them compiled while you edit.
 *
 * ```ts
 * // vite.config.ts
 * import { scenoco } from '@scenoco-three/vite';
 * export default { plugins: [scenoco({ modules: ['three', '@scenoco-three/box2d'] })] };
 * ```
 *
 * ```ts
 * // and in your app
 * import { Breakout } from './assets/scenes/breakout.scene.gen.js';
 * await SceneManager.load(Breakout);
 * ```
 *
 * There are no virtual modules. A document compiles to an ordinary `.ts` file beside it, so a
 * scene is imported by its name and the bundler's own graph decides what ships — unused
 * components are dropped because nothing imports them. Asset URLs are
 * `new URL(…, import.meta.url)`, which Vite already rewrites. What is left is running the
 * compiler at the right moments, which is this file.
 */
export function scenoco(options: ScenocoOptions = {}): Plugin {
  let root: string;
  let tsconfig: string;
  /** The last scan, reused while only documents change. */
  let model: ProjectModel | undefined;

  const compile = (rescan: boolean): void => {
    // A document's vocabulary comes from the project's TypeScript, so a change there can change
    // what a document means — but scanning is the expensive half, so it only happens when the
    // TypeScript actually changed.
    if (rescan) model = undefined;
    const result = build({
      root,
      tsconfig,
      ...(options.modules ? { modules: options.modules } : {}),
      ...(model ? { model } : {}),
    });
    model = result.model;
    if (result.diagnostics.length > 0) {
      throw new Error(
        `[scenoco] ${result.diagnostics.length} problem(s) in this project's documents:\n` +
          result.diagnostics.map((d) => formatDiagnostic(d)).join('\n'),
      );
    }
  };

  return {
    name: 'scenoco',

    config(config) {
      return {
        // One `three` in the graph, always. A tag package brings its own three-based
        // dependencies, and `instanceof` across two copies of three silently returns false —
        // the standard three-ecosystem safeguard, and the kind of bug that costs a day.
        resolve: { dedupe: ['three'] },
        // A scene bug otherwise surfaces as a crash on one minified line with two-letter names
        // and no way back to the document. A project's own config still wins.
        build: { sourcemap: config.build?.sourcemap ?? true },
      };
    },

    configResolved(config) {
      root = resolve(options.root ?? config.root);
      tsconfig = options.tsconfig ?? resolve(root, 'tsconfig.json');
    },

    /**
     * Before Vite resolves a single import.
     *
     * `import { Breakout } from './breakout.scene.gen.js'` has to find a file, so the documents
     * are compiled here rather than lazily: a missing generated file would surface as an
     * unresolved import naming a path nobody wrote, instead of the diagnostic that explains it.
     */
    buildStart() {
      compile(true);
    },

    configureServer(server) {
      watch(server, root, compile);
    },
  };
}

/**
 * Recompile while you edit.
 *
 * XML files are not in Vite's module graph — nothing imports them — so the watcher has to be told
 * about them. The generated files *are*, and `build` only rewrites one whose content actually
 * changed, so an edit that changes nothing does not restart the HMR graph for nothing.
 */
function watch(server: ViteDevServer, root: string, compile: (rescan: boolean) => void): void {
  // The **directory**, not a glob. chokidar 4 dropped glob support, so `add('<root>/**/*.xml')`
  // registers a literal path with asterisks in it and watches nothing — which looks like it
  // works, because Vite already watches the root for its own reasons, right up until a document
  // lands in a directory that did not exist when the server started. Then that file is compiled
  // once at startup and never again, and you are editing a document with no effect.
  server.watcher.add(root);

  let queued: NodeJS.Timeout | undefined;
  let rescan = false;

  const changed = (path: string): void => {
    const isDocument = path.endsWith('.xml');
    const isSource = path.endsWith('.ts') && !path.endsWith('.gen.ts');
    if (!isDocument && !isSource) return;
    rescan ||= isSource;

    // Saving a file often lands as several events, and a scan is the expensive part — so the
    // work is done once the writes have stopped rather than once per event.
    clearTimeout(queued);
    queued = setTimeout(() => {
      try {
        compile(rescan);
        rescan = false;
      } catch (error) {
        // Reported to the browser overlay rather than thrown: a typo in a document must not take
        // the dev server down, and the next save should fix it in place.
        server.ws.send({
          type: 'error',
          err: { message: error instanceof Error ? error.message : String(error), stack: '' },
        });
        console.error(error instanceof Error ? error.message : String(error));
      }
    }, 40);
  };

  server.watcher.on('change', changed);
  server.watcher.on('add', changed);
  server.watcher.on('unlink', changed);
}

// TC39 standard-decorator lowering for game code (oxc cannot do it). `@serializeField` is the
// only decorator left, but a project using it needs this.
export { standardDecorators } from './decorators.js';
