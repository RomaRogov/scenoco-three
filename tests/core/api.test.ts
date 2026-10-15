import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '@scenoco-three/core';

const digest = readFileSync(new URL('../../packages/core/API.md', import.meta.url), 'utf8');

/** Exported for packages — physics, audio, particles — not for games. */
const forPackages = new Set(['System', 'service', 'cameraOf', 'declareMessages', 'runtimeOf', 'behavioursOn', 'wake', 'Runtime']);

describe('API.md', () => {
  it('names every export a game uses', () => {
    const missing = Object.keys(core).filter((name) => !forPackages.has(name) && !digest.includes(name));
    expect(missing).toEqual([]);
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
