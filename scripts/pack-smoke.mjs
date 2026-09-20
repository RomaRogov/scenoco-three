#!/usr/bin/env node
/**
 * The packages as npm will hand them out, installed where nothing of this workspace can reach.
 *
 * Every test in this repository imports the sources, and every agent run resolved the packages
 * through a symlink into the workspace — so neither has ever seen what a user gets. That gap has
 * shipped a broken release before: `core@0.5.0` went out with a `sideEffects` list that let a
 * bundler drop half of it, and nothing here noticed, because no bundler ever met the package.
 *
 * So: `npm pack` every package, install the tarballs into a fresh project in the system temp
 * directory, and walk the path a user walks —
 *
 *   1. `scenoco init`, `npm install`, `npm run check` on the starter exactly as it ships;
 *   2. a scene touching ui (a Button), particles (an inline effect and a `.particle.xml`) and
 *      collision, compiled and typechecked;
 *   3. `vite build`, the built page run in Chrome, its button clicked for real;
 *   4. the observer, over MCP, opening that scene.
 *
 * Along the way: every `@scenoco-three` package is installed once, from its tarball — a second
 * copy of core means two `Component` classes and a silently broken `instanceof`.
 *
 *   node scripts/pack-smoke.mjs [--keep]
 *
 * Needs the packages built (`npm run build`) and Google Chrome installed. `--keep` leaves the
 * project behind and prints where it is.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'scenoco-pack-'));
const tarballs = join(work, 'tarballs');
const app = join(work, 'app');
mkdirSync(tarballs);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
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
    packed.set(manifest.name, join(tarballs, info.filename));
    console.log(`  ${manifest.name}@${manifest.version}  ${info.files.length} files`);
  }
  const tarball = (name) => packed.get(name) ?? fail(`${name} was not packed`);

  // --- 2. the starter, as it ships ------------------------------------------------------------
  // The CLI from its own tarball, installed in a scratch directory: `scenoco init` is the first
  // command anyone runs, and it has to work from the package rather than from this workspace.
  step('scenoco init, from the packed compiler');
  const bootstrap = join(work, 'bootstrap');
  mkdirSync(bootstrap);
  writeFileSync(join(bootstrap, 'package.json'), JSON.stringify({ name: 'bootstrap', private: true }));
  run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', tarball('@scenoco-three/compiler')], bootstrap);
  run(npx, ['--no-install', 'scenoco', 'init', app], bootstrap);

  // Every `@scenoco-three` dependency points at its tarball; nothing else changes, so npm
  // resolves the rest — three, vite, typescript — the way it will for a user.
  const pin = (deps) => {
    for (const name of Object.keys(deps ?? {})) if (packed.has(name)) deps[name] = `file:${tarball(name)}`;
  };
  const appManifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  pin(appManifest.dependencies);
  pin(appManifest.devDependencies);
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(appManifest, null, 2)}\n`);

  step('npm install, then npm run check on the untouched starter');
  run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], app, false);
  run(npm, ['run', 'check'], app, false);

  // --- 3. the packages a game adds ------------------------------------------------------------
  step('adding ui, particles and collision, and a scene that uses all three');
  appManifest.dependencies['@scenoco-three/ui'] = `file:${tarball('@scenoco-three/ui')}`;
  appManifest.dependencies['@scenoco-three/particles'] = `file:${tarball('@scenoco-three/particles')}`;
  appManifest.dependencies['@scenoco-three/collision'] = `file:${tarball('@scenoco-three/collision')}`;
  appManifest.devDependencies['@scenoco-three/observer'] = `file:${tarball('@scenoco-three/observer')}`;
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(appManifest, null, 2)}\n`);
  run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], app, false);

  const tags = join(app, 'src', 'tags.ts');
  writeFileSync(
    tags,
    `${readFileSync(tags, 'utf8')}import '@scenoco-three/ui';\nimport '@scenoco-three/particles';\nimport '@scenoco-three/collision';\n`,
  );
  // A document kind a package brings, from the template the package ships.
  run(npx, ['--no-install', 'scenoco', 'new', 'particle', 'spark'], app);
  writeFileSync(
    join(app, 'src', 'Probe.ts'),
    `import { Component } from '@scenoco-three/core';
import type { Button } from '@scenoco-three/ui';

/**
 * Says, on the page, that the scene runs and that its buttons answer. The first hands its place
 * to the second, the way a start button makes way for the round's controls.
 */
export class Probe extends Component {
  button!: Button;
  again!: Button;
  private frames = 0;

  override start(): void {
    this.again.object3D.setActive(false);
    this.listen(this.button.onClick, () => {
      document.body.dataset.clicked = 'yes';
      this.button.object3D.setActive(false);
      this.again.object3D.setActive(true);
    });
    this.listen(this.again.onClick, () => {
      document.body.dataset.again = 'yes';
    });
  }

  override update(): void {
    document.body.dataset.frames = String(++this.frames);
  }
}
`,
  );
  writeFileSync(
    join(app, 'assets', 'scenes', 'main.scene.xml'),
    `<Scene camera="#camera" background="#0b1120">
  <PerspectiveCamera id="camera" position="y: 4; z: 8" eulerAngles="x: -25">
    <Canvas>
      <Panel id="go" anchor="center" width="220" height="64" background="#2563eb"
             alignX="center" alignY="center">
        <Text text="GO" fontSize="28" color="#ffffff" />
        <Components><Button /></Components>
      </Panel>
      <Panel id="again" anchor="center" width="220" height="64" background="#16a34a">
        <Components><Button /></Components>
      </Panel>
    </Canvas>
  </PerspectiveCamera>
  <AmbientLight intensity="0.8" />
  <Mesh id="player" geometry="../geometry/cube.asset.xml" material="../materials/block.asset.xml">
    <Components>
      <SphereCollider radius="0.5" isSensor="true" />
      <ParticleSystem playOnAwake="true">
        <ParticleEffect duration="1" looping="true" startSize="0.2">
          <Emission rateOverTime="20" />
        </ParticleEffect>
      </ParticleSystem>
    </Components>
  </Mesh>
  <Group id="sparks">
    <Components><ParticleSystem effect="../vfx/spark.particle.xml" playOnAwake="true" /></Components>
  </Group>
  <Group id="probe"><Components><Probe button="#go" again="#again" /></Components></Group>
</Scene>
`,
  );
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

  const version = run(npx, ['--no-install', 'scenoco', '--version'], app).trim();
  if (version.includes(repo)) fail(`scenoco answered from the workspace: ${version}`);
  console.log(`  ${version}`);

  // --- 5. the production build, run --------------------------------------------------------------
  step('vite build, and the built page in Chrome');
  run(npx, ['--no-install', 'vite', 'build', '--logLevel', 'error'], app, false);
  await runBuiltPage(join(app, 'dist'));

  // --- 6. the observer, as an agent starts it ------------------------------------------------------
  step('the observer over MCP');
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

/** Serve `dist`, open it in Chrome, wait for frames, click the button, and hear every error. */
async function runBuiltPage(dist) {
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

  // The harness's own browser driver, from this workspace: it is the thing doing the looking,
  // not the thing under test.
  const { chromium } = await import(join(repo, 'node_modules', 'playwright-core', 'index.mjs'));
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--enable-unsafe-swiftshader'])],
  });
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
    await page.waitForFunction(() => Number(document.body.dataset.frames ?? 0) > 30, undefined, { timeout: 30_000 });
    console.log('  the scene runs');
    await page.mouse.click(400, 250);
    await page.waitForFunction(() => document.body.dataset.clicked === 'yes', undefined, { timeout: 10_000 });
    console.log('  its button answers a real click');
    // The same spot again without moving: what is under a still mouse is what is there now, not
    // the hidden button it last passed over.
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => document.body.dataset.again === 'yes', undefined, { timeout: 10_000 });
    console.log('  and the button that took its place answers a click where the mouse already was');
  } catch (error) {
    fail(`the built page did not run: ${error instanceof Error ? error.message : error}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) fail(`the built page reported errors:\n  ${errors.join('\n  ')}`);
}

/** Start the observer the way an MCP client does, and ask it to open and describe the scene. */
async function runObserver(root) {
  const cli = join(root, 'node_modules', '@scenoco-three', 'observer', 'dist', 'cli', 'index.js');
  const child = spawn(process.execPath, [cli, '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  let buffer = '';
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  let id = 0;
  const send = (method, params) =>
    new Promise((done, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error(`the observer did not answer ${method}\n${stderr}`)), 120_000);
      pending.set(n, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    });
  const text = (reply) => (reply.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try {
    await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pack-smoke', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const opened = await send('tools/call', { name: 'open', arguments: { path: 'assets/scenes/main.scene.xml' } });
    if (opened.result?.isError || opened.error) fail(`observer open failed: ${text(opened) || JSON.stringify(opened.error)}`);
    const outline = text(await send('tools/call', { name: 'outline', arguments: {} }));
    for (const expected of ['Probe', 'Button', 'ParticleSystem', 'SphereCollider']) {
      if (!outline.includes(expected)) fail(`the observer's outline has no ${expected}:\n${outline}`);
    }
    console.log('  opens the scene and outlines it');
    const shot = await send('tools/call', { name: 'screenshot', arguments: { cameraPos: 'y: 4; z: 8' } });
    if (!(shot.result?.content ?? []).some((c) => c.type === 'image')) fail(`no screenshot: ${text(shot)}`);
    console.log('  takes a screenshot');
  } finally {
    child.kill();
  }
}
