import type { ComponentInfo, TagInfo } from '../model.js';
import { hint, nearestName } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue } from '../dsl/value.js';
import { isCamera } from './scene.js';
import { moduleFor, type EmitScope } from './scope.js';
import { sanitizeIdentifier } from './module.js';

// --- components ------------------------------------------------------------------------

/**
 * Walk the whole document again and emit every `<Components>` block.
 *
 * Separate from the node pass so that a component may reference any node in the document,
 * not only one declared before it.
 */
export function emitComponentsFor(scope: EmitScope, element: SncElement, self: string, out: string[]): void {
  // First pass over the subtree: give every component with an id a name to be referenced by,
  // so a component can hold another component the same way it holds a node.
  claimComponentIds(scope, element, self);
  walkComponents(scope, element, self, out);
}

function claimComponentIds(scope: EmitScope, element: SncElement, self: string): void {
  for (const child of element.children) {
    if (child.tag === 'Systems') continue;
    if (child.tag === 'Components') {
      for (const componentElement of child.children) {
        const id = componentElement.attributes.get('id');
        if (!id) continue;
        scope.componentsById.set(id, {
          reference: `this.${sanitizeIdentifier(id)}`,
          typeName: componentElement.tag,
        });
      }
      continue;
    }
    const placed = scope.placedFor(child);
    if (child.tag === 'Prefab') {
      // A spawn takes a `<Components>` block of its own: the instance is a node like any
      // other, and adding behaviour to *this* copy of a prefab is not an override of
      // anything. Its other children are `<Override>`s, which are not components.
      for (const block of child.children) {
        if (block.tag !== 'Components') continue;
        for (const componentElement of block.children) {
          const id = componentElement.attributes.get('id');
          if (!id) continue;
          scope.componentsById.set(id, {
            reference: `this.${sanitizeIdentifier(id)}`,
            typeName: componentElement.tag,
          });
        }
      }
      continue;
    }
    claimComponentIds(scope, child, placed?.reference ?? self);
  }
}

function walkComponents(scope: EmitScope, element: SncElement, self: string, out: string[]): void {
  for (const child of element.children) {
    if (child.tag === 'Systems') continue;
    if (child.tag === 'Components') {
      for (const componentElement of child.children) emitComponent(scope, componentElement, self, out);
      continue;
    }
    const placed = scope.placedFor(child);
    if (child.tag === 'Prefab') {
      if (!placed) continue;
      for (const block of child.children) {
        if (block.tag !== 'Components') continue;
        for (const componentElement of block.children) {
          emitComponent(scope, componentElement, placed.reference, out);
        }
      }
      continue;
    }
    if (placed) walkComponents(scope, child, placed.reference, out);
  }
}

/** `<Systems>` at the scene root — the scene-level counterpart of `<Components>` on a node. */
export function emitSystems(scope: EmitScope, root: SncElement, create: string[], wire: string[]): void {
  for (const child of root.children) {
    if (child.tag !== 'Systems') continue;
    for (const element of child.children) emitSystem(scope, element, create, wire);
  }
  // Anywhere but the scene root, the block would be read by nobody. An ignored block is the
  // worst outcome here: the document looks right and the world is missing.
  reportMisplacedSystems(scope, root);
  reportMisplacedCanvas(scope, root);
}

/**
 * A `<Canvas>` that is not under a camera, which lays out nothing.
 *
 * The same failure as a misplaced `<Systems>` block and the same reason to catch it here: the
 * document reads correctly, the compiler is happy, and the screen is empty. A screen-space
 * canvas is sized from a camera's frustum, so it has to hang off one — and the runtime says so
 * to the console, which is exactly where nobody is looking.
 */
function reportMisplacedCanvas(scope: EmitScope, root: SncElement): void {
  const canvas = scope.options.model.tags.find(
    (tag) => tag.name === 'Canvas' && tag.module !== 'three',
  );
  if (!canvas) return;

  // The camera to name in the message: the one the scene will render through, else any camera in
  // the document. Naming the id is the difference between "move it" and the text to write.
  const cameras = [...scope.byElement.values()].filter(isCamera);
  const named = cameras.find((placed) => placed.element.attributes.get('id'));
  const where = named
    ? ` Move it inside <${named.element.tag} id="${named.element.attributes.get('id')!}">.`
    : '';

  const visit = (element: SncElement): void => {
    for (const child of element.children) {
      if (child.tag === canvas.name) {
        const parent = scope.byElement.get(element);
        if (!parent || !isCamera(parent)) {
          scope.report(
            child,
            'misplaced-canvas',
            `<${canvas.name}> lays out in screen pixels in front of a camera, so it has to be a ` +
              `child of the camera node — it cannot hang off <${element.tag}>.${where}`,
          );
        }
        continue;
      }
      visit(child);
    }
  };
  visit(root);
}

/** Walk everything below the root looking for a `<Systems>` block that will never be read. */
function reportMisplacedSystems(scope: EmitScope, root: SncElement): void {
  const visit = (element: SncElement): void => {
    for (const child of element.children) {
      if (child.tag === 'Systems') {
        scope.report(
          child,
          'misplaced-systems',
          '<Systems> is only read at the scene root — a system serves the whole scene, so it ' +
            `cannot hang off <${element.tag}>. Move the block up to <Scene>.`,
        );
        continue;
      }
      visit(child);
    }
  };
  for (const child of root.children) {
    if (child.tag !== 'Systems') visit(child);
  }
}

function emitSystem(scope: EmitScope, element: SncElement, create: string[], wire: string[]): void {
  const system = scope.options.model.systems.find((c) => c.name === element.tag);
  if (!system) {
    const advice = hint({
      near: nearestName(element.tag, scope.options.model.systems.map((c) => c.name)),
      as: 'tag',
      ask: element.tag,
    });
    scope.report(
      element,
      'unknown-system',
      `<${element.tag}> is not a system in this project.${advice.text}`,
      advice.ask,
    );
    return;
  }
  const local = scope.module.require(moduleFor(system), system.name);
  const { entries, deferred } = readFields(scope, element, system, `system <${system.name}>`, true);
  const init = entries.length > 0 ? `, { ${entries.join(', ')} }` : '';

  if (deferred.length === 0) {
    create.push(`this.addSystem(${local}${init});`);
    return;
  }
  // A system that names a node needs a handle to assign it to. The system is still added
  // first — it has to be, so a component's `awake` finds it — and the references land after
  // the tree, which is why `System.start()` exists.
  const handle = scope.module.declare(camelCaseOf(system.name));
  create.push(`const ${handle} = this.addSystem(${local}${init});`);
  for (const { name, code } of deferred) wire.push(`${handle}.${name} = ${code};`);
}

/**
 * Why a field the class declares is still not an attribute: its author said so. Worded apart from
 * "no such field", because the fix is not a spelling — it is setting the value from code.
 */
export function nonSerializedMessage(what: string, info: ComponentInfo, attribute: string): string {
  return (
    `${what} keeps "${attribute}" out of documents — ${info.name} marks it @nonSerialized, ` +
    'as state it manages itself. Set it from code rather than from the document.'
  );
}

/**
 * Read an element's attributes against a class's serialized fields.
 *
 * Shared by components and systems because the two are authored identically — public fields,
 * derived types, no decorators — and a second copy of this would be the place they drifted.
 */
function readFields(
  scope: EmitScope,
  element: SncElement,
  info: ComponentInfo,
  what: string,
  deferNodeRefs = false,
): { entries: string[]; deferred: Array<{ name: string; code: string }> } {
  const entries: string[] = [];
  const deferred: Array<{ name: string; code: string }> = [];
  const seen = new Set<string>();

  for (const [attribute, text] of element.attributes) {
    if (attribute === 'id' || attribute.includes(':')) continue;
    const field = info.fields.find((f) => f.name === attribute);
    if (!field && info.nonSerialized?.includes(attribute)) {
      scope.report(element, 'non-serialized', nonSerializedMessage(what, info, attribute));
      continue;
    }
    if (!field) {
      const advice = hint({
        near: nearestName(attribute, info.fields.map((f) => f.name)),
        as: 'attribute',
        ask: info.name,
        takes: info.fields.map((f) => f.name),
      });
      scope.report(
        element,
        'unknown-attribute',
        `${what} has no field "${attribute}".${advice.text}`,
        advice.ask,
      );
      continue;
    }
    seen.add(attribute);
    const emitted = emitValue(field, text, element, scope.context);
    scope.module.reportAll(emitted.diagnostics);
    if (!emitted.code) continue;
    if (deferNodeRefs && referencesNode(field)) deferred.push({ name: attribute, code: emitted.code });
    else entries.push(`${attribute}: ${emitted.code}`);
  }

  // A field with no initializer is one the class cannot supply for itself, so leaving it out
  // is a missing value rather than "take the default".
  for (const field of info.fields) {
    if (field.required && !seen.has(field.name)) {
      scope.report(
        element,
        'missing-attribute',
        `${what} requires "${field.name}" — it is declared \`${field.name}!: ${field.type}\` ` +
          'with no default, so nothing else can supply it.',
      );
    }
  }
  return { entries, deferred };
}

export function emitComponent(scope: EmitScope, element: SncElement, host: string, out: string[]): void {
  const component = scope.options.model.components.find((c) => c.name === element.tag);
  if (!component) {
    const names = scope.options.model.components.map((c) => c.name);
    const advice = hint({ near: nearestName(element.tag, names), as: 'tag', ask: element.tag });
    scope.report(
      element,
      'unknown-component',
      `<${element.tag}> is not a component in this project.${advice.text}`,
      advice.ask,
    );
    return;
  }
  checkHost(scope, element, component, host);

  const local = scope.module.require(moduleFor(component), component.name);
  const { entries } = readFields(scope, element, component, `<${component.name}>`);

  const init = entries.length > 0 ? `, { ${entries.join(', ')} }` : '';
  const id = element.attributes.get('id');
  const target = id ? `this.${sanitizeIdentifier(id)} = ` : '';
  out.push(`${target}${host}.addComponent(${local}${init});`);
}

/** `class Flicker extends Component<PointLight>` may only go on a `PointLight`. */
function checkHost(scope: EmitScope, element: SncElement, component: ComponentInfo, host: string): void {
  if (!component.requiresNode) return;
  const hostTag = [...scope.byElement.values()].find((p) => p.reference === host)?.tag;
  if (!hostTag) return; // an unnamed local or `this`; `tsc` still catches it in the output
  const chain = [hostTag.name, ...hostTag.bases];
  if (chain.includes(component.requiresNode)) return;
  scope.report(
    element,
    'wrong-host',
    `<${component.name}> declares Component<${component.requiresNode}>, so it cannot go on ` +
      `a <${hostTag.name}>.`,
  );
}


/**
 * Whether this field holds one node or a list of them — the values a document can only supply
 * once the tree exists.
 */
export function referencesNode(field: { shape: string; elementShape?: string }): boolean {
  return field.shape === 'nodeRef' || (field.shape === 'array' && field.elementShape === 'nodeRef');
}

/** `Physics2D` → `physics2D`; the local name a system handle takes in generated code. */
export function camelCaseOf(name: string): string {
  return name[0]!.toLowerCase() + name.slice(1);
}
