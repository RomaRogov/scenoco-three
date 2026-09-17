import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_KINDS, documentKinds, runCli, templateFor } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from '../compiler/fixture.js';

/**
 * The `scenoco` command, driven as the function the executable calls.
 *
 * Every command is a view over `build()` or over the project's document kinds; nothing here knows
 * a document format. So what is worth testing is that the views stay attached: a kind that exists
 * — the compiler's own, or one a package declared — is a kind `new` can scaffold, and what it
 * scaffolds is a document `build` accepts.
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
  // Collected before any fixture exists, so the sweep is over the builtins; the kind a package
  // declares gets its own test below, where a project is there to read it from.
  it.each(BUILTIN_KINDS.map((k) => k.kind))('scaffolds a %s that compiles', async (kind) => {
    // The starters reference each other by convention — a prefab names a material and a cube
    // geometry — so the whole set is written and compiled together, which is also how a real
    // project starts.
    // The starters are written and compiled together, which is how a project starts anyway.
    for (const other of documentKinds(fixture.dir)) await cli('new', other.kind, 'cube');
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
    expect(await cli('new', 'asset')).toBe(0);
    const read = (name: string) =>
      readFileSync(join(fixture.dir, `assets/${name}.asset.xml`), 'utf8');
    expect(read('cube')).toContain('<BoxGeometry width="1" height="1" depth="1" />');
    expect(read('sphere')).toContain('radius="0.5"');
    expect(read('cylinder')).toContain('height="2"');
    expect(read('plane')).toContain('<PlaneGeometry width="10" height="10" />');
    // Run twice, and it says so rather than failing on the files it already wrote.
    err.length = 0;
    expect(await cli('new', 'asset')).toBe(0);
    expect(err.join('\n')).toBe('');
    expect(await cli('check', '--modules', 'three')).toBe(0);
  }, 120_000);

  /**
   * The whole point of the arrangement: `particle` is not a kind the compiler knows. It is in
   * this project because `@scenoco-three/particles` is installed and says so, and the starter
   * written here is the file that package ships.
   */
  it('scaffolds a kind a package declared, from that package’s own starter', async () => {
    expect(await cli('new', 'particle', 'sparks')).toBe(0);
    const written = readFileSync(join(fixture.dir, 'assets/vfx/sparks.particle.xml'), 'utf8');
    expect(written).toContain('<ParticleEffect');
    // The starter names the file it is writing, so the name has to reach it.
    expect(written).toContain('sparks.particle.xml');
    expect(written).not.toContain('{{name}}');
  });

  it('names the package when its starter is not in the installed copy', () => {
    const kinds = documentKinds(fixture.dir).map((kind) =>
      kind.kind === 'particle' ? { ...kind, template: './templates/gone.xml' } : kind,
    );
    const { contents, problem } = templateFor('particle', 'sparks', undefined, kinds);
    expect(contents).toBeUndefined();
    expect(problem).toContain('@scenoco-three/particles');
    expect(problem).toContain('<ParticleEffect>');
  });

  it('lists the kinds when asked for one that is not', async () => {
    expect(await cli('new', 'shader', 'water')).toBe(1);
    expect(err.join('\n')).toContain('asset');
  });
});

describe('scenoco build and check', () => {
  it('writes a module beside each document, and reports what it wrote', async () => {
    fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" height="1" depth="1" />');
    fixture.writeXml('assets/materials/plain.asset.xml', '<MeshBasicMaterial color="#38bdf8" />');
    fixture.writeXml(
      'assets/scenes/level1.scene.xml',
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml" material="../materials/plain.asset.xml">
    <Components><Spinner speed="2" /></Components>
  </Mesh>
</Scene>`,
    );

    expect(await cli('build')).toBe(0);
    // Three modules, the model the editor reads, and the preview the particles package declares
    // — a project that installs a module gets what that module says its components look like.
    expect(out.join('\n')).toMatch(/wrote 5 file\(s\)/);
    expect(existsSync(join(fixture.dir, '.scenoco/previews/ParticleSystem.js'))).toBe(true);
    expect(readFileSync(join(fixture.dir, '.scenoco/model.json'), 'utf8')).toContain('"Spinner"');
    expect(readFileSync(join(fixture.dir, 'assets/scenes/level1.scene.gen.ts'), 'utf8')).toContain(
      'export class Level1Scene extends Scene',
    );
  }, 120_000);

  it('check writes nothing — it is the CI form', async () => {
    fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" />');
    expect(await cli('check')).toBe(0);
    expect(existsSync(join(fixture.dir, 'assets/geometry/cube.asset.gen.ts'))).toBe(false);
  }, 120_000);

  it('fails with the file, line and message when a document is wrong', async () => {
    fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="wide" />');
    expect(await cli('build')).toBe(1);
    const message = err.join('\n');
    expect(message).toContain('cube.asset.xml:1');
    expect(message).toContain('bad-number');
  }, 120_000);
});

/**
 * `describe` exists because the vocabulary had no query, and an author with no query guesses.
 * Each case here is one measured wrong turn from the benchmark, so a regression in any of them
 * is a regression in the thing the command was added for.
 */
describe('scenoco describe', () => {
  it('answers for a class the project cannot read, because it lives in a package', async () => {
    // The original failure: asked for a vignette, a model searched the project for `Vignette`,
    // found nothing, and spent twelve steps looking. Grep cannot reach into node_modules.
    expect(await cli('describe', 'ParticleSystem')).toBe(0);
    // `playOnAwake` is declared inside the package, so no grep over the project would find it.
    expect(out.join('\n')).toContain('playOnAwake');
  }, 120_000);

  it('answers for a runtime API, which no document mentions and no scan can see', async () => {
    // The measured failure: asked to build a game, a model wrote
    // `window.addEventListener('keydown')` — and so opted out of the frame-sampled input the
    // editor drives, losing the ability to simulate its own game. `describe Input` had said
    // "nothing here is called Input", so there was nowhere for it to find out otherwise.
    expect(await cli('describe', 'Input')).toBe(0);
    const answer = out.join('\n');
    expect(answer).toContain('getKey');
    expect(answer).toContain('KeyCode');
    // The warning is the point: naming the API without saying why not to use DOM events leaves
    // the reader with two plausible options and no reason to prefer this one.
    expect(answer).toContain('window.addEventListener');
  }, 120_000);

  it('lets a scanned component outrank the hand-written runtime note of the same name', async () => {
    // `Animator` is both a shipped component and a thing worth a sentence of orientation. The
    // scan knows its real fields; a hand-written line would have shadowed the better answer with
    // a worse one, which is what happened the first time this was wired up.
    expect(await cli('describe', 'Animator')).toBe(0);
    const answer = out.join('\n');
    expect(answer).toContain('component');
    expect(answer).toContain('clip');
  }, 120_000);

  it('explains how the pieces fit together, for a reader who has never seen this', async () => {
    expect(await cli('describe')).toBe(0);
    const answer = out.join('\n');
    expect(answer).toContain('How this fits together');
    // The four ideas a reader would otherwise guess wrong.
    expect(answer).toContain('public field');
    expect(answer).toContain("Unity's");
    expect(answer).toContain('sampled once a frame');
    expect(answer).toContain('One spelling per value');
  }, 120_000);

  it('answers for Component and System, the two words the model is built from', async () => {
    expect(await cli('describe', 'Component')).toBe(0);
    const component = out.join('\n');
    expect(component).toContain('MonoBehaviour');
    for (const hook of ['awake()', 'start()', 'update(dt)', 'lateUpdate(dt)', 'onDestroy()']) {
      expect(component).toContain(hook);
    }
    expect(component).toContain('getComponent(Type)');
    expect(component).toContain('!: PrefabType');

    out.length = 0;
    expect(await cli('describe', 'System')).toBe(0);
    expect(out.join('\n')).toContain('requireSystem');
  }, 120_000);

  /**
   * The declarations are the answer, so nothing about the framework has to be read from a file.
   * An agent with only the primer went to node_modules for `Component.d.ts`; this is what it
   * went for.
   */
  it('answers with the real API, read off the declarations', async () => {
    expect(await cli('describe', 'Object3D')).toBe(0);
    const node = out.join('\n');
    expect(node).toContain('addComponent');
    expect(node).toContain('instantiate');
    // three's own members are documented on three's site; only what core adds belongs here.
    expect(node).not.toContain('traverse(');

    out.length = 0;
    expect(await cli('describe', 'Scene')).toBe(0);
    expect(out.join('\n')).toContain('byId');

    out.length = 0;
    expect(await cli('describe', 'SceneManager')).toBe(0);
    expect(out.join('\n')).toMatch(/load\(/);

    out.length = 0;
    expect(await cli('describe', 'Component')).toBe(0);
    const component = out.join('\n');
    expect(component).toContain('MonoBehaviour'); // the primer stays
    expect(component).toMatch(/getComponent<T extends Component>/); // and the declaration joins it
    expect(component).toMatch(/update\?\(deltaTime: number\)/);
  }, 120_000);

  it('lists the runtime APIs in the overview, the only place they are announced', async () => {
    expect(await cli('describe')).toBe(0);
    const answer = out.join('\n');
    expect(answer).toContain('runtime, for components:');
    expect(answer).toContain('Input');
    expect(answer).toContain('Coroutine');
  }, 120_000);

  it('names a component\'s fields with their types and defaults', async () => {
    expect(await cli('describe', 'Spinner')).toBe(0);
    expect(out.join('\n')).toMatch(/speed\s+number\s*=\s*1/);
  }, 120_000);

  it('lists what a spawn may override in a prefab, which is otherwise unaskable', async () => {
    // An override is invisible in the thing being overridden: nothing in a prefab says "this is
    // adjustable", so a model hunting for where a value is set searched for a file that does not
    // exist and gave up without an edit.
    fixture.writeXml(
      'assets/scenes/arena.prefab.xml',
      `<Group>
  <Mesh id="paddle"><Components><Spinner id="spin" speed="3" /></Components></Mesh>
</Group>`,
    );
    expect(await cli('describe', 'arena.prefab.xml')).toBe(0);
    const answer = out.join('\n');
    expect(answer).toContain('#paddle');
    expect(answer).toContain('#spin');
    expect(answer).toContain('(a component)');
  }, 120_000);

  it('answers a shape with the geometry document and its real numbers', async () => {
    // Every engine has a <Cube>, so every author expects one. Answering with the document *and*
    // its dimensions is what puts the mesh's size in front of whoever is about to write `scale`.
    fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" height="1" depth="1" />');
    expect(await cli('describe', 'Cube')).toBe(0);
    const answer = out.join('\n');
    expect(answer).toContain('there is no <Cube> tag');
    expect(answer).toContain('cube.asset.xml');
    expect(answer).toContain('width="1"');
  }, 120_000);

  it('answers a typo the way a diagnostic does', async () => {
    expect(await cli('describe', 'Spinnr')).toBe(0);
    expect(out.join('\n')).toContain('Did you mean "Spinner"?');
  }, 120_000);

  it('lists the whole vocabulary when asked for nothing', async () => {
    expect(await cli('describe')).toBe(0);
    const answer = out.join('\n');
    expect(answer).toContain('Spinner');
    expect(answer).toContain('three.js classes');
    // The grammar elements have no class behind them, so nothing else can report them.
    expect(answer).toContain('Override');
  }, 120_000);

  it('writes nothing — asking a question is not a build', async () => {
    fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" />');
    expect(await cli('describe', 'Spinner')).toBe(0);
    expect(existsSync(join(fixture.dir, 'assets/geometry/cube.asset.gen.ts'))).toBe(false);
  }, 120_000);
});

/**
 * `scenoco init` — the first thing anyone runs.
 *
 * It lives in the compiler rather than in a `create-scenoco` package because it is the same view
 * over the same templates that `new` is, one level up, and because a separate package would need
 * its own copy of `PRIMITIVES` to avoid depending on this one.
 */
describe('scenoco init', () => {
  /**
   * The load-bearing case, and the reason the starter is not deliberately broken: a scaffold the
   * compiler then rejects teaches the format wrong, and it is the first thing anyone runs.
   */
  it('writes a project whose documents compile', async () => {
    const target = join(fixture.dir, 'scaffolded');
    expect(await runCli(['init', target])).toBe(0);

    // Moved into the fixture, which resolves the packages through tsconfig `paths` the way a real
    // install resolves them through node_modules. The fixture declares a `Spinner` of its own, so
    // it is emptied first: two classes cannot answer to one tag, and the compiler says so. The
    // components keep their file names, because they import each other.
    // The package this project depends on still has to be imported somewhere, exactly as the
    // scaffold's own `src/tags.ts` does it.
    fixture.write('game.ts', `import '@scenoco-three/particles';\n`);
    for (const file of readdirSync(join(target, 'src'))) {
      if (file === 'main.ts' || file === 'tags.ts') continue;
      fixture.write(file, readFileSync(join(target, 'src', file), 'utf8'));
    }
    for (const dir of ['scenes', 'prefabs', 'geometry', 'materials']) {
      for (const file of readdirSync(join(target, 'assets', dir))) {
        fixture.writeXml(`assets/${dir}/${file}`, readFileSync(join(target, 'assets', dir, file), 'utf8'));
      }
    }

    expect(await cli('build')).toBe(0);
    expect(existsSync(join(fixture.dir, 'assets/scenes/main.scene.gen.ts'))).toBe(true);
    expect(existsSync(join(fixture.dir, 'assets/prefabs/crate.prefab.gen.ts'))).toBe(true);
    expect(existsSync(join(fixture.dir, 'assets/geometry/cube.asset.gen.ts'))).toBe(true);
  }, 120_000);

  /**
   * The starter is the specification: a reader reproduces what it reads, not what it could have
   * asked for, so every core verb has to be in it. Pinned by name so removing one is a decision.
   */
  it('shows every core verb once, and ships the model in a page', async () => {
    const target = join(fixture.dir, 'complete');
    expect(await runCli(['init', target])).toBe(0);
    const src = readdirSync(join(target, 'src'))
      .map((file) => readFileSync(join(target, 'src', file), 'utf8'))
      .join('\n');
    for (const verb of [
      'Input.getAxis',
      'Input.getKeyDown',
      'update(dt',
      'lateUpdate(dt',
      'instantiate(',
      'getComponent(',
      '!: Object3D',
      '!: PrefabType',
      'get dropped()',
    ]) {
      expect(src).toContain(verb);
    }
    const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('MonoBehaviour');
    expect(agents).toContain('setTimeout');
    expect(readFileSync(join(target, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  });

  it('names the project after its directory', async () => {
    const target = join(fixture.dir, 'my-game');
    expect(await runCli(['init', target])).toBe(0);
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name).toBe('my-game');
  });

  /**
   * A fresh project has no `.gen.ts`, so nothing imports `three` and the compiler has no
   * vocabulary — `scenoco check` exits 1 on a brand-new project without this file. Found by
   * installing a scaffolded project from the registry and running it.
   */
  it('ships a tags file, without which a fresh project has no vocabulary', async () => {
    const target = join(fixture.dir, 'tagged');
    expect(await runCli(['init', target])).toBe(0);
    expect(readFileSync(join(target, 'src/tags.ts'), 'utf8')).toContain("import 'three';");
  });

  /** `tsc` reads the generated modules, and they do not exist until something has built them. */
  it('checks by building first, because tsc has nothing to read otherwise', async () => {
    const target = join(fixture.dir, 'checked');
    expect(await runCli(['init', target])).toBe(0);
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(manifest.scripts.check).toBe('scenoco build && tsc --noEmit');
  });

  it('invites the reader to break it, and names the command that answers', async () => {
    const target = join(fixture.dir, 'invite');
    expect(await runCli(['init', target])).toBe(0);
    const scene = readFileSync(join(target, 'assets/scenes/main.scene.xml'), 'utf8');
    expect(scene).toContain('Try this');
    expect(scene).toContain('scenoco check');
    // The value it tells them to break has to be the one that is actually there.
    expect(scene).toContain('speed="6"');
  });

  it('refuses a directory that already has something in it', async () => {
    expect(await runCli(['init', fixture.dir])).toBe(1);
    expect(err.join('\n')).toContain('not empty');
  });
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
    for (const kind of BUILTIN_KINDS) expect(out.join('\n')).toContain(kind.kind);
  });

  it('names an unknown command rather than silently doing nothing', async () => {
    expect(await runCli(['bundle'])).toBe(1);
    expect(err.join('\n')).toContain('bundle');
  });
});
