import { describe, expect, it } from 'vitest';
import {
  indexDocument,
  parseDocument,
  insertChild,
  moveElement,
  removeElement,
  setAttribute,
} from '../../packages/compiler/src/index.js';

/**
 * Editing a document as text.
 *
 * The property under test throughout is that **everything nobody touched survives byte for
 * byte** — comments, attribute order, indentation, blank lines. An editor that reformatted a
 * file on every attribute change would make its own diffs unreviewable, and XML is what a person
 * reads here.
 *
 * Elements are addressed by the line and column the compiler stamps into `userData.scenoco`, so
 * a live object under the cursor names an element with no lookup table and nothing to go stale.
 */
const DOC = `<!-- The level. Comments must survive an edit. -->
<Scene>
  <PerspectiveCamera id="cam" fov="50" position="z: 8" />

  <!-- the player -->
  <Mesh id="hero"
        geometry="../geometry/cube.geometry.xml"
        material="../materials/m.material.xml">
    <Components>
      <Spinner speed="2" />
    </Components>
  </Mesh>

  <Group id="props" />
</Scene>
`;

/** The identity of an element, the way provenance records it. */
const at = (tag: string) => {
  const found = indexDocument(DOC).find((e) => e.tag === tag);
  if (!found) throw new Error(`no <${tag}> in the fixture`);
  return { line: found.line, column: found.column };
};

describe('the index', () => {
  it('finds every element, nested and self-closing alike', () => {
    expect(indexDocument(DOC).map((e) => e.tag)).toEqual([
      'Scene', 'PerspectiveCamera', 'Mesh', 'Components', 'Spinner', 'Group',
    ]);
  });

  it('refuses a document that does not parse, rather than losing the edit', () => {
    expect(() => indexDocument('<Scene><Mesh></Scene>')).toThrow(/does not parse/);
  });
});

describe('setAttribute', () => {
  it('rewrites one value and leaves every other byte alone', () => {
    const { text, changed } = setAttribute(DOC, at('PerspectiveCamera'), 'fov', '70');
    expect(changed).toBe(true);
    expect(text).toContain('fov="70"');
    // The whole rest of the file, untouched.
    expect(text.replace('fov="70"', 'fov="50"')).toBe(DOC);
  });

  it('adds a new attribute after the existing ones', () => {
    const { text } = setAttribute(DOC, at('PerspectiveCamera'), 'near', '0.1');
    expect(text).toContain('<PerspectiveCamera id="cam" fov="50" position="z: 8" near="0.1" />');
  });

  it('removes an attribute, and the gap it would have left', () => {
    const { text } = setAttribute(DOC, at('PerspectiveCamera'), 'fov', null);
    expect(text).toContain('<PerspectiveCamera id="cam" position="z: 8" />');
  });

  it('is a no-op when clearing something that was never written', () => {
    const { text, changed } = setAttribute(DOC, at('Group'), 'visible', null);
    expect(changed).toBe(false);
    expect(text).toBe(DOC);
  });

  it('works on an element whose open tag spans several lines', () => {
    const { text } = setAttribute(DOC, at('Mesh'), 'material', '../materials/gold.material.xml');
    expect(text).toContain('material="../materials/gold.material.xml">');
    // Its layout across three lines is preserved.
    expect(text).toContain('<Mesh id="hero"\n        geometry=');
  });

  it('escapes a value rather than producing a document that will not parse', () => {
    const { text } = setAttribute(DOC, at('Group'), 'name', 'a "quoted" & <angled>');
    expect(text).toContain('name="a &quot;quoted&quot; &amp; &lt;angled&gt;"');
    expect(() => indexDocument(text)).not.toThrow();
  });

  it('says so when the document moved under it', () => {
    const { changed, problem } = setAttribute(DOC, { line: 99, column: 1 }, 'fov', '70');
    expect(changed).toBe(false);
    expect(problem).toContain('the document changed');
  });
});

describe('removeElement', () => {
  it('takes the subtree and its blank line, and keeps the comments around it', () => {
    const { text } = removeElement(DOC, at('Mesh'));
    expect(text).not.toContain('<Mesh');
    expect(text).not.toContain('<Spinner');
    expect(text).toContain('<!-- The level. Comments must survive an edit. -->');
    expect(text).toContain('<!-- the player -->');
    expect(text).toContain('<Group id="props" />');
    expect(() => indexDocument(text)).not.toThrow();
  });
});

describe('insertChild', () => {
  it('appends a child at the parent’s indentation', () => {
    const { text } = insertChild(DOC, at('Scene'), '<AmbientLight intensity="0.5" />');
    expect(text).toContain('  <AmbientLight intensity="0.5" />\n</Scene>');
  });

  it('inserts before an existing sibling when given its index', () => {
    const { text } = insertChild(DOC, at('Scene'), '<AmbientLight />', 0);
    const light = text.indexOf('<AmbientLight');
    expect(light).toBeGreaterThan(-1);
    expect(light).toBeLessThan(text.indexOf('<PerspectiveCamera'));
  });

  it('opens up a self-closing parent rather than refusing', () => {
    const { text } = insertChild(DOC, at('Group'), '<Mesh />');
    expect(text).toContain('<Group id="props">');
    expect(text).toContain('</Group>');
    expect(() => indexDocument(text)).not.toThrow();
  });
});

describe('moveElement', () => {
  it('reparents a subtree, keeping its comments and its own shape', () => {
    const { text, changed } = moveElement(DOC, at('Mesh'), at('Group'));
    expect(changed).toBe(true);

    const elements = indexDocument(text);
    const mesh = elements.find((e) => e.tag === 'Mesh')!;
    expect(mesh.parent?.tag).toBe('Group');
    // The components came along, and the file still parses.
    expect(elements.map((e) => e.tag)).toContain('Spinner');
    expect(text).toContain('<!-- the player -->');
  });

  it('refuses to move an element inside itself', () => {
    const { changed, problem } = moveElement(DOC, at('Mesh'), at('Components'));
    expect(changed).toBe(false);
    expect(problem).toContain('inside itself');
  });
});

/**
 * The editing index and the document parser must report **the same position** for the same
 * element.
 *
 * They are two parsers over one file, and the compiler stamps live objects with the *document
 * parser's* numbers while the editor addresses splices with the *index's*. They drifted the
 * moment they were written — one recorded the position just past the tag name and the other just
 * past `>`, so a short tag agreed and a long one did not. The symptom was some nodes being
 * selectable in the editor and some not, which points nowhere near the cause.
 */
describe('the two parsers agree', () => {
  it('reports the same line and column as parseDocument, for every element', () => {
    const parsed = parseDocument(DOC, 'fixture.scene.xml');
    if (!parsed.ok) throw new Error('the fixture must parse');

    const fromParser: string[] = [];
    const walk = (element: { tag: string; line: number; column: number; children: unknown[] }): void => {
      fromParser.push(`${element.tag}@${element.line}:${element.column}`);
      for (const child of element.children) walk(child as typeof element);
    };
    walk(parsed.root);

    const fromIndex = indexDocument(DOC).map((e) => `${e.tag}@${e.line}:${e.column}`);
    expect(fromIndex).toEqual(fromParser);
  });
});
