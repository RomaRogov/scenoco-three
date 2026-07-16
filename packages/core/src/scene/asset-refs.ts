import { Registry } from '../registry/Registry.js';
import type { AssetKind } from '../assets/AssetCache.js';
import type { CompiledScene } from './compiled.js';
import { getAttachmentDef } from '../registry/NodeRegistry.js';

/** A declared asset reference found in a compiled scene. */
export interface AssetRef {
  url: string;
  kind: AssetKind;
}

/**
 * Walk a compiled scene (and any embedded prefabs) for every `@property` marked
 * `asset` — on attachments and components alike — collecting the unique URLs to
 * preload. Registry-driven, so it finds assets on project tags too, with no
 * per-tag knowledge baked in. The engine's default preload provider feeds these
 * URLs to the `AssetCache` before instantiating.
 */
export function collectAssetRefs(scene: CompiledScene): AssetRef[] {
  const refs: AssetRef[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, kind: AssetKind): void => {
    if (typeof value === 'string' && value.length > 0 && !seen.has(value)) {
      seen.add(value);
      refs.push({ url: value, kind });
    }
  };

  const walk = (s: CompiledScene): void => {
    for (const a of s.attachments) {
      const def = getAttachmentDef(a.tag);
      if (!def) continue;
      for (const [name, attr] of Object.entries(def.attrs)) {
        if (attr.asset) add(a.attrs[name], attr.asset);
      }
    }
    for (const c of s.components) {
      const props = Registry.getComponent(c.type)?.meta.properties;
      if (!props) continue;
      for (const [name, meta] of props) {
        if (meta.asset) add(c.props[name], meta.asset);
      }
    }
    for (const p of s.prefabs ?? []) walk(p);
  };

  walk(scene);
  return refs;
}
