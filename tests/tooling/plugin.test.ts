import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Component, Registry, attachmentTags, component, nodeTags, property, ValueType } from '@scenoco-three/core';
import {
  builtinNodeModule,
  builtinNodeModules,
  compileSceneXml,
  componentLoadError,
  detectTagPackages,
  loadComponents,
  scaffoldFiles,
  scanComponents,
} from '@scenoco-three/compiler';

// The scaffolded `Spin` component, mirrored here so the starter scene validates
// hermetically — same shape `scenoco init` writes to assets/components.
@component({ name: 'Spin', description: 'Spins the host node around its Y axis over time' })
class Spin extends Component {
  @property({ type: ValueType.Float, description: 'Rotation speed in radians per second' }) speed = 1;
}
void Spin;

describe('built-in node manifest (tree-shaking)', () => {
  it('has no drift vs the registry and ships only the built-in modules a scene uses', () => {
    // tests/setup.ts imports the barrel, so every built-in is registered here.
    expect(new Set(Object.keys(builtinNodeModules))).toEqual(new Set([...nodeTags(), ...attachmentTags()]));

    const r = compileSceneXml(`<Scene><Attachments><Fog /></Attachments><Mesh id="m"><Attachments><BoxGeometry /><MeshStandardMaterial /></Attachments></Mesh><SpotLight id="s" /></Scene>`);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    const specs = new Set<string>();
    for (const n of r.scene.nodes) { const s = builtinNodeModule(n.tag); if (s) specs.add(s); }
    for (const a of r.scene.attachments) { const s = builtinNodeModule(a.tag); if (s) specs.add(s); }
    expect(specs).toContain(builtinNodeModule('SpotLight'));
    expect(specs).toContain(builtinNodeModule('Fog'));
    for (const unused of ['SkinnedMesh', 'TorusGeometry', 'PointsMaterial', 'OrthographicCamera']) {
      expect(specs).not.toContain(builtinNodeModule(unused));
    }
  });
});

describe('zero-config tag registration', () => {
  it('detectTagPackages returns the @scenoco-three/* add-ons from package.json, minus the toolchain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenoco-detect-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { '@scenoco-three/core': '^0.2.0', '@scenoco-three/rapier': '^0.2.0', '@scenoco-three/audio': '^0.2.0', three: '^0.184.0' },
        devDependencies: { '@scenoco-three/compiler': '^0.2.0', '@scenoco-three/collision': '^0.2.0' },
      }),
    );
    expect(detectTagPackages(dir).sort()).toEqual(['@scenoco-three/audio', '@scenoco-three/collision', '@scenoco-three/rapier']);
    expect(detectTagPackages(mkdtempSync(join(tmpdir(), 'scenoco-empty-')))).toEqual([]);
  });

  // CORE-IMPROVEMENTS #6: a stand-alone @system(T) file (no co-located tag) must
  // still be shipped whenever <T> is used, mapped by the component it processes.
  it('maps a stand-alone @system(T) file under the component it processes', () => {
    const dir = fileURLToPath(new URL('../fixtures/system-discovery', import.meta.url));
    const scan = scanComponents([dir]);
    expect(scan.byComponentSystem.get('Enemy')).toContain(join(dir, 'EnemyAI.ts'));
    expect(scan.files.get(join(dir, 'EnemyAI.ts'))).toEqual([]); // the system file declares no tag of its own
  });

  // CORE-IMPROVEMENTS #5: a component importing a binary asset must still load
  // in Node (the component compiler runs esbuild) — before the fix it had no
  // .png loader and threw, though the Vite app build inlines the asset fine.
  it('loads a component that imports a .png without a loader error', async () => {
    const dir = fileURLToPath(new URL('../fixtures/components-assets', import.meta.url));
    await loadComponents([dir]);
    expect(Registry.getComponent('SpriteThing')).toBeDefined();
  });
});

describe('component last-good fallback', () => {
  // A corrupted component reload must not wipe the working registry — the host
  // (editor/watch server) keeps running on the last-good set and auto-recovers.
  it('keeps the working set when a reload is broken, reports it, and recovers on fix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenoco-lastgood-'));
    const file = join(dir, 'Widget.ts');
    const good = `import { Component, component, property, ValueType } from '@scenoco-three/core';
@component({ name: 'Widget', description: 'A test widget' })
export class Widget extends Component {
  @property({ type: ValueType.Float, description: 'A number' }) n = 1;
}`;
    const write = (contents: string, mtimeSecs: number): void => {
      writeFileSync(file, contents);
      const t = new Date(Date.now() + mtimeSecs * 1000); // distinct mtime → distinct load key
      utimesSync(file, t, t);
    };

    write(good, 1);
    await loadComponents([dir]);
    expect(Registry.getComponent('Widget')).toBeDefined();
    expect(componentLoadError()).toBeUndefined();

    write(`${good}\nthis is not valid typescript {{{`, 2); // syntax error
    await loadComponents([dir]);
    expect(Registry.getComponent('Widget')).toBeDefined(); // last-good stays live
    expect(componentLoadError()?.files).toContain(file);

    write(good, 3); // fix
    await loadComponents([dir]);
    expect(Registry.getComponent('Widget')).toBeDefined();
    expect(componentLoadError()).toBeUndefined(); // recovered
  });

  // A broken file added *alongside* a good set fails the reload (last-good stays),
  // but removing it returns the set to the exact key that last loaded cleanly. The
  // load-key short-circuit must then clear the now-stale error, not keep reporting it.
  it('clears a stale error when a broken file is removed and the set returns to a good key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenoco-recover-'));
    writeFileSync(
      join(dir, 'Gizmo.ts'),
      `import { Component, component } from '@scenoco-three/core';
@component({ name: 'Gizmo', description: 'A test gizmo' })
export class Gizmo extends Component {}`,
    );
    await loadComponents([dir]);
    expect(componentLoadError()).toBeUndefined();

    const broken = join(dir, 'Broken.ts');
    writeFileSync(
      broken,
      `import { Component, component } from '@scenoco-three/core';
@component({ name: 'BrokenGizmo', description: 'oops' })
export class BrokenGizmo extends Component {}
this is not valid typescript {{{`,
    );
    await loadComponents([dir]);
    expect(componentLoadError()?.files).toContain(broken); // reported while broken

    rmSync(broken); // remove → set returns to the exact good key
    await loadComponents([dir]);
    expect(componentLoadError()).toBeUndefined(); // stale error cleared (the fix)
  });
});

describe('scenoco init scaffold', () => {
  it('writes a runnable project skeleton whose starter scene validates against the starter component', () => {
    const files = scaffoldFiles('my-app');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['package.json', 'tsconfig.json', 'vite.config.ts', 'src/main.ts', 'assets/components/Spin.ts', 'assets/scenes/hello.scene.xml']),
    );
    expect(Object.keys(files).some((f) => f.endsWith('.md'))).toBe(false); // no markdown
    const pkg = JSON.parse(files['package.json']!) as { name: string; scripts: Record<string, string> };
    expect(pkg.name).toBe('my-app');
    expect(pkg.scripts.validate).not.toContain('--components'); // assets/ convention, zero-config
    expect(compileSceneXml(files['assets/scenes/hello.scene.xml']!).ok).toBe(true);
  });
});
