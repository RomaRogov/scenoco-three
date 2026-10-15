#!/usr/bin/env node
/**
 * `scenoco-observer [--root <dir>] [--headed]` — the observer as a stdio MCP server.
 *
 * The browser starts on the first tool call, not at launch, so a client that never looks pays
 * nothing. Everything but the protocol goes to stderr: one stray line on stdout breaks a session.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createObserver, serveStdio } from './mcp.js';
import { openGame, type Game } from './game.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const root = value('root') ?? process.cwd();
// Decided before the page opens, because the tool list is what a client sees first: a project on
// SceNoCo gets the clock, outline and telemetry; any other page gets what works there.
const layer = usesCore(root);

function usesCore(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    return Boolean(pkg.dependencies?.['@scenoco-three/core'] ?? pkg.devDependencies?.['@scenoco-three/core']);
  } catch {
    return false;
  }
}

let opening: Promise<Game> | null = null;
const game = () => (opening ??= openGame({ root, headed: flag('headed') }));

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  if (opening) await (await opening.catch(() => null))?.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('SIGHUP', close);
// A client that dies without a goodbye closes our stdin: that is the end of the session too, and
// a browser left running after it is a leak someone finds hours later.
process.stdin.on('end', close);
process.stdin.on('close', close);

await serveStdio(createObserver(game, { layer }), () => void close());
console.error('scenoco-observer: ready on stdio');
