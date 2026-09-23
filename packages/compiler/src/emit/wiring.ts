import type { ComponentInfo, SerializedField, TagInfo } from '../model.js';
import { hint, nearestName } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue } from '../dsl/value.js';
import { emitConfigValue } from './config.js';
import { isCamera } from './scene.js';
import { moduleFor, type EmitScope } from './scope.js';
import { camelCase, sanitizeIdentifier } from './module.js';

// --- components ------------------------------------------------------------------------

/**
 * Walk the whole document again and emit every `<Components>` block.
 *
 * Separate from the node pass so that a component may reference any node in the document,
 * not only one declared before it.
 */
export function emitComponentsFor(scope: EmitScope, element: SncElement, self: string, out: string[]): void {
  // First pass over the subtree: give every component with an id a name to be referenced by,
  // so a component can hold another component the same way it holds a node. (The document's own
  // ids were claimed before the systems were emitted; this covers a subtree emitted on its own.)
  claimComponentIds(scope, element, self);
  // References land after every component exists. Passed at `addComponent`, a slot naming a
  // component further down the document was filled with a field not yet assigned — it compiled,
  // and `start()` met `undefined`. Still before any `awake`: the scene is being built.
  const late: string[] = [];
  walkComponents(scope, element, self, out, late);
  out.push(...late);
}

/**
 * Register every `<Component id="…">` in the document before anything reads an `#id`.
 *
 * Systems are emitted before the components are, and a system slot naming a component's id —
 * `startButton="#startBtn"` on a `<Button id="startBtn">` — was answered "no node in this
 * document declares it" while the component was right there.
 */
export function claimComponentIds(scope: EmitScope, element: SncElement, self: string): void {
  for (const child of element.children) {
    if (child.tag === 'Systems') continue;
    if (child.tag === 'Components') {
      for (const componentElement of child.children) {
        const id = componentElement.attributes.get('id');
        // Claimed once: a scene registers its component ids before the systems and again with
        // the components, and the second pass must not report the same collision twice.
        if (!id || scope.componentsById.get(id)?.element === componentElement) continue;
        scope.claimId(componentElement, id);
        scope.componentsById.set(id, {
          reference: `this.${sanitizeIdentifier(id)}`,
          typeName: componentElement.tag,
          element: componentElement,
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
          if (!id || scope.componentsById.get(id)?.element === componentElement) continue;
          scope.claimId(componentElement, id);
          scope.componentsById.set(id, {
            reference: `this.${sanitizeIdentifier(id)}`,
            typeName: componentElement.tag,
            element: componentElement,
          });
        }
      }
      continue;
    }
    claimComponentIds(scope, child, placed?.reference ?? self);
  }
}

function walkComponents(scope: EmitScope, element: SncElement, self: string, out: string[], late: string[]): void {
  for (const child of element.children) {
    if (child.tag === 'Systems') continue;
    if (child.tag === 'Components') {
      for (const componentElement of child.children) emitComponent(scope, componentElement, self, out, late);
      continue;
    }
    const placed = scope.placedFor(child);
    if (child.tag === 'Prefab') {
      if (!placed) continue;
      for (const block of child.children) {
        if (block.tag !== 'Components') continue;
        for (const componentElement of block.children) {
          emitComponent(scope, componentElement, placed.reference, out, late);
        }
      }
      continue;
    }
    if (placed) walkComponents(scope, child, placed.reference, out, late);
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
  reportMisplacedOnCamera(scope, root);
}

/**
 * A tag that has to hang off the scene's camera — its class says `@parent camera` — somewhere else.
 *
 * The same failure as a misplaced `<Systems>` block and the same reason to catch it here: the
 * document reads correctly, the compiler is happy, and the screen is empty. A screen-space UI root
 * is sized from a camera's frustum, so on no camera it lays out nothing, and on a camera nobody
 * looks through it is never seen. Which tags those are is the package's to say, not this file's.
 */
function reportMisplacedOnCamera(scope: EmitScope, root: SncElement): void {
  const onCamera = new Map(
    scope.options.model.tags.filter((tag) => tag.parent === 'camera').map((tag) => [tag.name, tag]),
  );
  if (onCamera.size === 0) return;

  // The camera the scene is drawn through, when the document names it — `<Scene camera="#camera">`
  // — else any camera with an id. Naming the id is the difference between "move it" and the text
  // to write.
  const seenThrough = root.tag === 'Scene' ? root.attributes.get('camera')?.replace(/^#/, '') : undefined;
  const named = [...scope.byElement.values()].filter(isCamera).find((placed) => placed.element.attributes.get('id'));
  const target = seenThrough ?? named?.element.attributes.get('id');

  const visit = (element: SncElement): void => {
    for (const child of element.children) {
      const tag = onCamera.get(child.tag);
      if (!tag) {
        visit(child);
        continue;
      }
      const parent = scope.byElement.get(element);
      const id = element.attributes.get('id');
      const onCameraAtAll = parent !== undefined && isCamera(parent);
      if (onCameraAtAll && (!seenThrough || id === seenThrough)) continue;
      const where = onCameraAtAll
        ? `is on <${element.tag}${id ? ` id="${id}"` : ''}>, but the scene is seen through camera="#${seenThrough}", so it is never on screen.`
        : `has to be a child of a camera, and it hangs off <${element.tag}>.`;
      scope.report(
        child,
        'misplaced-canvas',
        `<${tag.name}> ${where}${target ? ` Move it inside #${target}.` : ''}${tag.tip ? ` ${tag.tip}` : ''}`,
      );
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
  scope.from(create, element);
  scope.from(wire, element);
  const system = scope.options.model.systems.find((c) => c.name === element.tag);
  const elsewhere = system ? undefined : scope.misplaced(element.tag, 'system');
  if (elsewhere) {
    scope.report(element, 'unknown-system', elsewhere);
    return;
  }
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
  scope.checkExported(element, system);
  const local = scope.module.require(moduleFor(system), system.name);
  const { entries, deferred, prelude } = readFields(scope, element, system, `system <${system.name}>`, 'all');
  const init = entries.length > 0 ? `, { ${entries.join(', ')} }` : '';
  create.push(...prelude);

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
 * Why a name a component *does* declare is still not something a document writes.
 *
 * "No such field" is wrong for all of these — the name is in the class, right where the reader
 * put it — and it sends them to check a spelling that is correct. Each has its own fix, and the
 * two lifecycle switches are not the component's fields at all: they belong to the node.
 */
function whyNotAnAttribute(info: ComponentInfo, attribute: string): ((what: string, name: string) => string) | undefined {
  // The two lifecycle switches. Both exist, neither is a field of this class, and each is
  // written somewhere else — one in code, one on the node.
  if (attribute === 'enabled') {
    return (what) =>
      `enabled is a component's own switch, set from code: \`this.enabled = false\`. To start ` +
      `a node switched off instead, write active="false" on the node carrying ${what}.`;
  }
  if (attribute === 'active') {
    return (what) =>
      `active belongs to the node, not to a component on it. Write it on the element that ` +
      `carries ${what}: <Mesh active="false"><Components>${what}</Components></Mesh>.`;
  }
  const why = info.unauthored?.find((member) => member.name === attribute)?.why;
  if (why === 'private') {
    return (what, name) =>
      `${what} declares "${name}", but it is private. Make it public, or keep it private and ` +
      'mark it with a /** @serializeField */ tag.';
  }
  if (why === 'getter') {
    return (what, name) =>
      `${what} declares "${name}", but it is a getter: a document cannot set it, because it ` +
      'reads state the component keeps for itself.';
  }
  if (why === 'readonly') {
    return (what, name) =>
      `${what} declares "${name}", but it is readonly — the component owns it, and generated ` +
      'code could not assign it.';
  }
  return undefined;
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
 * Read an element's attributes and children against a class's serialized fields.
 *
 * Shared by components and systems because the two are authored identically — public fields,
 * derived types, no decorators — and a second copy of this would be the place they drifted.
 *
 * `prelude` is what has to stand above the `addComponent` line: a config written inside the
 * element becomes a named `const`, as an inline material does.
 */
function readFields(
  scope: EmitScope,
  element: SncElement,
  info: ComponentInfo,
  what: string,
  /**
   * Which references wait until the tree is complete: every one for a system, which is added
   * before the nodes exist, and for a component only those that reach another *component* —
   * nodes are all built before any component is added, components are added in document order.
   */
  deferNodeRefs: false | 'all' | 'components' = false,
): { entries: string[]; deferred: Array<{ name: string; code: string }>; prelude: string[] } {
  const entries: string[] = [];
  const deferred: Array<{ name: string; code: string }> = [];
  const prelude: string[] = [];
  const seen = new Set<string>();

  for (const [attribute, text] of element.attributes) {
    if (attribute === 'id' || attribute.includes(':')) continue;
    const field = info.fields.find((f) => f.name === attribute);
    if (!field && info.nonSerialized?.includes(attribute)) {
      scope.report(element, 'non-serialized', nonSerializedMessage(what, info, attribute));
      continue;
    }
    if (!field) {
      const declared = whyNotAnAttribute(info, attribute);
      if (declared) {
        scope.report(element, 'unauthored-field', declared(what, attribute));
        continue;
      }
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
    const sibling = (name: string) => info.fields.find((f) => f.name === name);
    const emitted = emitValue(field, text, element, { ...scope.context, attribute: sibling });
    scope.module.reportAll(emitted.diagnostics);
    if (!emitted.code) continue;
    const defer =
      deferNodeRefs === 'all'
        ? referencesNode(field)
        : deferNodeRefs === 'components' && referencesNode(field) && reachesComponent(scope, emitted.code);
    if (defer) deferred.push({ name: attribute, code: emitted.code });
    else entries.push(`${attribute}: ${emitted.code}`);
  }

  // A child fills the field whose *type* it is named after — the effect a `<ParticleSystem>`
  // plays, written here rather than pointed at. The rule an inline material follows on a `<Mesh>`.
  for (const child of element.children) {
    const field = info.fields.find((f) => f.document === child.tag);
    if (!field) {
      scope.report(child, 'unknown-element', unknownChild(child, what, info), child.tag);
      continue;
    }
    if (seen.has(field.name)) {
      scope.report(
        child,
        'duplicate-value',
        `${what} writes both ${field.name}= and a <${child.tag}> child. It takes one ` +
          `${child.tag}: name a file to share one, or write the element to give this ` +
          `${info.name} its own.`,
      );
      continue;
    }
    seen.add(field.name);
    const code = emitConfig(scope, child, field, what);
    if (!code) continue;
    prelude.push(code.line);
    entries.push(code.local === field.name ? field.name : `${field.name}: ${code.local}`);
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
  return { entries, deferred, prelude };
}

/**
 * A child of a component that fills nothing.
 *
 * Worth its own message because of what it used to do: nothing. Attributes were all this pass
 * read, so a child written here was dropped without a word.
 */
function unknownChild(child: SncElement, what: string, info: ComponentInfo): string {
  const offered = info.fields.flatMap((f) => (f.document ? [f.document] : []));
  const advice = hint({ near: nearestName(child.tag, offered), as: 'tag', ask: child.tag });
  if (advice.text) return `<${child.tag}> is not part of ${what}.${advice.text}`;
  if (offered.length === 0) {
    return `${what} holds no elements, only attributes, so <${child.tag}> has nowhere to go.`;
  }
  return `<${child.tag}> is not part of ${what}. It holds ${offered.map((n) => `<${n}>`).join(', ')}.`;
}

/**
 * One config written inside a component, as a named `const` above it.
 *
 * Named rather than inlined for the reason an attached material is: ten lines inside an argument
 * list are unreadable. The annotation is the point — `tsc` checks the document's words against
 * the package's type, in the generated file.
 */
function emitConfig(
  scope: EmitScope,
  element: SncElement,
  field: SerializedField,
  what: string,
): { local: string; line: string } | undefined {
  const config = scope.options.configs?.get(element.tag);
  if (!config) {
    scope.report(
      element,
      'missing-package',
      `${what} takes a <${element.tag}>, but this project has not read that type. ` +
        'Install the package that declares it and run `scenoco build`.',
    );
    return undefined;
  }
  const local = scope.module.declare(camelCase(field.name));
  const typeName = scope.module.requireType(config.module, config.shape.name);
  const prefix = `const ${local}: ${typeName} = `;
  const value = emitConfigValue(element, config.shape, scope.module, scope.context, prefix.length + 1);
  return { local, line: `${prefix}${value};` };
}

export function emitComponent(
  scope: EmitScope,
  element: SncElement,
  host: string,
  out: string[],
  /** Where references go, to run once every component exists. Absent, they are passed inline. */
  late?: string[],
): void {
  scope.from(out, element);
  if (late) scope.from(late, element);
  if (element.tag === 'Components' || element.tag === 'Systems') {
    scope.report(
      element,
      'nested-block',
      `<${element.tag}> is not something a node carries — it is the block that holds them. One ` +
        `<Components> per node, with the components directly inside it.`,
    );
    return;
  }
  const component = scope.options.model.components.find((c) => c.name === element.tag);
  const elsewhere = component ? undefined : scope.misplaced(element.tag, 'component');
  if (elsewhere) {
    scope.report(element, 'unknown-component', elsewhere);
    return;
  }
  if (!component) {
    const names = scope.options.model.components.map((c) => c.name);
    const advice = hint({ near: nearestName(element.tag, names), as: 'tag', ask: element.tag });
    scope.report(
      element,
      'unknown-component',
      `<${element.tag}> is not a component in this project.${advice.text}${scope.moduleHint()}`,
      advice.ask,
    );
    return;
  }
  scope.checkExported(element, component);
  checkHost(scope, element, component, host);

  const local = scope.module.require(moduleFor(component), component.name);
  const { entries, deferred, prelude } = readFields(scope, element, component, `<${component.name}>`, late ? 'components' : false);

  const init = entries.length > 0 ? `, { ${entries.join(', ')} }` : '';
  const id = element.attributes.get('id');
  out.push(...prelude);
  if (id) out.push(`this.${sanitizeIdentifier(id)} = ${host}.addComponent(${local}${init});`);
  else if (deferred.length === 0) out.push(`${host}.addComponent(${local}${init});`);
  // A handle to assign the references to once the rest exist.
  const handle = id ? `this.${sanitizeIdentifier(id)}` : deferred.length ? scope.module.declare(camelCaseOf(component.name)) : '';
  if (!id && deferred.length) out.push(`const ${handle} = ${host}.addComponent(${local}${init});`);
  for (const { name, code } of deferred) late!.push(`${handle}.${name} = ${code};`);
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


/** Whether an emitted reference names a component — by its own id, or off the node carrying it. */
function reachesComponent(scope: EmitScope, code: string): boolean {
  if (code.includes('.getComponent(')) return true;
  return [...scope.componentsById.values()].some(({ reference }) =>
    new RegExp(`${reference.replace(/[.$]/g, '\\$&')}(?![\\w$])`).test(code),
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
