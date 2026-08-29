import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSET_KINDS, runCli, templateFor } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from '../compiler/fixture.js';

/**
 * The `scenoco` command, driven as the function the executable calls.
 *
 * Every command is a view over `build()` or over `ASSET_KINDS`; nothing here knows a document
 * format. So what is worth testing is that the views stay attached: a kind that exists is a kind
 * `new` can scaffold, and what it scaffolds is a document `build` accepts.
 */
let fixture: Fixture;
let out: string[];
let err: string[];

beforeEach(() => {
  // A real project has installed the packages whose documents it scaffolds.
  fixture = makeFixture('cli', { particles: true });
  fixture.write(
    'game.ts',
    `import { Component } from '@scenoco-three/core';
import { ParticleSystem } from '@scenoco-three/particles';

export class Spinner extends Component {
  speed = 1;
  readonly vfx = ParticleSystem;
}
`,
  );
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => void err.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  fixture.dispose();
});

const cli = (...args: string[]) => runCli([...args, '--root', fixture.dir]);

describe('scenoco new', () => {
  /**
   * The load-bearing case. A starter document that the compiler then rejects is worse than no
   * starter at all — it teaches the format wrong, and it is the first thing anyone runs.
   */
  it.each(ASSET_KINDS.map((k) => k.kind))('scaffolds a %s that compiles', async (kind) => {
    // The starters reference each other by convention — a prefab names a material and a cube
    // geometry — so the whole set is written and compiled together, which is also how a real
    // project starts.
    // The starters are written and compiled together, which is how a project starts anyway.
    for (const other of ASSET_KINDS) await cli('new', other.kind, 'cube');
    // A `.texture.xml` for `cube` expects `cube.png` beside it — the one thing a starter is
    // allowed to assume, because its own name says so.
    fixture.writeXml('assets/textures/cube.png', 'not really a png');

    expect(err.join('\n'), err.join('\n')).toBe('');
    expect(await cli('check', '--modules', 'three,@scenoco-three/particles'), err.join('\n')).toBe(0);

    const { path } = templateFor(kind, 'cube');
    expect(existsSync(join(fixture.dir, path))).toBe(true);
  }, 120_000);

  it('puts each kind in the directory its kind declares', async () => {
    await cli('new', 'scene', 'level1');
    expect(existsSync(join(fixture.dir, 'assets/scenes/level1.scene.xml'))).toBe(true);
  });

  it('refuses to overwrite work that is already there', async () => {
    expect(await cli('new', 'scene', 'level1')).toBe(0);
    expect(await cli('new', 'scene', 'level1')).toBe(1);
    expect(err.join('\n')).toContain('already exists');
  });

  /**
   * The primitives are the shapes a scene is built from, and the numbers on them are the
   * contract: a cube one unit on a side, a cylinder two tall as Unity's is. Anything that
   * writes them wrong makes every mesh that names one the wrong size.
   */
  it('writes the whole set of primitives, sized as Unity sizes them', async () => {
    expect(await cli('new', 'geometry')).toBe(0);
    const read = (name: string) =>
      readFileSync(join(fixture.dir, `assets/geometry/${name}.geometry.xml`), 'utf8');
    expect(read('cube')).toContain('<BoxGeometry width="1" height="1" depth="1" />');
    expect(read('sphere')).toContain('radius="0.5"');
    expect(read('cylinder')).toContain('height="2"');
    expect(read('plane')).toContain('<PlaneGeometry width="10" height="10" />');
    // Run twice, and it says so rather than failing on the files it already wrote.
    err.length = 0;
    expect(await cli('new', 'geometry')).toBe(0);
    expect(err.join('\n')).toBe('');
    expect(await cli('check', '--modules', 'three')).toBe(0);
  }, 120_000);

  it('lists the kinds when asked for one that is not', async () => {
    expect(await cli('new', 'shader', 'water')).toBe(1);
    expect(err.join('\n')).toContain('material');
  });
});

describe('scenoco build and check', () => {
  it('writes a module beside each document, and reports what it wrote', async () => {
    fixture.writeXml('assets/geometry/cube.geometry.xml', '<BoxGeometry width="1" height="1" depth="1" />');
    fixture.writeXml('assets/materials/plain.material.xml', '<MeshBasicMaterial color="#38bdf8" />');
    fixture.writeXml(
      'assets/scenes/level1.scene.xml',
      `<Scene>
  <Mesh geometry="../geometry/cube.geometry.xml" material="../materials/plain.material.xml">
    <Components><Spinner speed="2" /></Components>
  </Mesh>
</Scene>`,
    );

    expect(await cli('build')).toBe(0);
    expect(out.join('\n')).toMatch(/wrote 3 file\(s\)/);
    expect(readFileSync(join(fixture.dir, 'assets/scenes/level1.scene.gen.ts'), 'utf8')).toContain(
      'export class Level1Scene extends Scene',
    );
  }, 120_000);

  it('check writes nothing — it is the CI form', async () => {
    fixture.writeXml('assets/geometry/cube.geometry.xml', '<BoxGeometry width="1" />');
    expect(await cli('check')).toBe(0);
    expect(existsSync(join(fixture.dir, 'assets/geometry/cube.geometry.gen.ts'))).toBe(false);
  }, 120_000);

  it('fails with the file, line and message when a document is wrong', async () => {
    fixture.writeXml('assets/geometry/cube.geometry.xml', '<BoxGeometry width="wide" />');
    expect(await cli('build')).toBe(1);
    const message = err.join('\n');
    expect(message).toContain('cube.geometry.xml:1');
    expect(message).toContain('bad-number');
  }, 120_000);
});

describe('running it in the wrong place', () => {
  it('says a project is what it needs, not just that a file is missing', async () => {
    // The likeliest first run of all. "No TypeScript project at …" is true and useless.
    expect(await runCli(['build', '--root', '/tmp/scenoco-not-a-project'])).toBe(1);
    expect(err.join('\n')).toContain('no tsconfig.json');
    expect(err.join('\n')).toContain('--root');
  });
});

describe('scenoco help', () => {
  it('lists every kind, so the list never goes stale', async () => {
    expect(await runCli([])).toBe(0);
    for (const kind of ASSET_KINDS) expect(out.join('\n')).toContain(kind.kind);
  });

  it('names an unknown command rather than silently doing nothing', async () => {
    expect(await runCli(['bundle'])).toBe(1);
    expect(err.join('\n')).toContain('bundle');
  });
});
