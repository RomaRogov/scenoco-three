import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, Workspace } from '../../packages/compiler/src/index.js';
import { SUMMARY_LENGTH } from '../../packages/compiler/src/describe.js';
import { apiSummaries } from '../../packages/compiler/src/scan/api.js';
import type { ProjectModel } from '../../packages/compiler/src/model.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * Every description `describe` prints fits in `SUMMARY_LENGTH`, whole.
 *
 * `describe` is read by an agent in the middle of a build, and it is read in full every time: a
 * page of worked examples costs that context on every question. So a description is the doc
 * comment's first paragraph and nothing more, and one that does not fit fails here — rewritten
 * shorter, never cut, because a cut summary hid the one clause that mattered.
 */
const PACKAGES = ['core', 'ui', 'particles', 'collision', 'audio', 'box2d'] as const;

let fixture: Fixture;
let model: ProjectModel;
let api: Array<[string, string]>;

beforeAll(() => {
  fixture = makeFixture('summaries', { ui: true, particles: true, collision: true, audio: true, box2d: true });
  fixture.write('tags.ts', PACKAGES.map((name) => `import '@scenoco-three/${name}';`).join('\n'));
  ({ model } = build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true }));
  const modules = PACKAGES.map((name) => `@scenoco-three/${name}`);
  api = Workspace.with(fixture.tsconfig, (workspace) =>
    ['Object3D', 'Scene', ...modules.flatMap((specifier) => {
      const symbol = workspace.resolveModule(specifier);
      return symbol ? workspace.checker.getExportsOfModule(symbol).map((s) => s.name) : [];
    })].flatMap((name) => apiSummaries(workspace, name, modules).map((doc) => [name, doc] as [string, string])),
  );
}, 60_000);

afterAll(() => fixture.dispose());

const tooLong = (entries: Array<[string, string | undefined]>) =>
  entries.filter(([, doc]) => doc && doc.length > SUMMARY_LENGTH).map(([name, doc]) => `${name}: ${doc!.length} — ${doc}`);

describe('describe', () => {
  it('prints every runtime API description whole, within the limit', () => {
    expect(api.length).toBeGreaterThan(50);
    expect(tooLong(api)).toEqual([]);
  });

  it('prints every component, tag and attribute description whole, within the limit', () => {
    const packaged = <T extends { module?: string }>(list: readonly T[]) => list.filter((t) => t.module && t.module !== 'three');
    const entries: Array<[string, string | undefined]> = [];
    for (const c of packaged([...model.components, ...model.systems, ...model.effects])) {
      entries.push([c.name, c.description]);
      for (const f of c.fields) entries.push([`${c.name}.${f.name}`, f.description]);
      for (const e of c.events ?? []) entries.push([`${c.name}.${e.name}`, e.description]);
    }
    for (const t of packaged(model.tags)) {
      entries.push([t.name, t.description]);
      for (const p of [...t.parameters, ...t.properties].filter((p) => !p.owner)) entries.push([`${t.name}.${p.name}`, p.description]);
    }
    expect(entries.length).toBeGreaterThan(50);
    expect(tooLong(entries)).toEqual([]);
  });
});
