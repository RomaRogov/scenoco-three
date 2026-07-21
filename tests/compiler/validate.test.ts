import { describe, expect, it } from 'vitest';
import { parseScene, validateScene, type SceDiagnostic } from '@scenoco-three/compiler';

/** Parse + validate, returning diagnostics (parse errors included). */
function check(xml: string): SceDiagnostic[] {
  const parsed = parseScene(xml);
  if (!parsed.ok) return parsed.diagnostics;
  return validateScene(parsed.root);
}
const codes = (xml: string) => check(xml).map((d) => d.code);

describe('Validator', () => {
  it('accepts a valid scene with no diagnostics', () => {
    expect(check(`<Scene><Mesh id="A"><Attachments><BoxGeometry /><MeshStandardMaterial color="#ff0000" /></Attachments></Mesh></Scene>`)).toEqual([]);
  });

  it('flags unknown tags/attributes with a suggestion and line number, and malformed values', () => {
    const tag = check(`<Scene>\n  <Mesh id="A"><BocGeometry /></Mesh>\n</Scene>`).find((d) => d.code === 'unknown-tag');
    expect(tag?.message).toContain('BoxGeometry');
    expect(tag?.line).toBe(2);

    const attr = check(`<Scene><Mesh id="A" positon="0 0 0"><Attachments><BoxGeometry /></Attachments></Mesh></Scene>`).find((d) => d.code === 'unknown-attr');
    expect(attr?.message).toContain('position');

    const value = check(`<Scene><Mesh id="A" position="0 0"><Attachments><BoxGeometry /></Attachments></Mesh></Scene>`).find((d) => d.code === 'bad-value');
    expect(value?.message).toContain('3 space-separated numbers');
  });

  it('enforces attachment rules (required, uniqueness, target, and the <Attachments> block)', () => {
    expect(codes(`<Scene><Mesh id="A" /></Scene>`)).toContain('missing-required-attachment');
    expect(codes(`<Scene><Mesh id="A"><Attachments><BoxGeometry /><SphereGeometry /></Attachments></Mesh></Scene>`)).toContain('duplicate-attachment');
    expect(codes(`<Scene><Group><Attachments><BoxGeometry /></Attachments></Group></Scene>`)).toContain('attachment-wrong-target');
    // Mandatory wrapper, mirroring <Components>: a bare attachment is an error…
    expect(codes(`<Scene><Mesh id="A"><BoxGeometry /><MeshStandardMaterial /></Mesh></Scene>`)).toContain('attachment-outside-block');
    // …a node/component inside <Attachments> is rejected…
    expect(codes(`<Scene><Mesh id="A"><Attachments><BoxGeometry /><Rotator speed="1" /></Attachments></Mesh></Scene>`)).toContain('not-an-attachment');
    // …and only one block per node.
    expect(codes(`<Scene><Mesh id="A"><Attachments><BoxGeometry /></Attachments><Attachments><MeshStandardMaterial /></Attachments></Mesh></Scene>`)).toContain('duplicate-attachments');
  });

  it('enforces component placement, unknown components, and duplicate ids', () => {
    expect(codes(`<Scene><Mesh id="A"><Attachments><BoxGeometry /></Attachments><Rotator speed="1" /></Mesh></Scene>`)).toContain('component-outside-block');
    const unknown = check(`<Scene><Mesh id="A"><Attachments><BoxGeometry /></Attachments><Components><Rotor speed="1" /></Components></Mesh></Scene>`).find(
      (d) => d.code === 'unknown-component',
    );
    expect(unknown?.message).toContain('Rotator');
    expect(codes(`<Scene><Mesh id="A"><Attachments><BoxGeometry /></Attachments></Mesh><Mesh id="A"><Attachments><BoxGeometry /></Attachments></Mesh></Scene>`)).toContain('duplicate-id');
  });

  it('validates references: requires #, reports unresolved, and type mismatches', () => {
    expect(codes(`<Scene><Mesh id="A"><Attachments><BoxGeometry /></Attachments><Components><Oscillator id="osc" /></Components></Mesh>
      <Mesh id="B"><Attachments><BoxGeometry /></Attachments><Components><Follow source="osc" /></Components></Mesh></Scene>`)).toContain('ref-missing-hash');
    expect(codes(`<Scene><Mesh id="B"><Attachments><BoxGeometry /></Attachments><Components><Follow source="#ghost" /></Components></Mesh></Scene>`)).toContain('unresolved-ref');
    expect(codes(`<Scene><Mesh id="A"><Attachments><BoxGeometry /></Attachments><Components><Rotator id="rot" /></Components></Mesh>
      <Mesh id="B"><Attachments><BoxGeometry /></Attachments><Components><Follow source="#rot" /></Components></Mesh></Scene>`)).toContain('ref-type-mismatch');
  });

  it('reports malformed XML with a position, and rejects a non-bracketed array value', () => {
    expect(check(`<Scene><Mesh></Scene>`)[0]!.code).toBe('xml-syntax');
    expect(codes(`<Scene><Mesh id="M"><Attachments><BoxGeometry /></Attachments><Components><ArrayProbe points="1,2,3" /></Components></Mesh></Scene>`)).toContain('bad-value');
  });
});
