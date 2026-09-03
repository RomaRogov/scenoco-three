import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Workspace,
  emitResource,
  parseDocument,
  scanTags,
  type ProjectModel,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * Geometry and material documents are what `<Attachments>` became. A mesh no longer declares
 * its geometry inline; it references an asset, the same way Unity's MeshFilter references a
 * mesh and its MeshRenderer references a `.mat`.
 */
let fixture: Fixture;
let model: ProjectModel;

beforeAll(() => {
  fixture = makeFixture('resource');
  fixture.write('game.ts', `import { Mesh } from 'three';\nexport const m = new Mesh();\n`);
  model = { components: [], systems: [], effects: [], tags: Workspace.with(fixture.tsconfig, (w) => scanTags(w)) };
});

afterAll(() => fixture.dispose());

function emit(xml: string, family: 'geometry' | 'material', name = 'brick') {
  const parsed = parseDocument(xml, `${name}.${family}.xml`);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join('\n'));
  return emitResource(parsed.root, { name, model, family, source: `${name}.${family}.xml` });
}

describe('geometry documents', () => {
  it('emits a module-scope singleton from the constructor parameters', () => {
    const { code, diagnostics } = emit('<BoxGeometry width="1.2" height="0.4" depth="0.5" />', 'geometry');
    expect(diagnostics).toEqual([]);
    expect(code).toContain(`import { BoxGeometry } from 'three';`);
    // `shared()` is what says the *module* owns this, not whichever scene happens to be using
    // it — without it the first scene to unload disposes it out from under every other one.
    expect(code).toContain('export const brick = shared(new BoxGeometry(1.2, 0.4, 0.5));');
    expect(code).toContain(`import { shared } from '@scenoco-three/core';`);
  });

  it('fills a skipped parameter rather than shifting the ones after it', () => {
    // `radius` set, `widthSegments` skipped, `heightSegments` set — the third argument must
    // land in the third slot, not the second.
    const { code } = emit('<SphereGeometry radius="0.3" heightSegments="12" />', 'geometry', 'ball');
    expect(code).toContain('new SphereGeometry(0.3, undefined, 12)');
  });

  it('reports an attribute the constructor does not declare, with a suggestion', () => {
    const { diagnostics } = emit('<BoxGeometry widht="1" />', 'geometry');
    expect(diagnostics[0]?.code).toBe('unknown-attribute');
    expect(diagnostics[0]?.message).toContain('Did you mean "width"?');
  });

  it('reports a tag that is not a geometry at all', () => {
    const { diagnostics } = emit('<MeshStandardMaterial />', 'geometry');
    expect(diagnostics[0]?.code).toBe('unknown-tag');
  });
});

describe('material documents', () => {
  it('emits one parameters object, because that is what three.js takes', () => {
    const { code, diagnostics } = emit(
      '<MeshStandardMaterial color="#e9c46a" emissive="#3a2f10" roughness="0.5" metalness="0.1" />',
      'material',
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('new MeshStandardMaterial({');
    // A real `THREE.Color`, not a bare hex number: a field declared `Color` accepts only a
    // Color, and a Color is accepted everywhere the number was.
    expect(code).toContain('color: new Color(0xe9c46a)');
    expect(code).toContain('roughness: 0.5');
  });

  it('emits a numeric three.js constant by name, not by number', () => {
    const { code, diagnostics } = emit('<MeshBasicMaterial side="DoubleSide" />', 'material', 'flat');
    expect(diagnostics).toEqual([]);
    expect(code).toContain('side: DoubleSide');
    expect(code).toContain(`import { DoubleSide, MeshBasicMaterial } from 'three';`);
  });

  /**
   * Every other spelling `THREE.Color` takes is read, and answered with the hex to write. The
   * conversion is three.js's own parser, so the answer is exact — including the cases where the
   * name is not the colour anyone expects.
   */
  it.each([
    ['tomato', 'a CSS colour name', '#ff6347'],
    ['green', 'a CSS colour name', '#008000'],
    ['0xff6347', 'JavaScript notation', '#ff6347'],
    ['rgb(255, 99, 71)', 'a CSS colour function', '#ff6347'],
    ['hsl(9, 100%, 64%)', 'a CSS colour function', '#ff6347'],
  ])('rejects %s, and says what to write instead', (written, kind, hex) => {
    const { diagnostics } = emit(`<MeshBasicMaterial color="${written}" />`, 'material');
    expect(diagnostics[0]?.code).toBe('bad-color');
    expect(diagnostics[0]?.message).toBe(
      `color="${written}" is ${kind}. In a document write color="${hex}".`,
    );
  });

  it('names the nearest colour for a misspelt one — three.js would only warn and render', () => {
    const { diagnostics } = emit('<MeshBasicMaterial color="tomatoe" />', 'material');
    expect(diagnostics[0]?.code).toBe('bad-color');
    expect(diagnostics[0]?.message).toContain('nearest CSS name is "tomato"');
    expect(diagnostics[0]?.message).toContain('"#ff6347"');
  });

  it.each([
    ['#0f172acc', '#0f172a', 0.8],
    ['#abcd', '#abc', 0.87],
  ])('hands back both halves of %s: the colour and the alpha, and where each goes', (written, rgb, alpha) => {
    // `#rrggbbaa` is valid CSS and the one near miss three.js cannot parse — it warns and leaves
    // the colour untouched, a bug that renders. Saying only "must be a hex colour" left the
    // author to work out where the alpha went; three agents in a row spent a check cycle on it.
    const { diagnostics } = emit(`<MeshBasicMaterial color="${written}" />`, 'material');
    expect(diagnostics[0]?.code).toBe('bad-color');
    expect(diagnostics[0]?.message).toContain(`color="${rgb}"`);
    expect(diagnostics[0]?.message).toContain(`opacity="${alpha}"`);
  });


  it('rejects something that is no colour at all', () => {
    const { diagnostics } = emit('<MeshBasicMaterial color="quite dark" />', 'material');
    expect(diagnostics[0]?.code).toBe('bad-color');
    expect(diagnostics[0]?.message).toContain('must be a hex colour');
  });

  it('rejects a non-numeric number', () => {
    const { diagnostics } = emit('<MeshStandardMaterial roughness="quite" />', 'material');
    expect(diagnostics[0]?.code).toBe('bad-number');
  });

  it('rejects children — a material document is one element', () => {
    const { diagnostics } = emit('<MeshBasicMaterial><BoxGeometry /></MeshBasicMaterial>', 'material');
    expect(diagnostics.some((d) => d.code === 'unexpected-child')).toBe(true);
  });
});
