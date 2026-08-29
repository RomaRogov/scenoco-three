import { quote } from '../dsl/value.js';
import { TsModule, camelCase } from './module.js';

/** What a generated module exports, and under what name — one document's public face. */
export interface AssetImport {
  /** Module specifier to import from. */
  module: string;
  /** Exported name. */
  name: string;
  kind: 'geometry' | 'material' | 'particle' | 'texture' | 'render' | 'prefab' | 'scene';
  /**
   * Prefabs only: this prefab publishes a `static assets`, because it — or something it spawns —
   * is built from a file. Whoever spawns it has to wait for that list.
   */
  waits?: boolean;
  /** Prefabs only: the ids inside it, which is what an `<Override>` may address. */
  surface?: PrefabSurface;
}

/**
 * What a prefab exposes to the document that spawns it.
 *
 * A prefab is self-contained and validated on its own, so a scene cannot see inside it — which
 * is right for everything except an override, whose whole job is to reach in. This is the
 * narrow window it reaches through: the ids the prefab declared, and what each one is. Nothing
 * without an id can be overridden, which is the same rule Unity's prefab overrides follow with
 * their object references, and it means a prefab decides deliberately what is adjustable.
 */
export interface PrefabSurface {
  /** id → what it names. */
  ids: ReadonlyMap<string, PrefabTarget>;
}

/** One overridable thing inside a prefab. */
export interface PrefabTarget {
  /** The tag as written: a node tag (`Mesh`), a component class (`Hud`), or `Prefab`. */
  tag: string;
  kind: 'node' | 'component' | 'prefab';
  /** True for the prefab's own root — the instance itself, which has no field of its own. */
  root?: boolean;
}

/** A raw file named directly by a document: an image, a model, a sound. */
export interface FileImport {
  kind: 'file';
  /** The path exactly as the document wrote it — relative to the document, and so to the
   * generated file beside it. */
  href: string;
  /** The helper that turns the URL into the shared runtime value. */
  helper: { module: string; name: string };
  /** Whether a scene has to await it before building. */
  await: boolean;
  /** A readable identifier for the hoisted const. */
  stem: string;
}

/** Everything a `src=` or an asset-typed attribute can point at. */
export type ResolvedAsset = AssetImport | FileImport;

/** How a document resolves a path — supplied by the build driver, which knows the file tree. */
export type ResolveAsset = (href: string) => ResolvedAsset | undefined;

/**
 * Turn a resolved reference into the expression that reaches it, and record what that costs the
 * module.
 *
 * A document reference is an import of the generated module's export — the sharing is legible as
 * an import, which is the whole reason asset documents compile to module-scope values. A raw
 * file becomes one hoisted const:
 *
 * ```ts
 * const heroGlb = sharedModel(new URL('../models/hero.glb', import.meta.url).href);
 * ```
 *
 * `new URL(…, import.meta.url)` rather than `import url from './hero.glb'` on purpose: Vite
 * statically rewrites that form to the hashed output path, and unlike an image import it needs
 * no ambient `declare module '*.glb'` and works unchanged under plain ESM and in a test.
 */
export class AssetScope {
  /** Every file asset a scene has to await before it builds, in first-reference order. */
  readonly awaited: string[] = [];

  private readonly module: TsModule;
  private readonly resolve: ResolveAsset;
  /** href → the local name already hoisted for it, so one file is one const. */
  private readonly files = new Map<string, string>();

  constructor(module: TsModule, resolve: ResolveAsset) {
    this.module = module;
    this.resolve = resolve;
  }

  /** The expression for a path, or undefined when it resolves to nothing. */
  reference(href: string): string | undefined {
    const found = this.resolve(href);
    if (!found) return undefined;
    if (found.kind !== 'file') {
      const local = this.module.require(found.module, found.name);
      // Whatever a prefab needs, whoever names it waits for. True of a `<Prefab src=>` spawn
      // and of a component field holding the prefab to spawn later — same list, same reason:
      // `instantiate` is synchronous, so a prefab has nowhere to await.
      if (found.kind === 'prefab' && found.waits) this.inherit(local);
      return local;
    }

    const existing = this.files.get(found.href);
    if (existing) return existing;

    const local = this.module.declare(camelCase(found.stem));
    const helper = this.module.require(found.helper.module, found.helper.name);
    this.module.hoist(
      `const ${local} = ${helper}(new URL(${quote(found.href)}, import.meta.url).href);`,
    );
    this.files.set(found.href, local);
    if (found.await) this.awaited.push(local);
    return local;
  }

  /** What this document resolved a path to, without emitting anything. */
  lookup(href: string): ResolvedAsset | undefined {
    return this.resolve(href);
  }

  /**
   * Wait for a spawned prefab's own assets too.
   *
   * A prefab publishes them as `static readonly assets`, because `instantiate` is synchronous
   * and a prefab has nowhere to await. Spreading that list into the spawning scene's
   * `loadAssets` is what makes `<Prefab src="enemy.prefab.xml">` work when the enemy is a glTF —
   * and it composes, because the enemy's own list already contains whatever *it* spawned.
   */
  inherit(prefabLocal: string): void {
    const spread = `...${prefabLocal}.assets`;
    if (!this.inherited.has(spread)) {
      this.inherited.add(spread);
      this.awaited.push(spread);
    }
  }

  private readonly inherited = new Set<string>();
}
