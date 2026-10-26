#!/usr/bin/env node
/**
 * The packages as npm will hand them out, installed where nothing of this workspace can reach.
 *
 * Every test in this repository imports the sources, and every agent run resolved the packages
 * through a symlink into the workspace — so neither has ever seen what a user gets. That gap has
 * shipped a broken release before: `core@0.5.0` went out with a `sideEffects` list that let a
 * bundler drop half of it, and nothing here noticed, because no bundler ever met the package.
 *
 * So: `npm pack` every package and, in the system temp directory, walk the path a user walks —
 *
 *   1. `npm create @scenoco-three`, from the packed starter: install, check, build, and the built
 *      page run in Chrome;
 *   2. a copy of the breakout example on the packed packages: install, `npm run check` (tsc, and
 *      `scenoco check`: a scene only declares), build, and the built page playing a round;
 *   3. the observer: `observe(page)` reading the game on its dev server.
 *
 * Along the way: every `@scenoco-three` package is installed once, from its tarball — a second
 * copy of core means two `Behaviour` classes and a silently broken `instanceof`.
 *
 *   node scripts/pack-smoke.mjs [--keep]
 *
 * Needs the packages built (`npm run build`) and Google Chrome installed. `--keep` leaves the
 * project behind and prints where it is.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'scenoco-pack-'));
const tarballs = join(work, 'tarballs');
const app = join(work, 'app');
mkdirSync(tarballs);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd, quiet = true) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
const step = (what) => console.log(`\n▸ ${what}`);
const fail = (message) => {
  throw new Error(message);
};

try {
  // --- 1. pack ------------------------------------------------------------------------------
  step('packing every published package');
  const packed = new Map(); // name → absolute tarball path
  for (const dir of readdirSync(join(repo, 'packages'))) {
    const root = join(repo, 'packages', dir);
    if (!existsSync(join(root, 'package.json'))) continue;
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (manifest.private) continue;
    const [info] = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', tarballs], root));
    // A cache or an install left in a package folder ships with it: create@0.7.0 carried 5 MB of Vite's.
    const stray = info.files.find((f) => f.path.includes('node_modules/'));
    if (stray) fail(`${manifest.name} would publish ${stray.path} — exclude it in "files"`);
    packed.set(manifest.name, join(tarballs, info.filename));
    console.log(`  ${manifest.name}@${manifest.version}  ${info.files.length} files`);
  }
  const tarball = (name) => packed.get(name) ?? fail(`${name} was not packed`);

  // --- 2. the starter, as `npm create` makes it -----------------------------------------------
  step('npm create @scenoco-three, from the packed starter');
  const bootstrap = join(work, 'bootstrap');
  mkdirSync(bootstrap);
  writeFileSync(join(bootstrap, 'package.json'), JSON.stringify({ name: 'bootstrap', private: true }));
  run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', tarball('@scenoco-three/create')], bootstrap);
  const starter = join(work, 'starter');
  run(process.execPath, [join(bootstrap, 'node_modules', '@scenoco-three', 'create', 'index.js'), starter], work);
  const starterManifest = JSON.parse(readFileSync(join(starter, 'package.json'), 'utf8'));
  for (const deps of [starterManifest.dependencies, starterManifest.devDependencies]) {
    for (const name of Object.keys(deps)) if (packed.has(name)) deps[name] = `file:${tarball(name)}`;
  }
  writeFileSync(join(starter, 'package.json'), `${JSON.stringify(starterManifest, null, 2)}\n`);
  run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], starter, false);
  run(npm, ['run', 'check'], starter, false);
  run(npm, ['run', 'build'], starter, false);
  await runBuiltPage(join(starter, 'dist'), async (page) => {
    await page.waitForFunction(() => (document.querySelector('canvas')?.width ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.keyboard.press('Space');
    await new Promise((done) => setTimeout(done, 500));
    console.log('  the starter runs, and drops a crate without an error');
  });

  // --- 3. a game, as a user has one ----------------------------------------------------------
  step('breakout, copied out of the workspace, on the packed packages');
  const example = join(repo, 'examples', 'breakout');
  mkdirSync(app);
  for (const entry of ['src', 'index.html', 'vite.config.ts']) cpSync(join(example, entry), join(app, entry), { recursive: true });
  // Standalone: the example's own tsconfig extends the workspace's.
  writeFileSync(
    join(app, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noImplicitOverride: true,
          skipLibCheck: true, noEmit: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['vite/client'],
          jsx: 'react-jsx', jsxImportSource: '@scenoco-three/core',
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
  );
  const exampleManifest = JSON.parse(readFileSync(join(example, 'package.json'), 'utf8'));
  const workspace = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const appManifest = {
    name: 'packed-breakout',
    private: true,
    type: 'module',
    scripts: exampleManifest.scripts,
    dependencies: { ...exampleManifest.dependencies, three: workspace.devDependencies.three },
    devDependencies: {
      ...exampleManifest.devDependencies,
      '@scenoco-three/observer': '*',
      '@types/three': workspace.devDependencies['@types/three'],
      typescript: workspace.devDependencies.typescript,
      vite: workspace.devDependencies.vite,
    },
  };
  // Every `@scenoco-three` dependency points at its tarball; nothing else changes, so npm
  // resolves the rest — three, vite, typescript — the way it will for a user.
  for (const deps of [appManifest.dependencies, appManifest.devDependencies]) {
    for (const name of Object.keys(deps)) if (packed.has(name)) deps[name] = `file:${tarball(name)}`;
  }
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(appManifest, null, 2)}\n`);

  step('npm install, then npm run check');
  run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], app, false);
  run(npm, ['run', 'check'], app, false);

  // --- 4. one copy of each, from its tarball ---------------------------------------------------
  step('every @scenoco-three package installed once, from its tarball');
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
  const copies = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const match = /node_modules\/(@scenoco-three\/[^/]+)$/.exec(path);
    if (!match) continue;
    copies.set(match[1], [...(copies.get(match[1]) ?? []), { path, resolved: entry.resolved ?? '' }]);
  }
  for (const [name, found] of copies) {
    if (found.length > 1) fail(`${name} is installed ${found.length} times: ${found.map((f) => f.path).join(', ')}`);
    if (!found[0].resolved.startsWith('file:')) fail(`${name} came from ${found[0].resolved}, not from its tarball`);
    console.log(`  ${name}  once, ${found[0].resolved.replace(/^.*\//, '')}`);
  }

  // --- 5. the production build, run --------------------------------------------------------------
  step('npm run build, and the built page in Chrome');
  run(npm, ['run', 'build'], app, false);
  await runBuiltPage(join(app, 'dist'), async (page) => {
    await page.waitForFunction(() => document.getElementById('level')?.textContent?.includes('NEON GRID'), undefined, { timeout: 30_000 });
    console.log('  the game runs: the first level is loaded and the HUD reports it');
    // A real round: launch, and wait for the ball to break a brick against the wall.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.getElementById('score')?.textContent !== '00000', undefined, { timeout: 30_000 });
    console.log('  a launched ball breaks a brick, and the score shows it');
  });

  // --- 6. the observer, as a test uses it -----------------------------------------------------------
  step('observe(page) on the dev server');
  await runObserver(app);

  console.log(`\n✓ packed install works end to end${keep ? `\n  project kept at ${app}` : ''}`);
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  if (error?.stdout) console.error(String(error.stdout).slice(-4000));
  if (error?.stderr) console.error(String(error.stderr).slice(-4000));
  console.error(`  project left at ${app}`);
  process.exitCode = 1;
} finally {
  if (keep || process.exitCode) {
    // Kept for a look; the system cleans its temp directory.
  } else {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Chrome on the GPU, from this workspace's driver: it is the thing doing the looking, not the thing under test. */
async function launchChrome() {
  const { chromium } = await import(join(repo, 'node_modules', 'playwright-core', 'index.mjs'));
  return chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--enable-unsafe-swiftshader'])],
  });
}

/** Serve `dist`, open it in Chrome, run `play` on the page, and hear every error. */
async function runBuiltPage(dist, play) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
  const server = createServer((req, res) => {
    const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
    if (!file.startsWith(dist) || !existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, done));
  const url = `http://localhost:${server.address().port}/`;

  const browser = await launchChrome();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    page.on('pageerror', (error) => errors.push(String(error)));
    // A console "404" names no URL, so failed requests are read off the network instead. The
    // favicon is the browser asking on its own; a starter that ships none is not broken.
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(url);
    await play(page);
  } catch (error) {
    fail(`the built page did not run: ${error instanceof Error ? error.message : error}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) fail(`the built page reported errors:\n  ${errors.join('\n  ')}`);
}

/** The packed app's own dev server, and the packed observer reading the game on it. */
async function runObserver(root) {
  const port = 5170 + Math.floor(Math.random() * 20);
  // Its own process group, so stopping it stops Vite too, not only npm.
  const dev = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
  const url = `http://localhost:${port}/`;
  const browser = await launchChrome();
  try {
    for (let tries = 0; ; tries++) {
      if (await fetch(url).then((r) => r.ok, () => false)) break;
      if (tries > 150) fail(`the dev server did not answer at ${url}`);
      await new Promise((done) => setTimeout(done, 200));
    }
    const { observe } = await import(pathToFileURL(join(root, 'node_modules', '@scenoco-three', 'observer', 'dist', 'index.js')).href);
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    await page.goto(url);
    const game = await observe(page);
    const outline = await game.outline(4);
    for (const expected of ['Progress', 'GameState', 'Ball', 'Rigidbody2D']) {
      if (!outline.includes(expected)) fail(`the observer's outline has no ${expected}:\n${outline}`);
    }
    console.log('  outlines the running game');
    await game.press('Space');
    const launched = await game.until("GameState.phase === 'playing'", { maxFrames: 60 });
    if (!launched.met) fail('Space did not launch the ball through the bridge');
    console.log('  presses a key and steps the held clock to the launch');
  } finally {
    await browser.close();
    try {
      process.kill(-dev.pid);
    } catch {
      dev.kill();
    }
  }
}
