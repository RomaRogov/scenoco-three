import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { bundlePrefab, bundleScene } from './dsl/bundle.js';
import { compilePrefabXml, compileSceneXml, type CompileOptions, type ResourceResolver } from './dsl/compile.js';
import type { SceDiagnostic } from './dsl/diagnostics.js';

export type WatchEvent =
  | { type: 'start'; file: string }
  | { type: 'success'; file: string; outputPath: string; durationMs: number }
  | { type: 'diagnostics'; file: string; diagnostics: SceDiagnostic[] }
  | { type: 'error'; file: string; message: string };

export interface WatchOptions {
  outDir?: string;
  resolve?: ResourceResolver;
  onEvent?: (event: WatchEvent) => void;
}

export interface WatchHandle {
  close(): Promise<void>;
}

/**
 * Watches scene XML files and writes updated outputs on every change.
 * Also follows `src=` dependencies discovered during compilation.
 */
export async function watchSceneFiles(entries: string[], options: WatchOptions = {}): Promise<WatchHandle> {
  const roots = entries.map((f) => resolve(f));
  const outDir = options.outDir ? resolve(options.outDir) : undefined;
  const onEvent = options.onEvent ?? (() => {});

  const depToRoots = new Map<string, Set<string>>();
  const rootToDeps = new Map<string, Set<string>>();
  let watcher: FSWatcher;

  const updateDeps = (rootFile: string, deps: Set<string>) => {
    const prev = rootToDeps.get(rootFile);
    if (prev) {
      for (const dep of prev) {
        const owners = depToRoots.get(dep);
        if (!owners) continue;
        owners.delete(rootFile);
        if (owners.size === 0) depToRoots.delete(dep);
      }
    }
    rootToDeps.set(rootFile, deps);
    for (const dep of deps) {
      const owners = depToRoots.get(dep) ?? new Set<string>();
      owners.add(rootFile);
      depToRoots.set(dep, owners);
    }
  };

  const compileOne = (file: string): void => {
    const start = Date.now();
    onEvent({ type: 'start', file });

    const deps = new Set<string>();
    const resolver = createTrackingResolver(file, deps, options.resolve);
    const isPrefab = file.endsWith('.prefab.xml');
    const compile = isPrefab ? compilePrefabXml : compileSceneXml;
    const result = compile(readFileSync(file, 'utf8'), {
      path: file,
      resolve: resolver,
    } satisfies CompileOptions);

    updateDeps(file, deps);
    watcher.add([...deps]);

    if (!result.ok) {
      onEvent({ type: 'diagnostics', file, diagnostics: result.diagnostics });
      return;
    }

    const outputPath = outputFileFor(file, outDir);
    const bundle = isPrefab ? bundlePrefab(result.scene) : bundleScene(result.scene);
    try {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(bundle));
    } catch (e: unknown) {
      onEvent({ type: 'error', file, message: e instanceof Error ? e.message : String(e) });
      return;
    }

    onEvent({ type: 'success', file, outputPath, durationMs: Date.now() - start });
  };

  watcher = chokidar.watch(roots, { ignoreInitial: false, awaitWriteFinish: true });

  const onChange = (changedPath: string): void => {
    const abs = resolve(changedPath);
    if (roots.includes(abs)) {
      compileOne(abs);
      return;
    }
    const dependents = depToRoots.get(abs);
    if (!dependents) return;
    for (const rootFile of dependents) compileOne(rootFile);
  };

  watcher.on('add', onChange);
  watcher.on('change', onChange);

  return {
    async close(): Promise<void> {
      await watcher.close();
    },
  };
}

function outputFileFor(file: string, outDir?: string): string {
  const baseName = `${file}.bundle.json`;
  if (!outDir) return baseName;
  const leaf = baseName.split('/').pop() ?? baseName;
  return resolve(outDir, leaf);
}

function createTrackingResolver(
  rootFile: string,
  deps: Set<string>,
  fallback?: ResourceResolver,
): ResourceResolver {
  return (request, referrer) => {
    if (fallback) {
      const resolved = fallback(request, referrer);
      if (resolved) deps.add(resolve(resolved.path));
      return resolved;
    }

    const target = resolve(referrer ? dirname(referrer) : dirname(rootFile), request);
    if (!existsSync(target)) return null;
    deps.add(target);
    return { path: target, contents: readFileSync(target, 'utf8') };
  };
}
