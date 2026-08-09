import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compileSceneXml } from '@scenoco-three/compiler';
// The doc quotes tags from every package the playground installs; they only
// exist in the registry once imported, exactly as `registerPackages` does it.
import '@scenoco-three/core/nodes';
import '@scenoco-three/ui';
import '@scenoco-three/particles';
import '@scenoco-three/animation';
import '@scenoco-three/collision';
import { srcDocument as particleDocument } from '@scenoco-three/particles/compiler';
import { registerSrcDocument } from '@scenoco-three/compiler';

// `<ParticleSystem src="…">` is only legal where the package's build-time
// document format is registered — normally done by the CLI/plugin from the
// project's package.json. Here, by hand.
registerSrcDocument(particleDocument);
import { describe, expect, it } from 'vitest';

/**
 * `playground/CLAUDE.md` is the whole reference for the half of the API `scenoco
 * which` does not cover — the TypeScript surface a component calls. Its own
 * instructions say not to read the engine's source, so when a snippet there is
 * wrong there is nothing to fall back on but the `.d.ts` files the agent was
 * told to avoid.
 *
 * One had drifted: `this.node.destroy()`, which does not exist (`Object3D` has no
 * `destroy`; it is `engine.destroy(node)`). `Component.destroy()` *does* exist and
 * ends the component rather than the node — same spelling, different operation —
 * so the wrong call is a natural one to write and a hard one to notice.
 *
 * Rather than typecheck each snippet whole (they are fragments — a lone
 * `@property`, a bare statement — and wrapping them back into compilable code
 * takes guesswork that can itself be wrong), this pulls out every member the doc
 * names on a known receiver and asks the real types whether it is there. That is
 * the drift this can suffer, checked against the same declarations `npm run
 * check` uses.
 */

const DOC = fileURLToPath(new URL('../../playground/CLAUDE.md', import.meta.url));

/**
 * Receivers the doc calls into, and the type each one has.
 *
 * Deliberately not `this`: in a component, `this.speed` is as likely to be the
 * author's own `@property` as anything the engine provides, so every mention
 * would have to be allowed and the check would prove nothing. The base class's
 * own helpers are listed instead, below.
 */
const RECEIVERS: Record<string, string> = {
  'this.engine.input': "Engine['input']",
  'this.engine': 'Engine',
  'this.node': 'Object3D',
  'input': "Engine['input']",
};

/** `Component` members the doc teaches directly — checked by name, since `this.x` can't be attributed. */
const COMPONENT_API = ['listen', 'destroy', 'node', 'engine', 'onLoad', 'start', 'update', 'lateUpdate', 'onDestroy'];

function tsBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/**
 * Every `<receiver>.<member>` the doc mentions. Longest receiver first, so
 * `this.engine.input.getAxis` is attributed to the input manager rather than
 * being read as `this.engine` + `.input`.
 */
function membersNamed(code: string): { receiver: string; member: string }[] {
  const found = new Map<string, { receiver: string; member: string }>();
  const receivers = Object.keys(RECEIVERS).sort((a, b) => b.length - a.length);
  for (const line of code.split('\n')) {
    // A line the doc shows *in order to* be rejected — the "does this call exist?"
    // recipe demonstrates the error message. Marked by its `// tsc:` comment, so
    // the demonstration is exempt by declaration rather than by happening to use
    // a receiver spelling this doesn't scan for.
    if (/\/\/\s*tsc:/.test(line)) continue;
    const source = line.replace(/\/\/.*$/, ''); // a comment may mention a call it isn't making
    for (const receiver of receivers) {
      const re = new RegExp(`(?<![\\w.])${receiver.replace(/\./g, '\\.')}[?!]?\\.(\\w+)`, 'g');
      for (const m of source.matchAll(re)) found.set(`${receiver}.${m[1]}`, { receiver, member: m[1]! });
    }
  }
  return [...found.values()];
}

describe('playground/CLAUDE.md — the documented TypeScript surface', () => {
  it('names only members that exist on the real types', () => {
    const named = tsBlocks(readFileSync(DOC, 'utf8')).flatMap(membersNamed);
    // A canary: if extraction silently stops matching, the test would pass by
    // checking nothing at all.
    expect(named.length).toBeGreaterThan(10);

    // Each mention becomes a bare property access. `tsc` then reports exactly
    // "Property 'destroy' does not exist on type 'Object3D'" — the real check,
    // done by the real compiler, with no wrapping guesswork.
    const probe = [
      `import type { Component, Engine } from '@scenoco-three/core';`,
      `import type { Object3D } from 'three';`,
      ...Object.values(RECEIVERS).map((type, i) => `declare const r${i}: ${type}; void r${i};`),
      ...named.map(({ receiver, member }) => {
        const i = Object.keys(RECEIVERS).indexOf(receiver);
        return `void r${i}.${member}; // ${receiver}.${member}`;
      }),
      // The lifecycle/helpers the doc names on the base class itself.
      `declare const c: Component; void c;`,
      ...COMPONENT_API.map((member) => `void c.${member}; // Component.${member}`),
    ].join('\n');

    // Inside the repo, not a tmpdir: the probe imports the engine by bare
    // specifier, which only resolves with the workspace's node_modules above it.
    const file = fileURLToPath(new URL('../../.doc-probe.ts', import.meta.url));
    writeFileSync(file, probe);
    try {
      const program = ts.createProgram([file], {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
      });
      const problems = ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
      expect(problems).toEqual([]);
    } finally {
      rmSync(file, { force: true });
    }
  });
});

/**
 * The same drift, on the XML side — and it had happened there too: the doc's
 * `<PrefabInstance src="coin.prefab.xml" position="…" />` carried no `id`, which
 * the compiler requires on every instance. Copying it produced one error per
 * placement, from the file that was supposed to be the reference.
 *
 * The snippets are fragments quoting a project that does not exist here, so what
 * is checked is what a fragment *can* answer for: the tags and attributes it
 * names are real, and it satisfies the rules that hold regardless of
 * surroundings (required attributes, value formats). Diagnostics that only exist
 * because the rest of the project is absent are filtered — narrowly, by code and
 * by the specific invented names, so a genuine typo can't hide behind them.
 */
describe('playground/CLAUDE.md — the documented XML', () => {
  /** Components/prefabs/materials the doc invents to have something to talk about. */
  const FICTIONAL = /\b(Ball|PlayerController|Coin|Brick|GameManager|Scoreboard|coin\.prefab\.xml|sparks\.particle\.xml)\b/;
  /** Blocks that are a component element on its own, shown as it would appear inside <Components>. */
  const COMPONENT_FRAGMENT = /^<(ParticleSystem|Tween)\b/;
  /** Only meaningful with the rest of the project present. */
  const CONTEXTUAL = new Set(['no-resolver', 'prefab-not-found', 'resource-not-found', 'unknown-ref', 'ref-not-found']);
  /**
   * The only codes an invented name may excuse. Scoped this tightly on purpose:
   * matching the name anywhere in any message was enough to swallow
   * `<PrefabInstance src="coin.prefab.xml"> requires an id` — a real defect, and
   * the very one this exists to catch, hidden because the filename it quotes is
   * one of the invented ones.
   */
  const NAME_CODES = new Set(['unknown-tag', 'unknown-component', 'unknown-attr', 'unknown-child']);

  it('names only real tags and attributes, and obeys the rules a fragment can obey', () => {
    const blocks = [...readFileSync(DOC, 'utf8').matchAll(/```xml\n([\s\S]*?)```/g)].map((m) => m[1]!.trim());
    expect(blocks.length).toBeGreaterThan(5);

    const problems: string[] = [];
    for (const block of blocks) {
      // A `.particle.xml` document has its own root and its own grammar (checked
      // by the particles package, not the scene validator).
      if (block.includes('<Emission')) continue;
      // Fragments below scene level get a host: `<Components>` needs a node to sit
      // in, everything else can be a scene child.
      const inMesh = (inner: string) =>
        `<Scene><Mesh id="host"><Attachments><BoxGeometry /></Attachments>${inner}</Mesh></Scene>`;
      const xml = block.startsWith('<Scene')
        ? block
        : block.startsWith('<Components')
          ? inMesh(block)
          : // A bare component element (`<ParticleSystem …/>`, `<Tween …/>`) needs
            // both a <Components> block and a node to hold it.
            COMPONENT_FRAGMENT.test(block)
            ? inMesh(`<Components>${block}</Components>`)
            : `<Scene>${block}</Scene>`;
      const r = compileSceneXml(xml);
      if (r.ok) continue;
      for (const d of r.diagnostics) {
        if (CONTEXTUAL.has(d.code)) continue;
        if (NAME_CODES.has(d.code) && FICTIONAL.test(d.message)) continue;
        problems.push(`${d.code}: ${d.message}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
