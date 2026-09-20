import type { ComponentInfo, ProjectModel } from '../model.js';
import { hint, nearestName, type SncDiagnostic } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue, type EmitContext } from '../dsl/value.js';
import { AssetScope, type ResolveAsset } from './assets.js';
import { buildConstruction } from './resource.js';
import { TsModule, camelCase } from './module.js';

/** The one tag a render document is rooted at. */
export const RENDER_ROOT = 'Render';

/**
 * A render document: how a scene is drawn.
 *
 * ```xml
 * <Render>
 *   <ToneMapping curve="ACESFilmicToneMapping" exposure="1.05" />
 *   <Shadows />
 *   <Bloom strength="0.75" threshold="0.72" />
 * </Render>
 * ```
 *
 * ### Why a document and not attributes on `<Scene>`
 *
 * Tone mapping, shadows and bloom belong to the **renderer**, which is not in the scene graph —
 * so putting them on `<Scene>` meant inventing properties that three.js does not have
 * (`scene.bloom`, `scene.shadows`) and could not be told apart from the ones it does. Worse, a
 * scalar needs a value that means *off*: `bloom="0"` left `bloomRadius` sitting there doing
 * nothing, which is the same silent-no-op the DSL refuses everywhere else.
 *
 * As a document it is an ordinary asset: a look is shared by every level that names it, one
 * file to tune, and each effect is either written or not written. `<Scene>` keeps exactly the
 * properties `THREE.Scene` declares, plus a short, closed list of the engine's own.
 */
export function emitRender(
  root: SncElement,
  options: {
    name: string;
    model: ProjectModel;
    source: string;
    resolveAsset?: ResolveAsset;
  },
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { name, model, source } = options;
  const module = new TsModule(
    `// GENERATED from ${source} — do not edit.\n// Regenerate with \`scenoco build\`.`,
  );

  if (root.tag !== RENDER_ROOT) {
    module.report(
      at(root, 'bad-root', `A render document is rooted at <${RENDER_ROOT}>, not <${root.tag}>.`),
    );
    return { diagnostics: module.diagnostics };
  }
  for (const [attribute] of root.attributes) {
    if (attribute.includes(':')) continue;
    module.report(
      at(
        root,
        'unknown-attribute',
        `<${RENDER_ROOT}> takes no attributes — "${attribute}" belongs on one of the effects ` +
          'inside it.',
      ),
    );
  }

  const assets = new AssetScope(module, options.resolveAsset ?? (() => undefined));
  const context: EmitContext = {
    require: (m, n) => module.require(m, n),
    nodeRef: () => undefined, // a render document has no nodes to reference
    assetRef: (href) => assets.reference(href),
    nearAsset: (href) => assets.near(href),
    assetType: (href) => assets.typeOf(href),
  };

  const locals: string[] = [];
  let fog: string | undefined;
  for (const element of root.children) {
    // Two kinds of child, and a document does not have to know which is which: `<Fog>` is
    // three.js's own class and `<Bloom>` is a package's, exactly as `<Mesh>` and
    // `<RigidBody2D>` are in a scene.
    const tag = model.tags.find((t) => t.name === element.tag && t.family === 'fog');
    if (tag) {
      if (fog) {
        module.report(at(element, 'duplicate-fog', 'A scene has one fog; this is the second.'));
        continue;
      }
      const { call } = buildConstruction(tag, element, module, context);
      fog = module.declare(camelCase(element.tag));
      module.line(`const ${fog} = ${call};`);
      continue;
    }
    const local = emitEffect(element, model, module, context);
    if (local) locals.push(local);
  }

  const RenderSettings = module.require('@scenoco-three/core', 'RenderSettings');
  const local = module.declare(camelCase(name));
  module.line(`/** \`${source}\` */`);
  module.line(
    `export const ${local} = new ${RenderSettings}([${locals.join(', ')}]${fog ? `, ${fog}` : ''});`,
  );
  return { code: module.render(), diagnostics: module.diagnostics };
}

/** One `<Bloom strength="0.75" />` — an effect class, constructed and configured. */
function emitEffect(
  element: SncElement,
  model: ProjectModel,
  module: TsModule,
  context: EmitContext,
): string | undefined {
  const effect = model.effects.find((e) => e.name === element.tag);
  if (!effect) {
    const advice = hint({
      near: nearestName(element.tag, model.effects.map((e) => e.name)),
      as: 'tag',
      ask: element.tag,
    });
    module.report(
      at(
        element,
        'unknown-effect',
        `<${element.tag}> is not an effect in this project.` +
          // Not a `describe` pointer: an effect that is missing is usually a *package* that is
          // missing, and no amount of describing the project will say so.
          (advice.text ||
            ' Effects come from a package — @scenoco-three/postfx provides <ToneMapping>, ' +
              '<Shadows>, <Bloom> and <Vignette>.'),
      ),
    );
    return undefined;
  }
  if (element.children.length > 0) {
    module.report(
      at(element.children[0]!, 'unexpected-child', `<${effect.name}> is a single element with no children.`),
    );
  }

  const local = module.declare(camelCase(effect.name));
  const type = module.require(effect.module ?? effect.file, effect.name);
  module.line(`const ${local} = new ${type}();`);
  for (const [attribute, text] of element.attributes) {
    if (attribute.includes(':')) continue;
    const field = effect.fields.find((f) => f.name === attribute);
    if (!field) {
      const advice = hint({
        near: nearestName(attribute, effect.fields.map((f) => f.name)),
        as: 'attribute',
        ask: effect.name,
        takes: effect.fields.map((f) => f.name),
      });
      module.report(
        at(
          element,
          'unknown-attribute',
          `<${effect.name}> has no field "${attribute}".${advice.text}`,
          advice.ask,
        ),
      );
      continue;
    }
    const emitted = emitValue(field, text, element, context);
    module.reportAll(emitted.diagnostics);
    if (emitted.code) module.line(`${local}.${attribute} = ${emitted.code};`);
  }
  requireFields(element, effect, module);
  return local;
}

/** A field with no initializer is one the class cannot supply for itself. */
function requireFields(element: SncElement, effect: ComponentInfo, module: TsModule): void {
  for (const field of effect.fields) {
    if (!field.required || element.attributes.has(field.name)) continue;
    module.report(
      at(
        element,
        'missing-attribute',
        `<${effect.name}> requires "${field.name}" — it is declared with no default, so nothing ` +
          'else can supply it.',
      ),
    );
  }
}

function at(element: SncElement, code: string, message: string, ask?: string): SncDiagnostic {
  return {
    line: element.line,
    column: element.column,
    code,
    message,
    ...(element.file ? { file: element.file } : {}),
    ...(ask !== undefined ? { ask } : {}),
  };
}
