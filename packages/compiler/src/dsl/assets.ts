// What kinds of file a SceNoCo project holds, and how to check one.
//
// A project's XML comes in four shapes: scenes, prefabs, materials, and whatever
// `src=` document formats its tag packages bring (particles' `.particle.xml`).
// The first three are described by the registries; the fourth by the packages.
// This module is the single place that maps a *path* to the right treatment, so
// `scenoco validate`, the watcher, and the editor all agree on what a file is —
// rather than each re-deriving it from an extension test at its own call site.

import { parseScene } from './SceneParser.js';
import { validateAttachmentDocument } from './Validator.js';
import { compilePrefabXml, compileSceneXml, type CompileOptions } from './compile.js';
import {
  allSrcDocuments,
  srcDocumentForFile,
  srcDocumentKind,
  toParsedElement,
  type SrcDocumentDef,
} from './src-document.js';
import type { SncDiagnostic } from './diagnostics.js';

/** The asset kinds the compiler can check on its own. */
export interface AssetKindDef {
  /** The `scenoco new <kind>` name, e.g. `scene`. */
  kind: string;
  /** File suffix, e.g. `.scene.xml`. */
  extension: string;
  /** One-line summary — what `scenoco new` prints. */
  description: string;
  /** Project-relative directory new files of this kind go in. */
  dir: string;
  /** True when the file compiles to a runtime bundle (`scenoco bundle`). */
  bundles: boolean;
}

/**
 * The built-in document kinds. Package-owned formats are *not* listed here —
 * they come from the src-document registry, so this never needs editing when a
 * package adds a format (see `assetKinds`).
 */
const BUILTIN_KINDS: AssetKindDef[] = [
  {
    kind: 'scene',
    extension: '.scene.xml',
    description: 'A scene: the <Scene> root with its nodes, attachments and components',
    dir: 'assets/scenes',
    bundles: true,
  },
  {
    kind: 'prefab',
    extension: '.prefab.xml',
    description: 'A reusable node subtree, instantiable at runtime or placed with <PrefabInstance>',
    dir: 'assets/scenes',
    bundles: true,
  },
  {
    kind: 'material',
    extension: '.material.xml',
    description: 'A shared material an attachment pulls in with src=',
    dir: 'assets/materials',
    bundles: false,
  },
];

/** A package-owned `src=` format, described as an asset kind. */
function kindOfSrcDocument(def: SrcDocumentDef): AssetKindDef {
  return {
    kind: srcDocumentKind(def),
    extension: def.extension,
    description: def.description,
    dir: def.dir,
    bundles: false,
  };
}

/**
 * Every asset kind available *in this project* — built-ins plus the formats its
 * registered tag packages own. Call after `loadComponents`, or the package
 * formats are not registered yet and the list is short.
 */
export function assetKinds(): AssetKindDef[] {
  return [...BUILTIN_KINDS, ...allSrcDocuments().map(kindOfSrcDocument)];
}

/** The asset kind a path belongs to, by extension, or undefined if unrecognised. */
export function assetKindOf(file: string): AssetKindDef | undefined {
  return assetKinds().find((k) => file.endsWith(k.extension));
}

export interface ValidateResult {
  ok: boolean;
  diagnostics: SncDiagnostic[];
  /** The kind that was checked, or undefined when the extension is unrecognised. */
  kind?: AssetKindDef;
}

/**
 * Validate any SceNoCo asset file, dispatching on its extension. Scenes and
 * prefabs are compiled and thrown away (compiling *is* the deepest check);
 * materials are checked as standalone attachment documents; a package-owned
 * `src=` document is parsed and handed to the format's own compiler, so its
 * semantic diagnostics reach the CLI instead of only the XSD's structural ones.
 */
export function validateAssetXml(file: string, xml: string, options: CompileOptions = {}): ValidateResult {
  const kind = assetKindOf(file);
  if (!kind) {
    return {
      ok: false,
      diagnostics: [
        {
          line: 1,
          column: 1,
          code: 'unknown-asset-kind',
          message:
            `Not a recognised SceNoCo document. Expected one of: ` +
            assetKinds().map((k) => k.extension).join(', '),
        },
      ],
    };
  }

  // A scene or prefab: compiling is the strictest check available, so do that
  // and discard the output.
  if (kind.bundles) {
    const result = kind.kind === 'prefab' ? compilePrefabXml(xml, options) : compileSceneXml(xml, options);
    return { ok: result.ok, diagnostics: result.ok ? [] : result.diagnostics, kind };
  }

  const parsed = parseScene(xml);
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics, kind };

  if (kind.kind === 'material') {
    const diagnostics = validateAttachmentDocument(parsed.root, 'material');
    return { ok: diagnostics.length === 0, diagnostics, kind };
  }

  const def = srcDocumentForFile(file)!;
  if (parsed.root.tag !== def.root) {
    return {
      ok: false,
      diagnostics: [
        {
          line: parsed.root.line,
          column: parsed.root.column,
          code: 'bad-root',
          message: `A ${def.extension} file's root must be <${def.root}>, got <${parsed.root.tag}>`,
        },
      ],
      kind,
    };
  }
  // The format's own compiler is the only thing that understands the document;
  // it reports positions relative to the file, which it does not track, so the
  // diagnostics land on the root element.
  const result = def.compile(toParsedElement(parsed.root), { file });
  const diagnostics = (result.diagnostics ?? []).map((d) => ({
    line: parsed.root.line,
    column: parsed.root.column,
    code: d.code ?? 'src-document',
    message: d.message,
  }));
  return { ok: diagnostics.length === 0, diagnostics, kind };
}
