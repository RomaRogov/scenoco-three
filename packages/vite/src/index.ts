import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  builtinNodeModule,
  bundlePrefab,
  bundleScene,
  compilePrefabXml,
  compileSceneXml,
  formatDiagnostic,
  loadComponents,
  type ResourceResolver,
} from '@scenoco-three/compiler';
import type { Plugin } from 'vite';

/**
 * Vite plugin: `import scene from './x.scene.xml?bundle'`.
 *
 * At build/serve time (in Node) the scene XML is validated and compiled into an
 * optimized SceNoCo bundle — the browser receives the bundle data plus imports
 * of **exactly the component modules the scene uses**, nothing else:
 *
 *   // generated module for x.scene.xml?bundle
 *   import '/abs/path/components/Rotator.ts';   // ← used by this scene
 *   import '/abs/path/components/Follow.ts';    // ← used by this scene
 *   export default [1, [...strings], [...asset]];
 *
 * So loading a scene automatically registers its components in the runtime
 * Registry (decorator side effect), unused components are never shipped, and
 * no XML parser/validator/compiler reaches the browser.
 *
 * Component discovery is shared with the CLI (`loadComponents` in
 * @scenoco-three/compiler): files containing `@component({ name: '…' })` under
 * `componentRoots` are compiled and registered in the Node process so the
 * validator can check the scene, and the same scan maps each component name to
 * the file the browser must import.
 */
export interface BundlePluginOptions {
  /**
   * Directories (relative to the Vite project cwd) scanned for files declaring
   * `@component` / `@node` / … tags. Defaults to `['src']`.
   */
  componentRoots?: string[];
  /**
   * npm packages that register tags on import (e.g. `['@scenoco-three/rapier']`).
   * Their tags are validated like any other, and a scene that uses one imports
   * the package; scenes that don't, don't.
   */
  registerPackages?: string[];
}

export function bundlePlugin(options: BundlePluginOptions = {}): Plugin {
  const componentRoots = options.componentRoots ?? ['src'];
  const registerPackages = options.registerPackages ?? [];
  let isServe = false;

  return {
    name: 'scenoco:bundle',

    configResolved(config) {
      isServe = config.command === 'serve';
    },

    async load(id) {
      if (!id.endsWith('.xml?bundle')) return null;
      const file = id.slice(0, -'?bundle'.length);
      const xml = readFileSync(file, 'utf8');

      // Register project components in this Node process (validator needs the
      // full set for checks and "did you mean" suggestions) and get the
      // name → file map for the usage-based imports below.
      const scan = await loadComponents(componentRoots, undefined, { packages: registerPackages }).catch(
        (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          this.error(`failed to load tag modules from [${componentRoots.join(', ')}]: ${msg}`);
        },
      );

      // Recompile when any component file changes (a property change affects
      // validation and compiled output), not just when the XML changes.
      for (const componentFile of scan.files.keys()) this.addWatchFile(componentFile);

      // Track `src=` resource files (materials, future prefabs) the same way.
      const resolveAndWatch: ResourceResolver = (request, referrer) => {
        const resolved = fsResolver(request, referrer);
        if (resolved) this.addWatchFile(resolved.path);
        return resolved;
      };

      // `.prefab.xml` compiles to a standalone prefab bundle (for
      // `engine.instantiate`); any other XML is a scene.
      const isPrefab = file.endsWith('.prefab.xml');
      const result = isPrefab
        ? compilePrefabXml(xml, { path: file, resolve: resolveAndWatch })
        : compileSceneXml(xml, { path: file, resolve: resolveAndWatch });
      if (!result.ok) {
        const lines = result.diagnostics.map((d) => formatDiagnostic(d, file)).join('\n');
        this.error(`${isPrefab ? 'prefab' : 'scene'} failed to compile:\n${lines}`);
      }

      // Usage-based imports: only the modules that register the component types
      // and node/geometry/material/setting tags this scene/prefab actually uses.
      // A module is either a project file (absolute path → /@fs import) or a bare
      // package specifier (a tag package, or a @scenoco-three/core built-in
      // subpath). Unused tags (and their three classes) never ship.
      const projectFiles = new Set<string>(); // absolute paths
      const bareSpecifiers = new Set<string>(); // package specifiers
      const addModule = (mod: string | undefined) => {
        if (!mod) return;
        if (isAbsolute(mod)) projectFiles.add(mod);
        else bareSpecifiers.add(mod);
      };
      const addTag = (tag: string) => {
        const mod = scan.byTag.get(tag);
        if (mod) addModule(mod);
        else {
          const builtin = builtinNodeModule(tag);
          if (builtin) bareSpecifiers.add(builtin);
        }
      };
      // Walk the scene and every embedded prefab (referenced by `prefab` props):
      // a spawned prefab registers its own components/tags, so they must ship too.
      const collectModules = (scene: typeof result.scene): void => {
        for (const c of scene.components) addModule(scan.byName.get(c.type));
        for (const n of scene.nodes) addTag(n.tag);
        for (const a of scene.attachments) addTag(a.tag);
        for (const p of scene.prefabs ?? []) collectModules(p);
      };
      collectModules(result.scene);

      const imports = [
        ...[...projectFiles].map((f) => `import ${JSON.stringify(asImportSpecifier(f, isServe))};`),
        ...[...bareSpecifiers].map((spec) => `import ${JSON.stringify(spec)};`),
      ].join('\n');

      const bundle = isPrefab ? bundlePrefab(result.scene) : bundleScene(result.scene);
      return `${imports}\nexport default ${JSON.stringify(bundle)};`;
    },
  };
}

/**
 * Dev server needs the `/@fs/` protocol for absolute paths that may live
 * outside the Vite root; the production build resolves plain absolute paths.
 */
function asImportSpecifier(filePath: string, isServe: boolean): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (!isServe) return normalized;
  return normalized.startsWith('/') ? `/@fs${normalized}` : `/@fs/${normalized}`;
}

const fsResolver: ResourceResolver = (request, referrer) => {
  const path = resolve(referrer ? dirname(referrer) : '.', request);
  return existsSync(path) ? { path, contents: readFileSync(path, 'utf8') } : null;
};
