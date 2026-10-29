import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '@scenoco-three/core';

const digest = readFileSync(new URL('../../packages/core/API.md', import.meta.url), 'utf8');

/** Exported for packages — physics, audio, particles — not for games. */
const forPackages = new Set(['System', 'service', 'cameraOf', 'declareMessages', 'runtimeOf', 'behavioursOn', 'wake', 'writtenOf', 'Runtime']);

describe('API.md', () => {
  it('names every export a game uses', () => {
    const missing = Object.keys(core).filter((name) => !forPackages.has(name) && !digest.includes(name));
    expect(missing).toEqual([]);
  });

  it('names only types that exist: every generic it writes is exported by core, three.js or TypeScript', () => {
    // A type name made up for the page — `Class<T>` once — sends a model grepping dist/ for it.
    const declared = readFileSync(new URL('../../packages/core/dist/index.d.ts', import.meta.url), 'utf8');
    const builtin = new Set(['Partial', 'Promise', 'Record', 'Generator', 'Array', 'Readonly']);
    const named = new Set([...digest.matchAll(/\b([A-Z]\w*)</g)].map((m) => m[1]!));
    expect([...named].filter((name) => !builtin.has(name) && !new RegExp(`\\b${name}\\b`).test(declared))).toEqual([]);
  });

  it('spells every KeyCode it shows as core does — the starter’s rules card too', () => {
    const card = readFileSync(new URL('../../packages/create/template/AGENTS.md', import.meta.url), 'utf8');
    const written = [...(digest + card).matchAll(/KeyCode\.(\w+)/g)].map((m) => m[1]!);
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((name) => !(name in core.KeyCode))).toEqual([]);
  });

  it('names every public member of Behaviour', () => {
    const members = new Set<string>();
    for (let proto = core.Behaviour.prototype; proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) if (name !== 'constructor' && !name.startsWith('_')) members.add(name);
    }
    expect([...members].filter((name) => !digest.includes(name))).toEqual([]);
  });
});
