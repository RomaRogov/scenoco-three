import { fileKindOf } from '../assets.js';
import { nearestName, type SncDiagnostic } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue, quote, type EmitContext } from '../dsl/value.js';
import type { ProjectModel, PropInfo } from '../model.js';
import { TsModule, camelCase } from './module.js';

/**
 * A texture document: one image, plus how to sample it.
 *
 * ```xml
 * <!-- assets/textures/brick.texture.xml -->
 * <Texture src="brick.png" colorSpace="SRGBColorSpace" wrapS="RepeatWrapping" anisotropy="8" />
 * ```
 *
 * This is the one resource document that earns its existence. An image, a model and a sound all
 * have a path and nothing to author, so a document is named straight at the file — but a texture
 * has real settings, they belong to the texture rather than to whoever uses it, and getting
 * `colorSpace` wrong is the single most common way a three.js scene comes out looking washed
 * out.
 *
 * The root is always `<Texture>`, like a particle document's `<ParticleSystem>`. `src` is
 * structural — the file this document is about — exactly as it is on `<Prefab src>`. Every other
 * attribute is a property of three.js's own `Texture`, read from its declaration, so the
 * vocabulary tracks a three.js upgrade with no edit here.
 */
export function emitTexture(
  root: SncElement,
  options: { name: string; model: ProjectModel; source: string },
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { name, model, source } = options;
  const module = new TsModule(
    `// GENERATED from ${source} — do not edit.\n// Regenerate with \`scenoco build\`.`,
  );
  const at = (element: SncElement, code: string, message: string): SncDiagnostic => ({
    line: element.line,
    column: element.column,
    code,
    message,
    ...(source ? { file: source } : {}),
  });

  if (root.tag !== 'Texture') {
    module.report(at(root, 'bad-root', `A texture document is rooted at <Texture>, not <${root.tag}>.`));
    return { diagnostics: module.diagnostics };
  }
  if (root.children.length > 0) {
    module.report(
      at(root.children[0]!, 'unexpected-child', 'A texture document is a single <Texture> element; it has no children.'),
    );
  }

  const href = root.attributes.get('src');
  if (href === undefined) {
    module.report(at(root, 'missing-src', '<Texture> needs a src= naming the image file.'));
    return { diagnostics: module.diagnostics };
  }
  if (!fileKindOf(href)) {
    module.report(
      at(root, 'unknown-asset', `src="${href}" is not an image this project knows how to load.`),
    );
    return { diagnostics: module.diagnostics };
  }

  // Both halves of what three.js declares. `wrapS` and `colorSpace` are *constructor*
  // parameters of `Texture` while `repeat` and `flipY` are plain properties, and a document
  // draws no such distinction: this builds the texture through a loader rather than the
  // constructor, so every one of them is set afterwards regardless. `src` is in neither list,
  // which is why it is handled above.
  const tag = model.tags.find((t) => t.name === 'Texture');
  const byName = new Map<string, PropInfo>();
  for (const parameter of tag?.parameters ?? []) byName.set(parameter.name, parameter);
  for (const property of tag?.properties ?? []) byName.set(property.name, property);

  const context: EmitContext = {
    require: (m, n) => module.require(m, n),
    nodeRef: () => undefined,
    assetRef: () => undefined,
  };

  const settings: string[] = [];
  for (const [attribute, text] of root.attributes) {
    if (attribute === 'src' || attribute.includes(':')) continue;
    const prop = byName.get(attribute);
    if (!prop || !SETTABLE.has(attribute)) {
      const suggestion = nearestName(attribute, [...SETTABLE]);
      module.report(
        at(root, 'unknown-attribute', `<Texture> has no setting "${attribute}".` +
          (suggestion ? ` Did you mean "${suggestion}"?` : '')),
      );
      continue;
    }
    const emitted = emitValue(prop, text, root, context);
    module.reportAll(emitted.diagnostics);
    if (emitted.code) settings.push(`${attribute}: ${emitted.code},`);
  }

  const local = module.declare(camelCase(name));
  const sharedTexture = module.require('@scenoco-three/core', 'sharedTexture');
  const url = `new URL(${quote(href)}, import.meta.url).href`;

  module.line(`/** \`${source}\` */`);
  if (settings.length === 0) {
    module.line(`export const ${local} = ${sharedTexture}(${url});`);
  } else {
    module.block(`export const ${local} = ${sharedTexture}(${url}, {`, () => {
      for (const setting of settings.sort()) module.line(setting);
    }, '});');
  }

  return { code: module.render(), diagnostics: module.diagnostics };
}

/**
 * What a document may set.
 *
 * Deliberately not every property three.js declares on `Texture`: `image`, `source`, `mipmaps`,
 * `version` and friends are the loaded data, not settings, and a document that could write them
 * could contradict the file it names. This is the same list `TextureSettings` declares in core —
 * the runtime side of the same decision.
 */
const SETTABLE = new Set([
  'colorSpace',
  'wrapS',
  'wrapT',
  'magFilter',
  'minFilter',
  'anisotropy',
  'flipY',
  'generateMipmaps',
  'premultiplyAlpha',
  'repeat',
  'offset',
  'center',
  'rotation',
  'name',
]);
