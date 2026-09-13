/**
 * What the build knows about a project, and where each fact came from.
 *
 * Every one of these is **read from TypeScript source** — the game's own components with the
 * checker, and the tag vocabulary from `three`'s own declarations. There is no registry, no
 * decorator restating a type, and no hand-maintained table of node definitions. So none of it
 * can drift from the code: there is no second copy of it anywhere to drift from.
 */

/** How a `.xml` attribute value has to be turned into a TypeScript expression. */
export type ValueShape =
  | 'number'
  | 'boolean'
  | 'string'
  /** `#rrggbb` or a named colour — emitted as a hex literal or a `new Color(...)`. */
  | 'color'
  /** `"x: 1; y: 2"` or `"1 2"` — emitted as `new Vector2/3/4(...)`. */
  | 'vector2'
  | 'vector3'
  | 'vector4'
  /** Degrees in, `new Vector3(...)` assigned through `eulerAngles`. */
  | 'euler'
  /** A `three` constant such as `FrontSide` — emitted as the imported identifier. */
  | 'enum'
  /** `#id` — emitted as a reference to another node in the same document. */
  | 'nodeRef'
  /** A path to another asset document — emitted as an import of its generated module. */
  | 'assetRef'
  /** `[a, b, c]` of the element shape. */
  | 'array'
  /**
   * Several shapes are acceptable and the *text* decides which — `Scene.background` takes a
   * colour or a texture, so `#05070d` is one and `sky.png` is the other.
   */
  | 'union'
  /** Nothing the emitter can express; reported rather than guessed at. */
  | 'unsupported';

/** One authorable value: a component field, a constructor parameter, a material property. */
export interface PropInfo {
  name: string;
  /** The type as TypeScript prints it, for diagnostics and the inspector. */
  type: string;
  /** How to emit a value for it. */
  shape: ValueShape;
  /** Element shape when `shape` is `array`. */
  elementShape?: ValueShape;
  /** The alternatives when `shape` is `union`, in no particular order. */
  shapes?: ValueShape[];
  /** Declared `X | X[]`, as a mesh's material is: a bracketed list goes wherever one value does. */
  list?: boolean;
  /**
   * For an `assetRef`: the family of class the slot holds, which is what an element fills it by.
   * Read from the type, so a generic slot like `Mesh.material` still says what it accepts.
   */
  assetFamily?: TagFamily;
  /** For `enum`: the legal identifier names, so a typo is caught before `tsc` sees it. */
  options?: string[];
  /** The initializer as written (`10`, `'#fff'`), when the source has one. */
  default?: string;
  /** First line of the doc comment. */
  description?: string;
  /** False for a parameter or property that may be omitted. */
  required: boolean;
}

/** A serialized field of a component, as the source declares it. */
export interface SerializedField extends PropInfo {
  /** True when it took a `@serializeField` decorator rather than being public. */
  explicit: boolean;
}

/** Something wrong with a class, found while reading it. */
export interface ClassProblem {
  /** 1-based line in the class's own file. */
  line: number;
  code: string;
  message: string;
}

/** A component class found in the workspace. */
export interface ComponentInfo {
  /** Class name. This is the name a scene file addresses it by — there is no separate tag. */
  name: string;
  /** Absolute path of the file declaring it. Used for diagnostics and for identity. */
  file: string;
  /**
   * The module a document should import it from, when that is not the file itself — the
   * package specifier for a class a tag package provides.
   *
   * Separate from `file` because the two answer different questions. `file` says where the
   * class *is*, which is what a diagnostic must name and what tells two same-named classes
   * apart. `module` says what to write in an `import`, and for a package that is its name, not
   * a path into its source.
   */
  module?: string;
  /** 1-based line of the class declaration, for diagnostics. */
  line: number;
  /** Doc comment on the class. */
  description?: string;
  /** Base class name, when it is another component rather than `Component` itself. */
  extends?: string;
  /** Serialized fields, own and inherited, in declaration order. */
  fields: SerializedField[];
  /** Mistakes in the class itself, which the emitters pass through as build diagnostics. */
  problems?: ClassProblem[];
  /**
   * The `Object3D` subclass this component requires, from `Component<PointLight>`. `undefined`
   * when it takes any node. The compiler checks a scene against it so a mis-hosted component
   * is a build error at the XML line, not a `tsc` error in generated code.
   */
  requiresNode?: string;
}

/** What family a tag belongs to — which decides where it may appear and how it is emitted. */
export type TagFamily = 'node' | 'geometry' | 'material' | 'texture' | 'fog';

/**
 * A tag the DSL accepts, derived from a real exported class.
 *
 * `<BoxGeometry width="1.2" height="0.4">` is legal because `three` exports a constructible
 * `BoxGeometry` whose constructor takes `width` and `height` — the attribute list *is* the
 * parameter list, so a three.js upgrade that adds a parameter adds an attribute for free and
 * one that removes a parameter is a build error rather than a silently-ignored attribute.
 */
export interface TagInfo {
  /** The XML tag name, which is the exported class name verbatim. */
  name: string;
  family: TagFamily;
  /** Module the class is imported from — `three`, or a tag package. */
  module: string;
  /** Doc comment on the class, when it has one. */
  description?: string;
  /**
   * Constructor parameters, in order. Emitted positionally, so a document that sets the
   * third one but not the second still produces a correct call.
   */
  parameters: PropInfo[];
  /**
   * Settable properties beyond the constructor: a material's parameters-object keys, a
   * light's `castShadow`, a camera's `zoom`. Emitted as assignments after construction.
   */
  properties: PropInfo[];
  /** Names of the classes this one derives from, nearest first. */
  bases: string[];
}

/** Everything the emitters need to turn one project's XML into TypeScript. */
export interface ProjectModel {
  components: ComponentInfo[];
  /**
   * Effects — the tags a render document is written from, described exactly as components are.
   *
   * A third scan with a third base class, for the same reason there is a second: a class that
   * decides how a frame is *drawn* is neither behaviour on a node nor a service on the scene,
   * and giving it its own base is what lets `<Bloom>` be legal inside `<Render>` and nowhere
   * else — without a table anywhere saying so.
   */
  effects: ComponentInfo[];
  /**
   * Systems, described exactly as components are — same scan, different base class. A system
   * has no `requiresNode`, because it has no node.
   */
  systems: ComponentInfo[];
  tags: TagInfo[];
}
