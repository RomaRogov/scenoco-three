import { nearestName } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue } from '../dsl/value.js';
import type { PrefabSurface, PrefabTarget } from './assets.js';
import { applyPersistence } from './persistence.js';
import { emitComponent } from './wiring.js';
import type { EmitScope } from './scope.js';
import { camelCaseOf, nonSerializedMessage } from './wiring.js';
import { PERSIST, PLACEMENT, placementStatement, uniformScale } from './placement.js';
import { sanitizeIdentifier } from './module.js';

export function emitSpawn(scope: EmitScope, element: SncElement, parent: string, out: string[]): void {
  scope.from(out, element);
  const href = element.attributes.get('src');
  if (!href) {
    scope.report(element, 'missing-src', '<Prefab> needs a src= naming the prefab document.');
    return;
  }
  const asset = scope.assets.lookup(href);
  // A glTF is a prefab that came from a file: it spawns through the same verb, with the same
  // placement and no wrapper node, so `<Prefab src>` takes either. The one difference is that
  // the file has to have arrived, which is what `AssetScope` records.
  const isModel = asset?.kind === 'file' && asset.await && asset.helper.name === 'sharedModel';
  if (asset?.kind === 'scene') {
    scope.report(
      element,
      'not-a-prefab',
      `src="${href}" is a scene, and a scene is loaded rather than spawned. Load it with ` +
        'SceneManager.load, or give a component a field declared `SceneType` and point it ' +
        'at this path.',
    );
    return;
  }
  if (!asset || (asset.kind !== 'prefab' && !isModel)) {
    // Offered only when it is a prefab from here: the same check the spawn itself makes.
    const near = asset ? undefined : scope.assets.near(href);
    const fits = near !== undefined && scope.assets.lookup(near)?.kind === 'prefab';
    scope.report(
      element,
      'unknown-asset',
      `src="${href}" does not resolve to a prefab document or a model file in this project.` +
        (fits ? ` Paths are relative to this document. Write src="${near}".` : ''),
    );
    return;
  }
  const local = scope.assets.reference(href)!;
  // A model instantiates as whatever its root is; a prefab class is its own type. Either way
  // the field an `id` produces has to be typed with something the generated file can name.
  const placed = scope.place(element, isModel ? scope.module.require('three', 'Object3D') : local);

  const entries: string[] = [];
  for (const [attribute, text] of element.attributes) {
    if (attribute === 'src' || attribute === 'id' || attribute === PERSIST) continue;
    if (attribute.includes(':')) continue;
    const prop = PLACEMENT[attribute];
    if (!prop) {
      scope.report(
        element,
        'unknown-attribute',
        `<Prefab> has no attribute "${attribute}". A spawn takes src, the placement ` +
          `attributes and ${PERSIST}; to change something inside the prefab, write ` +
          '<Override target="#id" …> in it.',
      );
      continue;
    }
    const emitted =
      attribute === 'scale' && uniformScale(text) !== undefined
        ? { code: uniformScale(text)!, diagnostics: [] }
        : emitValue(prop, text, element, scope.context);
    scope.module.reportAll(emitted.diagnostics);
    if (emitted.code) entries.push(`${attribute}: ${emitted.code}`);
  }

  const overrides = emitOverrides(scope, 
    element,
    asset.kind === 'prefab' ? asset.surface : undefined,
    local,
  );
  // `undefined` rather than nothing when a spawn has overrides but no placement: the callback
  // is the *third* argument, and sliding it into `init`'s slot would apply it as settings.
  const init =
    entries.length > 0
      ? `, { ${entries.join(', ')} }`
      : overrides.length > 0
        ? ', undefined'
        : '';
  if (overrides.length === 0) {
    out.push(`${scope.declaration(placed)} = ${parent}.instantiate(${local}${init});`);
  } else {
    out.push(`${scope.declaration(placed)} = ${parent}.instantiate(${local}${init}, (${overrides[0]}) => {`);
    for (const line of overrides.slice(1)) out.push(`  ${line}`);
    out.push('});');
  }
  // The spawn site, not the prefab's own root: the prefab stamped that itself, and this is the
  // `<Prefab>` element a click on the instance should select in *this* document.
  scope.stamp(element, placed.reference, out);
  applyPersistence(scope, element, placed.reference, out);
}

/**
 * `<Override target="#label" text="GO">` — the one way into a prefab from outside it.
 *
 * ### What it is for
 *
 * A prefab exists to be spawned many times, and the instances differ. Without overrides the
 * only way to vary one is to copy the whole document, which is how a three-brick game ends up
 * with three near-identical prefab files — and how a value that belongs to the ball
 * (`ballSpeed`) ends up on the level's rules object instead, because there was nowhere else to
 * put it. Unity and Cocos both answer this the same way.
 *
 * ### How it is checked
 *
 * A target is an **id inside the prefab**, and the prefab's own document says which ids exist
 * and what each one is; from there the attribute is checked against the same field list that
 * would check it if it had been written in the prefab itself. So `target="#lable"` is a build
 * error naming the near miss, `hits="lots"` is a build error saying it wants a number, and
 * an override of something the prefab does not expose is a build error listing what it does.
 * Nothing here defers to `tsc` on the generated file — though that catches it too, since the
 * emitted assignment is ordinary typed code.
 *
 * Returns the lines of the `configure` callback, the first of which is the parameter name, or
 * an empty array when there is nothing to override.
 */
export function emitOverrides(
  scope: EmitScope,
  element: SncElement,
  surface: PrefabSurface | undefined,
  prefabLocal: string,
): string[] {
  const overrides = element.children.filter((child) => child.tag !== 'Components');
  if (overrides.length === 0) return [];

  const instance = scope.module.declare(camelCaseOf(prefabLocal));
  const lines: string[] = [instance];
  for (const child of overrides) {
    if (child.tag !== 'Override') {
      scope.report(
        child,
        'unexpected-child',
        `<Prefab> takes <Override> children and nothing else; <${child.tag}> would be built ` +
          'nowhere. To add a node under the instance, put it in the prefab document.',
      );
      continue;
    }
    emitOverride(scope, child, surface, instance, lines);
  }
  return lines.length > 1 ? lines : [];
}

export function emitOverride(
  scope: EmitScope,
  element: SncElement,
  surface: PrefabSurface | undefined,
  instance: string,
  out: string[],
): void {
  const href = element.attributes.get('target');
  if (!href) {
    scope.report(
      element,
      'missing-target',
      '<Override> needs target="#id", naming something the prefab declares an id for.',
    );
    return;
  }
  const id = href.trim().replace(/^#/, '');
  const target = surface?.ids.get(id);
  if (!target) {
    const known = [...(surface?.ids.keys() ?? [])];
    const suggestion = nearestName(id, known);
    scope.report(
      element,
      'unknown-target',
      `target="${href}" names "${id}", which the prefab does not declare.` +
        (suggestion
          ? ` Did you mean "#${suggestion}"?`
          : known.length > 0
            ? ` It declares: ${known.map((k) => `#${k}`).join(', ')}.`
            : ' It declares no ids, so there is nothing to override — give the thing you want ' +
              'to change an id in the prefab document.'),
    );
    return;
  }
  if (target.kind === 'prefab') {
    scope.report(
      element,
      'nested-override',
      `target="${href}" is itself a spawned prefab. Override its values where it is spawned, ` +
        'inside the prefab document that spawns it.',
    );
    return;
  }

  // The root *is* the instance — a prefab class has no field pointing at itself.
  const reference = target.root ? instance : `${instance}.${sanitizeIdentifier(id)}`;
  let wrote = false;
  for (const [attribute, text] of element.attributes) {
    if (attribute === 'target' || attribute.includes(':')) continue;
    const statement = overrideStatement(scope, element, target, reference, attribute, text);
    if (!statement) continue;
    out.push(statement);
    wrote = true;
  }
  // A camera caches its projection, so an overridden `fov` or `near` would otherwise be
  // written and ignored. One call after the fact costs nothing and removes the trap.
  if (wrote && target.kind === 'node') {
    const tag = scope.options.model.tags.find((t) => t.name === target.tag);
    if (tag?.bases.includes('Camera')) out.push(`${reference}.updateProjectionMatrix();`);
  }
  if (!wrote && element.attributes.size <= 1) {
    scope.report(
      element,
      'empty-override',
      `<Override target="${href}"> sets nothing. Add the attribute you meant to change.`,
    );
  }
}

/** One overridden attribute, checked against whatever the target really is. */
export function overrideStatement(
  scope: EmitScope,
  element: SncElement,
  target: PrefabTarget,
  reference: string,
  attribute: string,
  text: string,
): string | undefined {
  if (target.kind === 'component') {
    const component = scope.options.model.components.find((c) => c.name === target.tag);
    const field = component?.fields.find((f) => f.name === attribute);
    if (!field && component?.nonSerialized?.includes(attribute)) {
      scope.report(element, 'non-serialized', nonSerializedMessage(`<${target.tag}>`, component, attribute));
      return undefined;
    }
    if (!field) {
      const suggestion = nearestName(attribute, component?.fields.map((f) => f.name) ?? []);
      scope.report(
        element,
        'unknown-attribute',
        `<${target.tag}> has no field "${attribute}".` +
          (suggestion ? ` Did you mean "${suggestion}"?` : ''),
      );
      return undefined;
    }
    const emitted = emitValue(field, text, element, scope.context);
    scope.module.reportAll(emitted.diagnostics);
    return emitted.code ? `${reference}.${attribute} = ${emitted.code};` : undefined;
  }

  const placement = PLACEMENT[attribute];
  if (placement) {
    const emitted =
      attribute === 'scale' && uniformScale(text) !== undefined
        ? { code: `${uniformScale(text)!}`, diagnostics: [] }
        : emitValue(placement, text, element, scope.context);
    scope.module.reportAll(emitted.diagnostics);
    if (!emitted.code) return undefined;
    if (attribute === 'scale' && uniformScale(text) !== undefined) {
      return `${reference}.scale.setScalar(${emitted.code});`;
    }
    return placementStatement(attribute, emitted.code, reference);
  }

  const tag = scope.options.model.tags.find((t) => t.name === target.tag);
  // A constructor parameter counts. `<Mesh geometry material>` passes both to `new Mesh(…)`
  // in the prefab, and swapping the material of one spawned brick is the most ordinary
  // override there is — three.js re-reads `mesh.material` every frame, so the assignment is
  // real. The exceptions are the few slots three.js reads exactly once (an `InstancedMesh`'s
  // count); those assign without effect, which is the same thing they do in hand-written code.
  const property =
    tag?.properties.find((p) => p.name === attribute) ??
    tag?.parameters.find((p) => p.name === attribute);
  if (!property) {
    const names = [...(tag?.properties ?? []), ...(tag?.parameters ?? [])].map((p) => p.name).concat(Object.keys(PLACEMENT));
    const suggestion = nearestName(attribute, names);
    scope.report(
      element,
      'unknown-attribute',
      `<${target.tag}> has no attribute "${attribute}".` +
        (suggestion ? ` Did you mean "${suggestion}"?` : ''),
    );
    return undefined;
  }
  const emitted = emitValue(property, text, element, scope.context);
  scope.module.reportAll(emitted.diagnostics);
  return emitted.code ? `${reference}.${attribute} = ${emitted.code};` : undefined;
}

/**
 * Apply the shared placement attributes to an already-constructed node.
 *
 * Iterates `PLACEMENT_ORDER`, never the document's attribute order: `setActive` also writes
 * `visible`, so document order would let two identical-looking documents mean different
 * things.
 */
