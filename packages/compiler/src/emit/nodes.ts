import { nearestName } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue } from '../dsl/value.js';
import { buildConstruction } from './resource.js';
import { camelCase } from './module.js';
import type { TagInfo } from '../model.js';
import { applyPersistence } from './persistence.js';
import { emitSpawn } from './spawn.js';
import type { EmitScope } from './scope.js';
import {
  PERSIST,
  PLACEMENT,
  PLACEMENT_ORDER,
  STRUCTURAL,
  placementStatement,
  uniformScale,
} from './placement.js';


// --- nodes -----------------------------------------------------------------------------

/** Emit one node element and everything under it, appending to `out`. */
export function emitNode(scope: EmitScope, element: SncElement, parent: string, out: string[]): void {
  // `<Components>` is handled in the wiring pass and `<Systems>` before the tree is built;
  // neither is a node.
  if (element.tag === 'Components' || element.tag === 'Systems') return;

  if (element.tag === 'Prefab') {
    emitSpawn(scope, element, parent, out);
    return;
  }
  // `<Override>` belongs to a `<Prefab>`, which reads its own children.
  if (element.tag === 'Override') {
    scope.report(
      element,
      'misplaced-override',
      '<Override> patches a spawned prefab, so it belongs inside the <Prefab> element it ' +
        'overrides — not in the tree on its own.',
    );
    return;
  }

  // A bare element in a document is a **node**: that is what a scene document is, a tree.
  // `Fog` is not one, so it is not written here — it goes in a render document, with the tone
  // curve and the bloom it works alongside.
  if (scope.options.model.tags.some((t) => t.name === element.tag && t.family === 'fog')) {
    scope.report(
      element,
      'misplaced-fog',
      `<${element.tag}> is not a node, and every bare element here is one. Fog belongs in a ` +
        'render document — `<Render><Fog color="…" near="…" far="…" /></Render>` — which a ' +
        'scene names with <Scene render="…">.',
    );
    return;
  }

  const tag = scope.tagFor(element, 'node');
  if (!tag) return;

  const { attached, nodes } = partitionChildren(scope, element, tag, out);

  const { call, assignments } = buildConstruction(
    tag,
    element,
    scope.module,
    scope.context,
    STRUCTURAL,
    attached,
  );
  const placed = scope.place(element, tag.name, tag);

  out.push(`${scope.declaration(placed)} = ${call};`);
  scope.stamp(element, placed.reference, out);
  for (const assignment of assignments) out.push(`${placed.reference}.${assignment}`);
  applyPlacement(scope, element, placed.reference, out);
  for (const child of nodes) emitNode(scope, child, placed.reference, out);
  out.push(`${parent}.add(${placed.reference});`);
}

// --- attached objects ------------------------------------------------------------------

/**
 * Split an element's children into the objects this node is built *from* and the nodes below it,
 * emitting the former and returning the constructor slot each fills.
 *
 * `<Mesh><MeshStandardMaterial/></Mesh>` is `new Mesh(geo, new MeshStandardMaterial())`, so the
 * node gets its own; naming a file reaches the shared one. A child matches a parameter by family,
 * and **only** a parameter: every `Object3D` has Material-typed properties
 * (`customDepthMaterial`), so matching those would quietly accept a material on a light.
 */
export function partitionChildren(
  scope: EmitScope,
  element: SncElement,
  tag: TagInfo,
  out: string[],
): { attached: Map<string, string>; nodes: SncElement[] } {
  const nodes: SncElement[] = [];
  const codesBySlot = new Map<string, string[]>();

  for (const child of element.children) {
    const childTag = scope.options.model.tags.find((t) => t.name === child.tag);
    // A node, a block (`<Components>`), or an unknown tag: `emitNode` handles all three.
    if (!childTag || childTag.family === 'node') {
      nodes.push(child);
      continue;
    }

    const slot = tag.parameters.find((p) => p.assetFamily === childTag.family);
    if (!slot) {
      scope.report(
        child,
        'unattachable',
        `<${tag.name}> is not built from a ${childTag.family}, so <${child.tag}> cannot go ` +
          `inside it. Its constructor is (${tag.parameters.map((p) => p.name).join(', ')}).`,
      );
      continue;
    }

    const { call, assignments } = buildConstruction(childTag, child, scope.module, scope.context);
    const local = scope.module.declare(camelCase(childTag.name));
    out.push(`const ${local} = ${call};`);
    scope.stamp(child, local, out);
    for (const assignment of assignments) out.push(`${local}.${assignment}`);

    const codes = codesBySlot.get(slot.name) ?? [];
    codes.push(local);
    codesBySlot.set(slot.name, codes);
  }

  const attached = new Map<string, string>();
  for (const [name, codes] of codesBySlot) {
    const slot = tag.parameters.find((p) => p.name === name)!;
    if (codes.length === 1) {
      attached.set(name, codes[0]!);
    } else if (slot.list) {
      // Document order is slot order, which is how three.js reads a geometry's groups.
      attached.set(name, `[${codes.join(', ')}]`);
    } else {
      scope.report(
        element,
        'one-only',
        `<${tag.name}> takes one ${slot.assetFamily ?? slot.name}, not ${codes.length}. ` +
          `Only a slot declared ${slot.type} takes a list.`,
      );
    }
  }
  return { attached, nodes };
}

export function applyPlacement(
  scope: EmitScope,
  element: SncElement,
  target: string,
  out: string[],
  isSceneRoot = false,
): void {
  // A scene root reaches its own `dontDestroyOnLoad` as a property, through the settings pass
  // below — it *is* the scene that survives, rather than something moved out of one.
  if (!isSceneRoot) applyPersistence(scope, element, target, out);
  for (const attribute of PLACEMENT_ORDER) {
    const text = element.attributes.get(attribute);
    if (text === undefined) continue;
    const prop = PLACEMENT[attribute]!;
    if (attribute === 'scale') {
      const uniform = uniformScale(text);
      if (uniform !== undefined) {
        out.push(`${target}.scale.setScalar(${uniform});`);
        continue;
      }
    }
    const emitted = emitValue(prop, text, element, scope.context);
    scope.module.reportAll(emitted.diagnostics);
    if (emitted.code) out.push(placementStatement(attribute, emitted.code, target));
  }
}

/**
 * The `<Scene>` root's attributes.
 *
 * Two closed sources, and a document does not have to guess which one an attribute came from
 * — it only has to write it:
 *
 *  - **three.js's own `Scene` properties**, read from its declarations exactly as a mesh's
 *    are: `background`, `environment`, `backgroundBlurriness`. Anything three.js declares is
 *    an attribute here for free, and anything it does not is an error.
 *  - **the engine's four**, listed in `SCENE_ATTRIBUTES`: `camera`, `render`,
 *    `dontDestroyOnLoad`, `disposeOnUnload`.
 *
 * Nothing else. Tone mapping, shadows, bloom and fog were properties grafted onto `Scene`
 * here, indistinguishable from three.js's own and — in bloom's case — needing a value that
 * meant "off". They live in a render document now, which a scene names with `render="…"`.
 *
 * Before any of this existed an unknown `<Scene>` attribute was **silently dropped**, which
 * is the worst outcome the DSL has: `background` looked set and the screen stayed black.
 */
