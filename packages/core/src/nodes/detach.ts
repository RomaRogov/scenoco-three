import type { Object3D } from 'three';
import { getAttachmentDef } from '../registry/NodeRegistry.js';

/**
 * The inverse of `AttachmentInstance.attach` — restores the host property an
 * attachment owns, so a tool can *remove* an attachment and not just overwrite it.
 *
 * The reset itself lives on the attachment's family (see `nodes/families.ts`), because
 * that is exactly what a family is: everything extending `GeometryAttachment` writes
 * `Mesh.geometry`, so they share one way to put it back. A family that declares no
 * reset is a no-op.
 *
 * Mirrors the Unity/Cocos idiom: you don't "unbind" a material, you assign the
 * default one back.
 */
export function detachAttachment(node: Object3D, tag: string): void {
  getAttachmentDef(tag)?.reset?.(node);
}
