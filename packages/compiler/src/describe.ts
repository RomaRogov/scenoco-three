import { PLACEMENT } from './emit/placement.js';
import { isFamilyRoot } from './scan/families.js';
import { nearestName } from './dsl/diagnostics.js';
import { parseDocument, type SncElement } from './dsl/parse.js';
import type { AssetFile, AssetKind } from './assets.js';
import type { ConfigShape } from './scan/interfaces.js';
import type { ComponentInfo, ProjectModel, PropInfo, TagInfo } from './model.js';

/**
 * What a project's vocabulary is, answered one name at a time.
 *
 * The compiler already knows every fact here — it is what turns a document into code — so this
 * command costs a scan and nothing else. It exists because *the vocabulary had no query*, and an
 * author with no query guesses: benchmarked, a model asked to add a vignette searched the project
 * for `Vignette`, found nothing because the class lives in a package it cannot read, and spent
 * twelve steps looking. With this, the same task passed every run.
 *
 * The answer is read off the source rather than written down, so it cannot go stale. The one
 * exception is {@link GRAMMAR}, and that exception is itself a finding — see its comment.
 */
export interface DescribeInput {
  model: ProjectModel;
  assets: readonly AssetFile[];
  /** Reads a document, given its absolute path. */
  read: (path: string) => string;
  /**
   * The runtime API, read off the declarations — what a core export or an augmented three.js
   * class *has*. Optional because it needs an open workspace; the CLI supplies it.
   */
  api?: (name: string) => string | undefined;
  /**
   * What a field list cannot say about a tag, by tag name — a package's own prose, from its
   * `"scenoco"` block.
   *
   * Most tags need none of it: `<Mesh geometry material>` is its own explanation. The UI ones are
   * not — a build read the whole list for `Canvas`, `Panel` and `Text`, wrote them exactly as the
   * fields describe, and got a blank screen, because nothing in a list of names says a `<Canvas>`
   * belongs under the camera or how the pieces compose. That is the package's to say, and it says
   * it where it says everything else about itself.
   */
  notes?: Readonly<Record<string, string>>;
  /**
   * The kinds of document this project has — the builtins plus whatever its packages declare.
   *
   * Which extensions the compiler accepts is a question with no other answer: the project's own
   * files show what it *has*, not what it may have, and an agent that cannot find it here goes
   * looking in `node_modules` for the table.
   */
  kinds?: readonly AssetKind[];
  /**
   * The elements a config document is made of, by element name — {@link configIndex}.
   *
   * A `.particle.xml` is `<ParticleEffect>` holding `<Emission>` holding `<Burst>`, and not one of
   * those names is a class, so the tag scan walks past all of them. Without this, `describe
   * ParticleEffect` answered "nothing here is called that" — one line after `describe
   * ParticleSystem` had offered `effect  path | <ParticleEffect>`. A name the tooling advertises
   * and then denies sends the reader to `node_modules`, and that is measured, not supposed.
   */
  configs?: ReadonlyMap<string, ConfigEntry>;
}

/** One element of a config document, and where it is written. */
export interface ConfigEntry {
  shape: ConfigShape;
  /** The root type of the document kind it belongs to — which says what file it lives in. */
  document: string;
  /** The element that holds it. Absent on the root. */
  parent?: string;
  /** The holder may write it any number of times — `bursts?: Burst[]`. */
  repeated?: boolean;
}

/**
 * Flatten document shapes into the names a document actually writes.
 *
 * `build` returns one shape per kind, nested; an author writes the nested names as elements, so
 * every level has to be askable by itself. Keyed by element name because that is what a reader
 * has in hand when they ask.
 */
export function configIndex(shapes: Iterable<ConfigShape | undefined>): Map<string, ConfigEntry> {
  const index = new Map<string, ConfigEntry>();
  const walk = (shape: ConfigShape, document: string, parent?: string, repeated?: boolean): void => {
    // Two holders of one type, or a type that holds itself: the first spelling wins and the walk
    // ends, which is enough to answer "what does this element take".
    if (index.has(shape.name)) return;
    index.set(shape.name, {
      shape,
      document,
      ...(parent ? { parent } : {}),
      ...(repeated ? { repeated: true } : {}),
    });
    for (const child of shape.groups.values()) walk(child, document, shape.name);
    for (const child of shape.lists.values()) walk(child, document, shape.name, true);
  };
  for (const shape of shapes) if (shape) walk(shape, shape.name);
  return index;
}

export function describe(input: DescribeInput, wanted?: string): string {
  const { model } = input;
  const kinds: Array<[string, ComponentInfo[]]> = [
    ['component', model.components],
    ['system', model.systems],
    ['effect', model.effects],
  ];

  // Which document types have a second, written-in-place form. Only a config kind does.
  const configNames = new Set(input.configs?.keys() ?? []);

  if (!wanted) return overview(input, model, kinds);

  // A document, rather than an element: what a spawn can reach into.
  if (wanted.endsWith('.xml')) return describeDocument(input, wanted);

  // `<Scene>` is both a document root and a runtime class; a reader asking about it gets both.
  const grammar = GRAMMAR[wanted];
  if (grammar) return [grammar, input.api?.(wanted)].filter(Boolean).join('\n\n');

  // A UI element — `<Text>`, `<Panel>` — is exported by its package as a class the scan lists
  // among components, with no serialized fields, and is *also* a tag with the attributes a
  // document actually writes. The tag is the answer: an agent asked `describe Text`, got one
  // line, and went to node_modules for the attribute names.
  const asTag = model.tags.find((t) => t.name === wanted);
  const asComponent = kinds.flatMap(([, list]) => list).find((c) => c.name === wanted);
  if (asTag && asComponent && asComponent.fields.length === 0) {
    return describeTag(asTag, input.notes, configNames, model.tags);
  }

  for (const [kind, list] of kinds) {
    const found = list.find((c) => c.name === wanted);
    if (found) {
      return [
        `<${found.name}>  — ${kind}${found.module ? `, from ${found.module}` : ''}`,
        ...(found.description ? [found.description.split('\n')[0]!] : []),
        ...found.fields.map((f) => field(f, configNames)),
        // Not attributes, and still half of what a component is for: what others listen to.
        ...(found.events ?? []).map(
          (e) => `  ${e.name}  event (${e.args})${e.description ? `   ${e.description}` : ''}`,
        ),
        ...(found.events?.length
          ? [`  listen with this.listen(${camel(found.name)}.${found.events[0]!.name}, (…) => …)`]
          : []),
      ].join('\n');
    }
  }

  // An element of a config document — `<ParticleEffect>`, `<Emission>`, `<Burst>`. Asked before
  // the tag lookup, because in a project that has particles `Shape` means the one with a radius,
  // not three's curve class. When a class of that name exists too, both are printed.
  const config = input.configs?.get(wanted);
  const tag = model.tags.find((t) => t.name === wanted);
  if (config) {
    const answers = [
      describeConfig(input, config, kinds, configNames),
      tag ? describeTag(tag, input.notes, configNames, model.tags) : '',
    ];
    return answers.filter(Boolean).join(`\n\n${'─'.repeat(78)}\n\n`);
  }
  // `Object3D` is a tag and every node's API at once. What a node can *do* — `addComponent`,
  // `setActive`, `instantiate` — comes first, then what `<Object3D>` takes.
  if (tag && tag.family === 'node' && isFamilyRoot(tag.name)) {
    const api = input.api?.(wanted);
    return [api, describeTag(tag, input.notes, configNames, model.tags)].filter(Boolean).join('\n\n');
  }
  if (tag) return describeTag(tag, input.notes, configNames, model.tags);

  const shape = describeShape(input, wanted);
  if (shape) return shape;

  // Last, deliberately. `Tweens` and `Animator` are shipped *components*, so the scan knows their
  // real fields; a hand-written line here would have shadowed the better answer with a worse one.
  // Only names nothing can scan — the static APIs — should ever reach this.
  const runtime = RUNTIME[wanted];
  // The primer says what a thing is; the declarations say what it has. Both, when both exist —
  // an agent given only the primer went to node_modules for the rest.
  const api = input.api?.(wanted);
  // A base class no document writes — `Material`, `Object3D` — by the attributes it gives the
  // tags that derive from it. After the API, never instead of it: `describe Object3D` is first of
  // all what a node can *do*.
  const base = describeBase(model, wanted, configNames);
  if (runtime || api || base) return [runtime, api, base].filter(Boolean).join('\n\n');

  // The compiler's own near-miss check, so this answers a typo the way a diagnostic does.
  const names = [
    ...kinds.flatMap(([, l]) => l.map((c) => c.name)),
    ...model.tags.map((t) => t.name),
    ...(input.configs?.keys() ?? []),
  ];
  const near = nearestName(wanted, names);
  return `nothing here is called "${wanted}".${near ? ` Did you mean "${near}"?` : ''}`;
}

/**
 * The whole vocabulary, small enough to read.
 *
 * `three`'s hundred-odd classes are a reference, not a list worth printing: naming them all buys
 * nothing and costs a thousand tokens. What a project's own packages add is the short list, and
 * the count of the rest is enough to say "ask me by name".
 */
function overview(
  input: DescribeInput,
  model: ProjectModel,
  kinds: Array<[string, ComponentInfo[]]>,
): string {
  const lines = [...project(input, kinds), ''];
  lines.push(
    ...kinds
      .filter(([, list]) => list.length)
      .map(([kind, list]) => `${kind}s: ${list.map((c) => c.name).join(', ')}`),
  );

  const ours = model.tags.filter((tag) => tag.module !== 'three');
  const theirs = model.tags.length - ours.length;
  if (ours.length) lines.push(`nodes from this framework: ${ours.map((t) => t.name).join(', ')}`);
  lines.push(`plus ${theirs} three.js classes — name one to see its fields.`);
  lines.push(`document grammar: ${Object.keys(GRAMMAR).join(', ')}`);
  // Listed here because a document never mentions them, so this overview is the only place a
  // reader finds out they exist at all before reaching for a web API instead.
  lines.push(`runtime, for components: ${Object.keys(RUNTIME).join(', ')}`);
  lines.push(
    'and any core export by name — `describe Object3D` is what every node can do, `describe Scene`,',
    '`describe SceneManager` — read off the declarations, so there is nothing to look up in a file.',
  );
  lines.push('', PRIMER);
  return lines.join('\n');
}

/**
 * What is already in this project, before any of the vocabulary below.
 *
 * Measured, this is where a build's turns go: against a starter of ten one-line files, a run
 * opened nineteen of them one at a time before writing a line — seven of those were the primitive
 * geometries, each a single element. The equivalent vanilla project needed nine reads in total,
 * because a vanilla project is TypeScript a model already knows and this one is components,
 * documents and generated code that have to be pieced together. That difference *is* the
 * framework's tax, and the only way to stop paying it is to answer the question in one place.
 *
 * So: the components with their settings, the documents by path, and every shape and material
 * inline — they are one element each, and quoting them costs less than being read one by one.
 */
function project(input: DescribeInput, kinds: Array<[string, ComponentInfo[]]>): string[] {
  const lines = ['This project'];

  for (const [kind, list] of kinds) {
    const own = list.filter((c) => !c.module);
    if (!own.length) continue;
    lines.push('', `  ${kind}s in src/ — a public field is an attribute:`);
    for (const c of own) {
      const fields = c.fields
        .map((f) => (f.required ? `${f.name}!: ${f.type}` : `${f.name} = ${f.default ?? f.shape}`))
        .join(', ');
      lines.push(`    <${c.name}>${fields ? `  ${fields}` : '  (no settings)'}`);
    }
  }

  const documents = input.assets.filter((a) => a.kind === 'scene' || a.kind === 'prefab');
  if (documents.length) {
    lines.push('', '  documents — `describe <path>` for what a spawn can reach into:');
    for (const a of documents) lines.push(`    ${a.relativePath}`);
  }

  if (input.kinds?.length) {
    lines.push('', '  kinds of document — `scenoco new <kind> <name>` writes a starter:');
    const width = Math.max(...input.kinds.map((k) => k.kind.length));
    const span = Math.max(...input.kinds.map((k) => k.extension.length)) + 1;
    const home = Math.max(...input.kinds.map((k) => k.dir.length)) + 1;
    for (const kind of input.kinds) {
      const from = kind.package ? ` — from ${kind.package.name}` : '';
      lines.push(
        `    ${kind.kind.padEnd(width)}  ${`*${kind.extension}`.padEnd(span)}  ` +
          `${`${kind.dir}/`.padEnd(home)}  ${kind.description}${from}`,
      );
    }
    // A package's kind is an element tree, and its root is the one name that opens the rest.
    // Left unsaid, the list above reads as "files exist" and the grammar stays unaskable.
    const roots = input.kinds.filter((k) => k.type).map((k) => `<${k.type!}>`);
    if (roots.length) {
      const ask = roots.length > 1 ? 'name one' : 'name it';
      lines.push(`    ${roots.join(' · ')} — ${ask} for the elements and attributes it takes.`);
    }
  }

  // Everything else a document references by path. Listed, not quoted: saying the rule once and
  // naming the files says as much as reproducing ten of them, and `describe <path>` has the
  // numbers when a particular one matters.
  const resources = input.assets.filter((a) => a.kind !== 'scene' && a.kind !== 'prefab');
  if (resources.length) {
    lines.push(
      '',
      '  referenced by path — a shape or a material is one three.js class with its arguments,',
      '  exactly like a scene element; a package\'s own kind is that package\'s type.',
      '  Name one from an attribute by its path; `describe <path>` for its numbers:',
    );
    const byDirectory = new Map<string, string[]>();
    for (const a of resources) {
      const directory = a.relativePath.slice(0, a.relativePath.lastIndexOf('/') + 1);
      byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), a.stem]);
    }
    const width = Math.max(...[...byDirectory.keys()].map((d) => d.length));
    for (const [directory, stems] of byDirectory) {
      lines.push(`    ${directory.padEnd(width)}  ${stems.join(' · ')}`);
    }
  }
  return lines;
}

/**
 * A shape asked for as if it were a tag.
 *
 * Every engine has a `<Cube>`, so every author expects one. Here a shape is a geometry a mesh
 * names, and saying so is worth more than a near-miss guess — it is the single commonest wrong
 * turn measured in this project.
 */
function describeShape(input: DescribeInput, wanted: string): string | null {
  const stem = wanted.toLowerCase();
  const found = input.assets.find((asset) => asset.kind === 'asset' && asset.stem === stem);
  if (!found) return null;
  const numbers = describeDocument(input, found.relativePath).split('\n')[1]?.trim() ?? '';
  return (
    `there is no <${wanted}> tag. ${stem} is a shape, and a shape is an asset a mesh names:` +
    `\n  <Mesh geometry="${found.relativePath}" material="…" position="…" scale="…" />` +
    '\n  (that path is from the project root; write it relative to the document that names it)' +
    `\nIts numbers: ${numbers}`
  );
}

/**
 * Why the framework is shaped the way it is, for a reader who has never seen it.
 *
 * Printed under the vocabulary rather than over it: someone running this to find a component name
 * should see the names first. But the names alone are not enough — several of the ideas here are
 * unusual enough that a reader who guesses will guess a plausible wrong thing, and the guesses are
 * expensive. A model wrote `window.addEventListener` because nothing said input was frame-sampled;
 * another put a value in a config file because nothing said a public field is an attribute.
 *
 * Every claim here is one an author can check against the compiler in the next thirty seconds, so
 * this is orientation rather than persuasion. Kept to the handful of things that are *not*
 * guessable — anything a reader would arrive at on their own is left out.
 */
const PRIMER = [
  'How this fits together',
  '',
  '  A document is a class graph. An element is a class and an attribute is one of that class\'s',
  '  public properties, so <PerspectiveCamera fov> exists because three.js\'s PerspectiveCamera',
  '  has a fov. There is no registry and no second list to keep in step: documents compile to',
  '  TypeScript, and tsc checks the result the same as any other code you wrote.',
  '',
  '  A public field *is* an attribute. Anything public on a component can be written in a',
  '  document, so state you compute at runtime belongs behind a getter — otherwise you have',
  '  quietly published a setting.',
  '',
  '  The vocabulary is Unity\'s, on purpose. Components sit on nodes, prefabs are documents you',
  '  spawn, scenes load and unload, Input and Time are static, destruction is deferred to the end',
  '  of the frame. If you know how a thing behaves in Unity, that is how it behaves here — the',
  '  guess is meant to be right.',
  '',
  '  Geometry, materials and render settings are documents too, referenced by path rather than',
  '  built inline. Two meshes naming one geometry share it; `shared()` is what says a module owns',
  '  a resource, so a scene unload leaves it alone and frees only what the scene built.',
  '',
  '  Input is sampled once a frame, not delivered as DOM events. That is what lets every component',
  '  see the same input regardless of update order — and what lets the editor drive a scene, so a',
  '  game written this way can be tested without a human at the keyboard.',
  '',
  '  Events are typed fields, never strings: `readonly died = new Event<[cause: string]>()`. The',
  '  compiler catches a misspelt event the way it catches a misspelt method.',
  '',
  '  One spelling per value. Vectors are `position="x: 1; y: 2"`, colours are `#rrggbb`, angles are',
  '  degrees. A near miss is a compile error with the exact text to write instead, not a guess.',
  '',
  '  Name any of it — a component, a tag, a document, a runtime API — to see what it takes.',
].join('\n');

/**
 * The runtime APIs a component reaches for, which no scan can see.
 *
 * These are static classes in `@scenoco-three/core`, not tags — nothing in a document mentions
 * them, so the vocabulary scan that finds every component and every three.js class walks straight
 * past them. That gap is not theoretical. Asked to build a game, a model wrote
 * `window.addEventListener('keydown')`, because that is what it knew and nothing here said
 * otherwise — and in doing so it opted out of the frame-sampled input the editor drives, so it
 * could no longer simulate its own game to find out whether the player moved. It reported the
 * movement as unverified. The API it needed was one import away and `describe Input` said
 * "nothing here is called Input".
 *
 * Kept deliberately short. Each entry is the shape of the thing and the one fact that is not
 * guessable from the name, because an answer nobody finishes reading is the same as no answer.
 */
const RUNTIME: Record<string, string> = {
  Component: [
    'Component — behaviour on one node, Unity’s MonoBehaviour. `class Mover extends Component {}`',
    'in src/ is the whole registration: it is now a tag, <Mover>, inside a node’s <Components>.',
    '',
    'Fields:',
    '  speed = 6                a public field is a setting the document sets: <Mover speed="6">',
    '  target!: Object3D        a field typed as a node or component is a slot: target="#player"',
    '  crate!: PrefabType       a prefab slot: crate="../prefabs/crate.prefab.xml"',
    '  get count() { … }        runtime state is a getter or private — never a public field',
    'No constructor: the engine constructs it and applies the attributes before awake.',
    '',
    'Hooks, all optional:',
    '  awake()                  your own state; this.object3D is the THREE.Object3D underneath',
    '  start()                  reach other components — everything has awoken by now',
    '  update(dt)               every frame, dt in seconds',
    '  fixedUpdate(dt)          the physics step',
    '  lateUpdate(dt)           after every update — cameras go here',
    '  onEnable() / onDisable() / onDestroy()',
    '  onTriggerEnter(other) / onCollisionEnter(other)   with a physics or collision package imported',
    '      Both nodes of a pair are told, each handed the other — so put the rule on one of them',
    '      and leave the other with no hook, rather than writing it twice.',
    '',
    'Reaching things — a specific one by id, a kind by class, never by name:',
    '  this.getComponent(Type)                 on this node (GetComponent)',
    '  other.getComponent(Type)                on any node — e.g. the `other` a trigger hands you',
    '  this.getComponentInChildren(Type), this.getComponentInParent(Type)',
    '  this.scene.findObjectOfType(Type)       anywhere in the scene (FindObjectOfType)',
    '  this.requireSystem(Type)                the scene’s service — see System',
    '  this.object3D.instantiate(prefab, { id: `crate${n}`, position })   spawn (Instantiate)',
    '  this.scene.byId("crate3", Crate)        that spawn, typed; "crate3/lid" is what the prefab named inside',
    '  node.destroy()                          at the end of the frame; safe inside any hook',
    '  readonly hit = new Event<[Brick]>()     emit with this.hit.emit(brick); see Event',
  ].join('\n'),

  System: [
    'System — a scene-level service: Unity’s GameManager without the singleton. Rules, score, a',
    'clock, a physics world — anything every component needs and no node owns.',
    '',
    '  export class Run extends System {',
    '    duration = 30;                         // a setting: <Run duration="30" />',
    '    private left = 0;                      // state: private, read through a getter',
    '    get remaining(): number { return this.left; }',
    '    readonly ended = new Event<[boolean]>();',
    '    override awake(): void { this.left = this.duration; }',
    '    override update(dt: number): void { this.left -= dt; if (this.left <= 0) this.ended.emit(true); }',
    '  }',
    '',
    'Declare it under <Scene> as <Systems><Run duration="30" /></Systems>, or let the first',
    '`this.requireSystem(Run)` create it. One per class per scene; every component reaches it with',
    'requireSystem. Same hooks as a component, run after every component in each phase — so its own',
    'state goes in awake(), before any component\'s start() reads it, and reading the scene goes in',
    'start(), once the document is complete.',
  ].join('\n'),

  Input: [
    'Input — keyboard and mouse, sampled per frame. Static; import it from @scenoco-three/core.',
    '',
    'Named axes and buttons, spelled as Unity spells them:',
    "  Input.getAxis('Horizontal')   -1..1, eased in and out — A/D and the left/right arrows",
    "  Input.getAxis('Vertical')     the same for W/S and up/down; +1 is up",
    "  Input.getAxisRaw('Horizontal')  the same axis with no easing: -1, 0 or 1",
    "  Input.getButtonDown('Jump')   true only on the frame it went down; also getButton/getButtonUp",
    '  axes:    Horizontal, Vertical, Fire1, Fire2, Fire3, Jump, Submit, Cancel,',
    '           Mouse X, Mouse Y, Mouse ScrollWheel',
    '  buttons: Fire1, Fire2, Fire3, Jump, Submit, Cancel',
    '',
    'Drive one from somewhere else — an on-screen joystick, a gamepad, a replay:',
    "  Input.setAxis('Horizontal', 0.5)    holds until changed; null releases it",
    "  Input.setButton('Jump', true)       the Down / Up edges follow from the change",
    'While an axis is driven this way its keys are ignored, so a screen control and the keyboard',
    'cannot fight over one value.',
    '',
    'A key or a mouse button directly, when no named entry fits:',
    '  Input.getKey(KeyCode.W)       held down right now',
    '  Input.getKeyDown(KeyCode.Space)  true only on the frame it went down',
    '  Input.getKeyUp(KeyCode.Space)    true only on the frame it came up',
    '  Input.getMouseButton(MouseButton.Left), and the Down / Up pair for buttons too',
    '  Input.mousePosition (CSS px), Input.pointer (NDC, for Raycaster.setFromCamera),',
    '  Input.mouseDelta, Input.mouseScrollDelta',
    '',
    'Read it in update(). Do **not** use window.addEventListener for gameplay input: every',
    'component sees the same input for a frame regardless of update order, edges last exactly one',
    'frame, and the observer can drive this — none of which is true of raw DOM events.',
  ].join('\n'),

  KeyCode: [
    'KeyCode — physical key positions, named. `KeyCode.W` is the key where W sits on QWERTY,',
    'whatever the layout produces.',
    '  Letters A–Z, Digit0–Digit9, Space, Enter, Escape, Tab, Shift, Ctrl, Alt,',
    '  UpArrow, DownArrow, LeftArrow, RightArrow, and the rest.',
    'Used as Input.getKey(KeyCode.W). MouseButton.Left / Right / Middle goes with getMouseButton.',
  ].join('\n'),

  MouseButton: 'MouseButton — Left, Right, Middle. Used as Input.getMouseButton(MouseButton.Left).',

  Time: [
    'Time — the frame clock. Static; import it from @scenoco-three/core.',
    '  Time.deltaTime          seconds since the last frame',
    '  Time.unscaledDeltaTime  the same, ignoring timeScale',
    '  Time.timeScale          1 is normal, 0 freezes, 0.5 is half speed',
    '  Time.time / unscaledTime  elapsed since the first tick',
    '  Time.fixedDeltaTime     the physics step',
    '',
    'update(dt) already hands you the delta, so most components never need Time at all. Reach for',
    'it when you want timeScale, or a duration that is not this frame.',
    '',
    '`timeScale = 0` does not stop the frame: every `update(dt)` still runs, with `dt` of 0. So',
    'movement, timers and spinning all stop on their own, while `Input.getKeyDown` — which is not',
    'time-scaled — still sees the key that unfreezes the game. That is the whole of "everything',
    'freezes at game over, press R to restart"; no component needs an `if (paused) return`.',
  ].join('\n'),

  Coroutine: [
    'Coroutine — a job that runs across frames, Unity’s coroutine. Started from a component and',
    'stopped with it, so a loop inside one is safe.',
    '',
    'Most timers need none of this. The default is a countdown field in update():',
    '  cooldown = 0.5;          // a setting',
    '  private left = 0;        // runtime state',
    '  override update(dt: number): void {',
    '    this.left -= dt;',
    '    if (this.left > 0) return;',
    '    this.left = this.cooldown;',
    '    this.fire();',
    '  }',
    'It pauses, scales with Time.timeScale, and the editor can step it a frame at a time. Never',
    'setTimeout: it fires into destroyed objects, ignores pause, and cannot be stepped.',
    '',
    'A coroutine is for a *sequence* — flash, wait, flash, destroy — where a countdown would turn',
    'into a state machine:',
    '  override start(): void { this.startCoroutine(this.blink()); }',
    '  private *blink(): IEnumerator {',
    '    for (let i = 0; i < 3; i++) { this.object3D.visible = false; yield 0.1; this.object3D.visible = true; yield 0.1; }',
    '    this.object3D.destroy();',
    '  }',
    'Yield a number for that many seconds, null for one frame, or WaitForSeconds,',
    'WaitForSecondsRealtime, WaitForFixedUpdate, WaitUntil, WaitWhile. IEnumerator is exported from',
    '@scenoco-three/core.',
  ].join('\n'),

  Event: [
    'Event — a typed event, declared as a public field rather than named by a string.',
    '',
    '  readonly died = new Event<[cause: string]>();   // on the thing that emits',
    '  this.died.emit("fell");',
    '  this.listen(enemy.died, (cause) => { … });      // on the listener; unsubscribes on destroy',
    '',
    'Because it is a field and not a string, the compiler catches a misspelling and "find all',
    'references" works. Use `this.listen(...)` rather than `event.on`: the runtime drops the',
    'listener during teardown, so a destroyed component can never be called.',
  ].join('\n'),

  SceneManager: [
    'SceneManager — loads and unloads scenes.',
    '  await SceneManager.load(MainScene)   the generated class from a .scene.xml',
    '  await SceneManager.unloadAll()',
    'Assets a document wrapped in shared() outlive the unload; whatever the scene built is freed.',
  ].join('\n'),

  shared: [
    'shared(resource) — marks a geometry, material or texture as owned by its module rather than',
    'by the scene using it. Generated asset documents already do this for you; you need it only',
    'when you build a resource by hand and want it to survive a scene unload.',
  ].join('\n'),

};

/**
 * The handful of elements that have no class behind them.
 *
 * Everything else in a document is a class, so the answer is read off the source and cannot be
 * wrong. These five are the DSL's own grammar — the compiler knows their rules, but they live in
 * the emitters rather than in anything a scan can reach, so this is the one part of the
 * vocabulary that has to be *written down*. That is a finding, not a design: a small model asked
 * for a prefab override read six files, found the pattern in none of them, and gave up without an
 * edit.
 */
const GRAMMAR: Record<string, string> = {
  Prefab: [
    '<Prefab src="brick.prefab.xml" position="x: 1; y: 2" />  — spawn a prefab document.',
    'Takes src, and the placement attributes: name, position, eulerAngles (degrees), scale, active.',
    'Its children are <Override> elements, and nothing else.',
  ].join('\n'),
  Override: [
    '<Override target="#id" attr="value" />  — change one spawned instance, inside a <Prefab>.',
    'target is an id declared *inside* the prefab document, so open that document to see what',
    "there is. It may name a node or a component; the attributes are that thing's own.",
    'Example: <Prefab src="arena.prefab.xml"><Override target="#ball" speed="16" /></Prefab>',
  ].join('\n'),
  Components:
    "<Components> — the block holding a node's components. One child per component, by class name.",
  Systems:
    '<Systems> — scene services, directly under <Scene>. One child per system, by class name.',
  Scene: [
    '<Scene> — the root of a scene document. Takes THREE.Scene properties (background; fog is not',
    'one of them), plus camera="#id", render="…render.xml", dontDestroyOnLoad and disposeOnUnload.',
    'How the frame is drawn — tone mapping, bloom, vignette, fog — lives in the render document.',
  ].join('\n'),
};

/**
 * What a document exposes to whoever spawns it: its ids, and what each one is.
 *
 * This is the question the benchmark showed had no answer. Asked to widen the paddle for one
 * level, a model read the arena, saw a paddle with no size on it, went looking for the file that
 * set one, searched twice for a document that does not exist, and gave up without an edit. An
 * override is invisible in the thing being overridden — nothing in a prefab says "this is
 * adjustable" — so "what can I change about this from outside" has to be askable.
 *
 * Parsed with the compiler's own parser, so the ids are exactly the ones an `<Override>` may name.
 */
function describeDocument(input: DescribeInput, href: string): string {
  const asset = input.assets.find(
    (a) => a.relativePath === href || a.path === href || a.relativePath.endsWith(`/${href}`),
  );
  if (!asset) return `no document called "${href}" in this project.`;

  const parsed = parseDocument(input.read(asset.path), asset.relativePath);
  if (!parsed.ok) {
    return `${asset.relativePath} does not parse: ${parsed.diagnostics[0]?.message ?? ''}`;
  }

  const ids: string[] = [];
  const walk = (element: SncElement, inComponents: boolean): void => {
    const id = element.attributes.get('id');
    if (id) ids.push(`  #${id}  ${element.tag}${inComponents ? '  (a component)' : ''}`);
    for (const child of element.children) walk(child, inComponents || element.tag === 'Components');
  };
  walk(parsed.root, false);

  // A scene or a prefab is asked about for its ids. Everything else — a geometry, a material, an
  // effect — is one element tree, and what you want to know is what it *says*: `<BoxGeometry
  // width="1" …>` tells you a cube is one unit on a side better than any sentence would. The tree,
  // not the root: a `.particle.xml` keeps its emission and its curves in children, and printing
  // the root alone reported a file full of them as `<ParticleEffect … />`, self-closed.
  const root = parsed.root;
  if (asset.kind !== 'scene' && asset.kind !== 'prefab') {
    return `${asset.relativePath}\n${elementXml(root, '  ')}`;
  }

  return [
    `${asset.relativePath}  — <${root.tag}> at its root.`,
    ids.length
      ? `A spawn can reach these from outside with <Override target="#id" …>:\n${ids.join('\n')}`
      : 'It declares no ids, so a spawn can change nothing inside it.',
  ].join('\n');
}

/**
 * A base class no document writes — `Material`, `Object3D`'s cousins — by what it gives the tags
 * that derive from it.
 *
 * A tag lists what it inherits by name only, so the reader needs somewhere to ask for the types:
 * `side` takes three constants and nothing in a list of names says which. Without this, `describe
 * Material` answered "nothing here is called Material" about the one class every material is.
 */
function describeBase(model: ProjectModel, wanted: string, inline: ReadonlySet<string>): string | null {
  const props = new Map<string, PropInfo>();
  const heirs: string[] = [];
  for (const tag of model.tags) {
    const given = tag.properties.filter((prop) => prop.owner === wanted);
    if (!given.length) continue;
    heirs.push(tag.name);
    for (const prop of given) if (!props.has(prop.name)) props.set(prop.name, prop);
  }
  if (!props.size) return null;
  const module = model.tags.find((t) => t.name === heirs[0])?.module;
  return [
    `${wanted}  — a base class${module ? ` in ${module}` : ''}, not written itself. What it gives ` +
      `${heirs.length === 1 ? heirs[0] : `${heirs.length} tags, ${heirs.slice(0, 3).join(', ')} among them`}:`,
    ...[...props.values()].sort((a, b) => a.name.localeCompare(b.name)).map((prop) => field(prop, inline)),
  ].join('\n');
}

/** An element and everything under it, as the document wrote it. */
function elementXml(element: SncElement, indent: string): string {
  const attributes = [...element.attributes].map(([name, value]) => ` ${name}="${value}"`).join('');
  if (element.children.length === 0) return `${indent}<${element.tag}${attributes} />`;
  return [
    `${indent}<${element.tag}${attributes}>`,
    ...element.children.map((child) => elementXml(child, `${indent}  `)),
    `${indent}</${element.tag}>`,
  ].join('\n');
}

/**
 * One element of a config document: its attributes, the elements it may hold, and — on the root —
 * the two ways a document writes it.
 *
 * The two spellings are the point. A shared file and an element written in place are different
 * things, not two styles: the file is one value everything that names it uses, the element is this
 * node's own. Given only the file form, a build put a trail that belongs to one craft into a shared
 * `.particle.xml` — the tiers were never legible from the tooling, so it wrote the one it had seen.
 */
function describeConfig(
  input: DescribeInput,
  entry: ConfigEntry,
  kinds: Array<[string, ComponentInfo[]]>,
  inline: ReadonlySet<string>,
): string {
  const { shape } = entry;
  const kind = input.kinds?.find((k) => k.type === entry.document);
  const children = [...shape.groups.values(), ...shape.lists.values()].map((c) => `<${c.name}>`);
  const where = entry.parent
    ? `inside <${entry.parent}>${entry.repeated ? ', any number of times' : ''}`
    : `the root of a ${kind?.extension ?? 'config'} document`;

  // Which component holds one of these, and under what attribute — the exact two lines to write.
  // Read off the fields rather than named here, so a package that adds a kind gets this for free.
  const holders = kinds.flatMap(([, list]) => list);
  const holder = holders.find((c) => c.fields.some((f) => f.document === entry.document));
  const slot = holder?.fields.find((f) => f.document === entry.document)?.name;

  return [
    `<${shape.name}>  — ${where}${kind?.package ? `, from ${kind.package.name}` : ''}`,
    ...(shape.description ? [shape.description.split('\n')[0]!] : []),
    ...shape.fields.map((f) => field(f, inline)),
    ...(children.length ? [`  it may hold: ${children.join(' · ')}   (name one to see what it takes)`] : []),
    ...(entry.parent || !holder || !slot
      ? []
      : [
          '',
          'Two spellings, and they are two different things:',
          `  <${holder.name} ${slot}="${kind?.dir ?? 'assets'}/…${kind?.extension ?? ''}" />`,
          '      one file, and every node that names it shares that one value.',
          `  <${holder.name}><${shape.name} … /></${holder.name}>`,
          '      written in place, so this node has its own.',
        ]),
  ].join('\n');
}

function describeTag(
  tag: TagInfo,
  notes?: Readonly<Record<string, string>>,
  inline?: ReadonlySet<string>,
  vocabulary: readonly TagInfo[] = [],
): string {
  // Constructor parameters and settable properties are one list to whoever writes the document:
  // both are attributes, and which half a value lands in is the emitter's problem, not theirs.
  // A slot nothing can write — a material's `parameters` object — is the emitter's alone.
  const all = [...tag.parameters, ...tag.properties].filter((prop) => prop.shape !== 'unsupported');
  // The class's own settings in full, and what it inherits by name only, grouped under the class
  // that declares it. Alphabetical in one list, a material's first forty were `alphaHash` to
  // `forceSinglePass` and the cut fell on `roughness`, `metalness` and `opacity`. By owner, the
  // cut can only fall on a base — named, so the rest are three.js's own names for its own class.
  const own = all.filter((prop) => !prop.owner);
  // Nearest base first, the way the class reads; and nothing the placement line below says again.
  const placed = tag.family === 'node' ? new Set(Object.keys(PLACEMENT)) : new Set<string>();
  const inherited = new Map<string, string[]>();
  for (const owner of tag.bases) {
    const names = all.filter((prop) => prop.owner === owner && !placed.has(prop.name)).map((p) => p.name);
    if (names.length) inherited.set(owner, names);
  }
  const whose = tag.module === 'three' ? " — three.js's own names" : '';
  // `path | a geometry element` names a form, and a form nobody has seen spelled sent a reader to
  // grep the compiler's README for the phrase. One line, spelled with a real class of each family.
  const families = [...new Set(own.flatMap((prop) => (prop.assetFamily ? [prop.assetFamily] : [])))];
  // The class of each family that belongs with this tag — a `<Mesh>` gets a `MeshBasicMaterial`.
  const example = families
    .map((family) => {
      const names = vocabulary.filter((t) => t.family === family).map((t) => t.name).sort();
      return names.find((name) => name.startsWith(tag.name)) ?? names[0];
    })
    .filter(Boolean)
    .map((name) => `<${name} … />`);
  const spelled = example.length
    ? [`  instead of a path, written inside is this node's own:  <${tag.name}>${example.join('')}</${tag.name}>`]
    : [];
  const shown = own.slice(0, 40).map((prop) => field(prop, inline));
  const note = tag.module !== 'three' ? notes?.[tag.name] : undefined;
  return [
    `<${tag.name}>  — ${tag.family}, from ${tag.module}`,
    ...(tag.description ? [tag.description.split('\n')[0]!] : []),
    ...(note ? ['', note, ''] : []),
    ...shown,
    ...(own.length > shown.length ? [`… and ${own.length - shown.length} more of its own.`] : []),
    ...spelled,
    ...[...inherited].map(([owner, names]) => `  inherited from ${owner}${whose}: ${names.join(' · ')}`),
    ...(inherited.size ? [`  (describe ${[...inherited.keys()].join(' ')} for their types)`] : []),
    // The attributes no class declares and every node takes. They are also the ones a document
    // uses most, so leaving them out made this answer quietly misleading.
    ...(tag.family === 'node'
      ? [`  every node also takes: ${Object.keys(PLACEMENT).join(', ')}, id`]
      : []),
  ].join('\n');
}

/**
 * One attribute, as a document would write it: name, type, default, and what it is for.
 *
 * The type column is the *spelling*, not the compiler's word for it. `assetRef` and `nodeRef` are
 * internal names for "a path" and "an id"; printed raw they told a reader nothing they could type.
 */
function field(prop: PropInfo, inline?: ReadonlySet<string>): string {
  // A field holding a document has two forms and the shape names neither: a path to a file every
  // user shares, or the element itself, written inside, giving this one its own. The second form
  // exists only for a config document — a prefab is a file and nothing else, so offering
  // `<PrefabType>` there advertised an element no document may contain.
  const type =
    prop.shape === 'enum'
      ? options(prop.options ?? [])
      : prop.document
        ? inline?.has(prop.document)
          ? `path | <${prop.document}>`
          : `path to ${an(prop.document)}`
        : prop.shape === 'assetRef'
          ? // A geometry or a material has the same two tiers as a config document: the file
            // everything shares, or the element written inside this node, which is its own.
            prop.assetFamily
            ? `path | a ${prop.assetFamily} element`
            : 'path'
          : prop.shape === 'nodeRef'
            ? // The id of a node in the same document, and the class it has to be: a slot typed
              // `Text` takes `#scoreText` and the compiler checks both halves of that.
              `#id of ${an(prop.type.replace(/<.*$/, ''))}`
            : prop.shape;
  const value =
    prop.default !== undefined ? ` = ${prop.default}` : prop.required ? '  (required)' : '';
  return `  ${prop.name}  ${type}${value}${prop.description ? `   ${prop.description}` : ''}`;
}

/** `ParticleSystem` → `particleSystem`: what a slot holding one is usually called. */
function camel(name: string): string {
  return name[0]!.toLowerCase() + name.slice(1);
}

/** "a Text", "an AudioClip" — the column is prose, and a wrong article reads as a typo. */
function an(name: string): string {
  return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
}

/**
 * The values an enum attribute accepts.
 *
 * Every one of them, up to a line's worth. A truncated list read as a complete one: `anchor` has
 * fourteen presets, the first eight were printed with no ellipsis, and an agent that trusted this
 * over the package's own README — the right instinct, since this is read off the declarations —
 * concluded `stretchTop` did not exist.
 */
function options(all: readonly string[]): string {
  const shown = all.slice(0, 16);
  return shown.join(' | ') + (shown.length < all.length ? ` | … (${all.length} in all)` : '');
}
