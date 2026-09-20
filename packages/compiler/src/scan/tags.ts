import {
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Project,
  type Symbol as TsSymbol,
  type Type,
} from 'typescript/unstable/sync';
import * as ast from 'typescript/unstable/ast';
import type { PropInfo, TagFamily, TagInfo } from '../model.js';
import { baseChainOf, classDeclarationOf, docOf, docTagOfSymbol, ownersOf, resolveAlias } from './ast-utils.js';
import { familyOf } from './families.js';
import { propOf } from './shape.js';
import type { Workspace } from './workspace.js';

/**
 * Classes that are real exports but not authorable tags: abstract bases, internal helpers,
 * and the loader-fed types a document cannot construct from attributes.
 *
 * `Texture` used to be here for the last reason — its first constructor parameter is an
 * `image`, which no attribute can supply. A `.texture.xml` names the image file instead and the
 * emitter builds the texture through a loader, so the class is a vocabulary now: `wrapS` and
 * `colorSpace` are attributes because `Texture` declares them. The subclasses below stay out,
 * because each of them needs real decoded data rather than a URL.
 *
 * `Object3D` is not here: three.js scenes use a bare one as a plain node, and `Group` beside it,
 * so a document takes both as three.js does.
 */
const NOT_A_TAG = new Set([
  'BufferGeometry',
  'InstancedBufferGeometry',
  'Material',
  'CompressedTexture',
  'DepthTexture',
  'FramebufferTexture',
  'Camera',
  'Light',
  'LightShadow',
]);

/**
 * Build the tag vocabulary by reading the declarations of the modules a project imports.
 *
 * This is what replaced `nodes/**` — five hundred lines of hand-written tag definitions that
 * restated, for every class, the constructor `three` already declares. `<BoxGeometry width=…>`
 * is legal now because `three` exports a constructible `BoxGeometry` whose first parameter is
 * called `width`. A three.js upgrade that adds a parameter adds an attribute for free, and one
 * that renames a parameter is a build error rather than an attribute that silently does
 * nothing.
 *
 * @param modules module specifiers to read, in priority order. A later module may not
 * shadow an earlier one's tag — a duplicate is reported rather than silently resolved.
 */
export function scanTags(
  workspace: Workspace,
  modules: readonly string[] = ['three'],
  /** The types that author as a path — a project's document kinds. See `shapeOf`. */
  documents?: ReadonlySet<string>,
): TagInfo[] {
  const { checker, project } = workspace;
  const resolved = resolveAll(workspace, modules);
  const tags: TagInfo[] = [];
  const claimed = new Map<string, string>();
  // A base class's property names, read once however many tags derive from it — per scan, so a
  // rescan after a package changed reads them again.
  const bases = new Map<string, readonly string[]>();

  for (const specifier of modules) {
    const moduleSymbol = resolved.get(specifier);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const tag = describeTag(exported, specifier, checker, bases, documents, project);
      if (!tag) continue;
      // What the class says about itself, for the classes *we* ship. three's hundred are
      // documented on three's own site, and resolving a declaration per tag to fetch a comment
      // nobody reads here would be a round trip each. A `<Cube>` is worth the round trip: what
      // it is — one unit on a side — is the whole reason to reach for it.
      if (specifier !== 'three') {
        const description = docOfClass(exported, workspace, checker);
        if (description) tag.description = description;
        const declared = resolveAlias(exported, checker);
        const tip = docTagOfSymbol(declared, project, 'tip');
        if (tip) tag.tip = tip;
        if (docTagOfSymbol(declared, project, 'parent') === 'camera') tag.parent = 'camera';
      }
      const owner = claimed.get(tag.name);
      if (owner) {
        throw new Error(
          `[scenoco] the tag <${tag.name}> is exported by both "${owner}" and "${specifier}". ` +
            'Two packages cannot claim one tag name; rename one, or drop a dependency.',
        );
      }
      claimed.set(tag.name, specifier);
      tags.push(tag);
    }
  }
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

/** Describe one exported symbol as a tag, or skip it. */
function describeTag(
  symbol: TsSymbol,
  module: string,
  checker: Checker,
  bases: Map<string, readonly string[]>,
  documents?: ReadonlySet<string>,
  project?: Project,
): TagInfo | undefined {
  if (NOT_A_TAG.has(symbol.name)) return undefined;
  // A tag name is a class name, so it starts with a capital. This also drops the hundreds of
  // constants (`FrontSide`, `AddEquation`) that share the module.
  if (!/^[A-Z]/.test(symbol.name)) return undefined;

  const staticType = checker.getTypeOfSymbol(symbol);
  if (!staticType) return undefined;
  const signatures = checker.getSignaturesOfType(staticType, SignatureKind.Construct);
  const signature = signatures[0];
  // Not constructible: an interface, a type alias, a plain function.
  if (!signature || signature.isAbstract) return undefined;

  const instance = checker.getReturnTypeOfSignature(signature);
  if (!instance) return undefined;

  const chain = baseChainOf(instance, checker);
  // `bases` below stays the real ancestry, which is what everything else reads.
  const family = familyOf(symbol.name, chain);
  if (!family) return undefined;

  const parameters = signature
    .getParameters()
    .map((parameter) => propOf(parameter, checker, {}, documents, project))
    // A parameter the DSL cannot express is not an error on its own — it simply cannot be
    // authored, and the emitter passes `undefined` in its slot.
    .map((parameter, index) => ({ ...parameter, name: parameter.name || `arg${index}` }));

  // Which of these the class inherits, and from whom. Constructor parameters are always its own.
  const owners = ownersOf(instance, checker, bases);
  const properties = settableProperties(instance, signature, checker, family, module, documents, project).map(
    (prop) => {
      // three declares a material's settings on `MeshStandardMaterialProperties` and merges it
      // into the class, so that interface *is* the class's own — named after it, as three's docs do.
      const owner = owners.get(prop.name)?.replace(/(Properties|Parameters)$/, '');
      return owner && owner !== symbol.name ? { ...prop, owner } : prop;
    },
  );

  return {
    name: symbol.name,
    family,
    module,
    parameters,
    properties,
    bases: chain,
  };
}

/**
 * The properties a document may set after construction.
 *
 * For a material this is the whole story: three.js takes one parameters object, so the
 * constructor has nothing useful to offer and every attribute is a property. For a node it is
 * the extras a constructor does not cover — `castShadow`, `renderOrder`, `zoom`.
 */
function settableProperties(
  instance: Type,
  signature: ReturnType<Checker['getSignaturesOfType']>[number],
  checker: Checker,
  family: TagFamily,
  module: string,
  documents?: ReadonlySet<string>,
  project?: Project,
): PropInfo[] {
  if (family === 'material') return materialParameters(signature, checker, documents, project);
  if (family === 'geometry') return [];

  const constructorNames = new Set(signature.getParameters().map((p) => p.name));
  const props: PropInfo[] = [];
  for (const symbol of checker.getPropertiesOfType(instance)) {
    if (constructorNames.has(symbol.name)) continue;
    if (!isAuthorable(symbol.name)) continue;
    if (!declaredByItsOwnPackage(symbol, module)) continue;
    if (!isWritable(symbol)) continue;
    const prop = propOf(symbol, checker, {}, documents, project);
    if (prop.shape === 'unsupported') continue;
    // A package's own settings may carry a `@tip`; three's thousands are not read for one.
    const tip = module !== 'three' && project ? docTagOfSymbol(symbol, project, 'tip') : undefined;
    if (tip) prop.tip = tip;
    // `readonly System[]` and friends: the type prints its own readonly-ness, and assigning to
    // one in generated code would not compile.
    if (prop.type.startsWith('readonly ')) continue;
    props.push(prop);
  }
  return props.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A material's attributes come from its parameters *interface*, not its instance.
 *
 * The instance carries a hundred and more members — internals, `is…` brands, methods — while
 * `MeshStandardMaterialParameters` is exactly the set three.js considers authorable. Reading
 * the interface is therefore both smaller and more faithful than filtering the class.
 */
function materialParameters(
  signature: ReturnType<Checker['getSignaturesOfType']>[number],
  checker: Checker,
  documents?: ReadonlySet<string>,
  project?: Project,
): PropInfo[] {
  const parameter = signature.getParameters()[0];
  if (!parameter) return [];
  const type = checker.getTypeOfSymbol(parameter);
  if (!type) return [];
  const resolved = checker.getNonNullableType(type) ?? type;
  return checker
    .getPropertiesOfType(resolved)
    .map((symbol) => propOf(symbol, checker, {}, documents, project))
    .filter((prop) => prop.shape !== 'unsupported')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether a property can actually be assigned.
 *
 * A getter with no setter is a *derived* value — `scene`, `componentCount`, `activeInHierarchy`
 * — and offering one as an attribute produces generated code that does not compile. The symbol's
 * own flags answer this, which matters: resolving every property's declaration to look for a
 * `readonly` modifier would be a round-trip per property per tag, and there are thousands.
 */
function isWritable(symbol: TsSymbol): boolean {
  const isGetter = (symbol.flags & SymbolFlags.GetAccessor) !== 0;
  const isSetter = (symbol.flags & SymbolFlags.SetAccessor) !== 0;
  return !isGetter || isSetter;
}

/**
 * Whether a property is really this class's, or something another package bolted on.
 *
 * three.js's interfaces are open, and a library that augments `Object3D` adds its members to
 * every node in the vocabulary. uikit does exactly that for its pointer-event plumbing, and the
 * result was seven attributes — `pointerEventsType`, `ancestorsHaveListeners`,
 * `interactableDescendants` — offered on every light, mesh and group in the project. They
 * compile, so nothing caught them. They are simply not attributes of a light, and noise like
 * that is expensive precisely where the DSL promises there is none: it is what a small model
 * reads as the vocabulary.
 *
 * So the promise is stated in code rather than only in a comment: **an attribute on a class is
 * a property that class's own package declares.** three, the engine's own deliberate
 * augmentation, the project's source, and the package that exports the tag all count as its
 * own; anything else does not.
 */
function declaredByItsOwnPackage(symbol: TsSymbol, module: string): boolean {
  const declarations = symbol.declarations;
  if (declarations.length === 0) return true;
  return declarations.some((declaration) => {
    const path = String(declaration.path);
    const at = path.lastIndexOf(NODE_MODULES);
    // Not installed: the project's own source, or a workspace package it is built from.
    if (at === -1) return true;
    const rest = path.slice(at + NODE_MODULES.length);
    const segments = rest.split('/');
    const owner = rest.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? '');
    return OWN_PACKAGES.has(owner) || owner.startsWith('@scenoco-three/') || owner === module;
  });
}

const NODE_MODULES = 'node_modules/';
/** three itself, its types, and nothing else by default. */
const OWN_PACKAGES = new Set(['three', '@types/three']);

/** Members that are state rather than settings, or that a document has no way to write. */
function isAuthorable(name: string): boolean {
  if (name.startsWith('_') || name.startsWith('is')) return false;
  return !NEVER_AUTHORED.has(name);
}

const NEVER_AUTHORED = new Set([
  'children',
  'parent',
  'id',
  'uuid',
  'type',
  'matrix',
  'matrixWorld',
  'modelViewMatrix',
  'normalMatrix',
  'up',
  'userData',
  'animations',
  'shadow',
  'geometry',
  'material',
  // Core's own augmentation of `Object3D`. `components` is the attached list, which a document
  // fills with a `<Components>` block; `activeSelf`/`activeInHierarchy` are what `active` reads
  // back as. All three are state, and offering them as attributes invites a document to write
  // the answer instead of the question.
  'components',
  'activeSelf',
  'activeInHierarchy',
  // The engine's own members. Three of them are attributes under a different name, from the
  // closed `SCENE_ATTRIBUTES` list — `<Scene camera="#id" render="…" dontDestroyOnLoad="true">`
  // — and the rest are state a document reads back rather than writes. Keeping every one of
  // them out of the *scanned* surface is what makes that surface exactly three.js's own, which
  // is the promise the whole DSL rests on: an attribute on a three.js class is a property
  // three.js declares.
  'mainCamera',
  'render',
  'dontDestroyOnLoad',
  'disposeOnUnload',
  'runtime',
  'componentCount',
  // `scene` is readonly on every node, and a `readonly` *field* is invisible to the accessor
  // check below — TypeScript models it as a plain property. Offering it produced generated code
  // that did not compile.
  'scene',
  // Placement, which every tag takes through the shared attribute set instead.
  'position',
  'rotation',
  'quaternion',
  'scale',
  'eulerAngles',
]);

/**
 * The module symbol for every specifier, resolved through the project's own imports.
 *
 * A module symbol has to be reached from a real import in a real file — there is no
 * "resolve this specifier" entry point. Each specifier is looked up on its own, so a project
 * that imports `three` in one file and a tag package in another is fine; requiring one file to
 * import all of them made a two-file project look like a missing dependency.
 *
 * A specifier nothing imports is an error rather than an empty vocabulary, because the symptom
 * otherwise is every tag from that package reported as `unknown-tag`.
 *
 * This bites in a way worth naming: a project can use `<RigidBody2D>` in a document and never
 * mention box2d in TypeScript, because tags are only ever written in XML. Depending on a package
 * in `package.json` is not enough — the checker resolves a module through an import in a real
 * file, and there is nothing else to resolve it from. So the message says exactly what to write.
 */
/** The class's own doc comment, first paragraph, as the inspector and `describe` show it. */
function docOfClass(symbol: TsSymbol, workspace: Workspace, checker: Checker): string | undefined {
  const declared = resolveAlias(symbol, checker);
  const node = classDeclarationOf(declared, workspace.project);
  if (!node) return undefined;
  for (const handle of declared.declarations) {
    const file = workspace.project.program.getSourceFile(handle.path);
    if (file) return docOf(file, node);
  }
  return undefined;
}

function resolveAll(
  workspace: Workspace,
  modules: readonly string[],
): Map<string, TsSymbol> {
  const resolved = new Map<string, TsSymbol>();
  const missing: string[] = [];
  for (const specifier of modules) {
    const symbol = workspace.resolveModule(specifier);
    if (symbol) resolved.set(specifier, symbol);
    else missing.push(specifier);
  }
  if (missing.length > 0) {
    const imports = missing.map((m) => `import '${m}';`).join('\n');
    throw new Error(
      `[scenoco] no file in this project imports ${missing.join(', ')}.\n\n` +
        'A tag package is read through a real import, and tags are only ever written in XML — so ' +
        'depending on one in package.json is not enough on its own. Add a file that imports ' +
        `them, e.g. src/tags.ts:\n\n${imports}\n`,
    );
  }
  return resolved;
}
