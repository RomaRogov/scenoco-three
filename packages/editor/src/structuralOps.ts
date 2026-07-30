// The seam between the editor's structural ops and the compiler's.
//
// They differ on purpose (see `StructuralOp` in protocol.ts): the browser has no
// compiler, so an `insertNode` travels as a compiled `CompiledScene` fragment and
// only becomes XML here, on the Node side, where `serializeScene` is available.
// Every other op is identical in both shapes and passes through untouched.

import {
  applyStructuralOps,
  patchSceneXml,
  serializeAttachmentElement,
  serializeComponentElement,
  serializeScene,
  type PatchEdit,
  type StructuralOp,
} from '@scenoco-three/compiler';

import type { StructuralOp as EditorStructuralOp } from './protocol.js';

/**
 * Apply one save to a scene's source text: structural ops reshape the tree first,
 * then attribute edits patch what survived. **The order is the contract** — an
 * `EditOp` addresses an element by id/path in the *reshaped* document, so patching
 * before splicing would target the pre-move tree and silently mis-apply.
 *
 * Pure (text in, text out) so the ordering and the `unresolved` accounting are
 * testable without a dev server; the save endpoint is the only caller and does
 * nothing but read the file, call this, and write it back.
 */
export function applySaveOps(
  source: string,
  edits: readonly PatchEdit[],
  structuralOps: readonly EditorStructuralOp[] = [],
): { text: string; changed: number; unresolved: number } {
  const structural = applyStructuralOps(source, toCompilerStructuralOps(structuralOps));
  const patched = patchSceneXml(structural.text, edits as PatchEdit[]);
  return {
    text: patched.text,
    changed: patched.changed + structural.applied,
    unresolved: patched.unresolved.length + structural.unresolved.length,
  };
}

/** Serialize editor ops into the compiler's XML-based ops, ready for the splicer. */
export function toCompilerStructuralOps(ops: readonly EditorStructuralOp[]): StructuralOp[] {
  return ops.map((op) => {
    if (op.op === 'insertNode') {
      return {
        op: 'insertNode',
        parent: op.parent,
        ...(op.index !== undefined ? { index: op.index } : {}),
        xml: serializeScene(op.fragment),
      };
    }
    if (op.op === 'insertMember') {
      return {
        op: 'insertMember',
        node: op.node,
        block: op.block,
        ...(op.index !== undefined ? { index: op.index } : {}),
        xml:
          op.member.kind === 'component'
            ? serializeComponentElement(op.member.value)
            : serializeAttachmentElement(op.member.value),
      };
    }
    return op;
  });
}
