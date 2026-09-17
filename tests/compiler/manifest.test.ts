import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { documentKinds, readModuleManifests } from '../../packages/compiler/src/index.js';

/**
 * A module is a package with a `"scenoco"` block in its own `package.json`, and what it declares
 * there — its document kinds, the files it loads — is read straight off disk, before any
 * TypeScript is opened. That ordering is the reason it lives in the manifest at all: which files
 * in a project are even documents has to be answerable without a checker.
 */

let scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

/** A project whose `node_modules` holds the given packages, each as its own manifest. */
function project(
  dependencies: Record<string, Record<string, unknown> | null>,
  options: { nest?: number } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'scenoco-manifest-'));
  scratch.push(root);
  // The store sits `nest` directories *above* the project, as a workspace's does: an example here
  // has no `node_modules` of its own and resolves in the repository root's.
  const store = join(root, 'node_modules');
  const dir = options.nest ? join(root, ...Array<string>(options.nest).fill('inner')) : root;
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ dependencies: Object.fromEntries(Object.keys(dependencies).map((n) => [n, '*'])) }),
  );
  for (const [name, block] of Object.entries(dependencies)) {
    if (block === null) continue; // declared, never installed
    const home = mkdtempSync(join(tmpdir(), 'scenoco-package-'));
    scratch.push(home);
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...(block ? { scenoco: block } : {}) }));
    mkdirSync(join(store, ...name.split('/').slice(0, -1)), { recursive: true });
    // A link, because that is what a workspace install is, and the path a `template` resolves
    // against has to come out the same either way.
    symlinkSync(home, join(store, name), 'dir');
  }
  return dir;
}

const fx = { documents: [{ extension: '.fx.xml', type: 'Effect' }] };

describe('reading a project’s modules', () => {
  it('finds a package linked into a node_modules several directories up', () => {
    const dir = project({ '@acme/fx': fx }, { nest: 3 });
    const [module] = readModuleManifests(dir).modules;
    expect(module?.name).toBe('@acme/fx');
    expect(module?.documents[0]?.kind).toBe('fx');
  });

  it('passes over a dependency that declares nothing — a module is one that says so', () => {
    const dir = project({ '@acme/fx': fx, three: {}, lodash: null, vite: undefined as never });
    expect(readModuleManifests(dir).modules.map((m) => m.name)).toEqual(['@acme/fx', 'three']);
  });

  it('reports a dependency that is not installed rather than refusing to compile', () => {
    const dir = project({ '@acme/fx': fx, '@acme/gone': null });
    const { modules, missing } = readModuleManifests(dir);
    expect(modules.map((m) => m.name)).toEqual(['@acme/fx']);
    expect(missing).toEqual(['@acme/gone']);
  });

  it('is empty rather than an error when there is no manifest to read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenoco-bare-'));
    scratch.push(dir);
    expect(readModuleManifests(dir).modules).toEqual([]);
  });
});

describe('what a module may claim', () => {
  it('offers its kinds alongside the builtins, named by the extension', () => {
    const dir = project({ '@acme/fx': fx });
    const kinds = documentKinds(dir);
    expect(kinds.map((k) => k.kind)).toEqual(['texture', 'asset', 'render', 'prefab', 'scene', 'fx']);
    expect(kinds.at(-1)).toMatchObject({ extension: '.fx.xml', type: 'Effect', dir: 'assets/fx' });
  });

  it('refuses two packages claiming one kind, naming both', () => {
    const dir = project({ '@acme/fx': fx, '@other/fx': { documents: [{ extension: '.fx.xml', type: 'Other' }] } });
    expect(() => readModuleManifests(dir)).toThrow(/"@acme\/fx".*"@other\/fx"|"@other\/fx".*"@acme\/fx"/s);
  });

  it('refuses a kind that would shadow one of the compiler’s own', () => {
    const dir = project({ '@acme/fx': { documents: [{ extension: '.scene.xml', type: 'Thing' }] } });
    expect(() => readModuleManifests(dir)).toThrow(/scene/);
  });

  it('says which field is missing, and which package left it out', () => {
    const dir = project({ '@acme/fx': { documents: [{ extension: '.fx.xml' }] } });
    expect(() => readModuleManifests(dir)).toThrow(/"@acme\/fx".*documents\[0\]\.type/s);
  });

  it('refuses an extension that is not a document suffix', () => {
    const dir = project({ '@acme/fx': { documents: [{ extension: 'fx', type: 'Effect' }] } });
    expect(() => readModuleManifests(dir)).toThrow(/\.<kind>\.xml/);
  });

  it('fills in the module name for a file helper, so it cannot be said wrong', () => {
    const dir = project({
      '@acme/sound': { files: [{ extensions: ['.WAV'], helper: 'sharedNoise', suffix: 'Noise', await: true }] },
    });
    const [module] = readModuleManifests(dir).modules;
    expect(module?.files[0]).toEqual({
      extensions: ['wav'],
      helper: { module: '@acme/sound', name: 'sharedNoise' },
      suffix: 'Noise',
      await: true,
    });
  });
});
