import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
// A URL, not a specifier: the script is plain JavaScript with no declarations for tsc to read.
const discovery = () => import(new URL('scripts/discovery.mjs', root).href) as Promise<{ context7(): unknown }>;

describe('what agents and registries read', () => {
  it('context7.json is derived from the README and the rules card', async () => {
    // Out of date after either one changed: `npm run discovery` writes it again.
    expect(json('context7.json')).toEqual((await discovery()).context7());
  });

  it('every published package says what it is and where it lives', () => {
    for (const dir of readdirSync(new URL('packages/', root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const pkg = json(`packages/${dir}/package.json`);
      if (pkg.private) continue;
      expect(pkg.description, pkg.name).toBeTruthy();
      expect(pkg.keywords, pkg.name).toEqual(expect.arrayContaining(['threejs', 'game-engine', 'gamedev']));
      expect(pkg.homepage, pkg.name).toMatch(/^https:\/\//);
      expect(pkg.repository?.directory, pkg.name).toBe(`packages/${dir}`);
    }
  });
});
