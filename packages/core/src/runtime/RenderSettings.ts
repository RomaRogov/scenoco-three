import { NoToneMapping } from 'three';
import type { Fog, FogExp2, Scene, WebGLRenderer } from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * One thing that decides how a frame is drawn — tone mapping, shadows, bloom.
 *
 * ### Why this is a class and not a property
 *
 * The renderer is not part of the scene graph, so there is no three.js object to hang "this
 * level glows" on. The previous answer was to graft `bloom`, `shadows` and `toneMapping` onto
 * `THREE.Scene` as extra properties, and it was the wrong one twice over: `scene.toneMapping`
 * does not exist in three.js (it is `renderer.toneMapping`), and a scalar with an off-value —
 * `bloom="0"` — makes `bloomRadius` an attribute that silently does nothing.
 *
 * As classes, all of that goes away. An effect is *there* because the document wrote the
 * element, exactly as a component is; its attributes are its own fields; and nothing on a
 * three.js class pretends to be a three.js property.
 *
 * Both hooks are optional and an effect usually has one:
 *
 * ```ts
 * export class Shadows extends Effect {
 *   enabled = true;
 *   override apply(renderer: WebGLRenderer) { renderer.shadowMap.enabled = this.enabled; }
 * }
 *
 * export class Bloom extends Effect {
 *   strength = 0.75;
 *   override createPass() { return new UnrealBloomPass(…); }
 * }
 * ```
 *
 * The concrete effects live in a package (`@scenoco-three/postfx`), not here: core defines the
 * model, packages provide the vocabulary — the same division three, box2d and ui already have.
 */
export abstract class Effect {
  /**
   * Configure the frame while a scene using these settings is the active one.
   *
   * Called when the settings become current, not every frame. Whatever it writes is restored to
   * the default when a scene without it is loaded, so one level's look cannot leak into the next.
   */
  apply?(target: { renderer: WebGLRenderer; scene: Scene }): void;

  /**
   * A postprocessing pass to insert into the chain, in document order.
   *
   * Called once, when the chain is built. An effect that declares one makes the engine build an
   * `EffectComposer` — and a project whose scenes declare none never loads a byte of three's
   * postprocessing addons.
   */
  createPass?(): Pass;
}

/**
 * How a scene is drawn: the render document (`*.render.xml`) compiles to one of these, and a
 * scene names it with `<Scene render="…">`.
 *
 * It is an asset rather than a block inside the scene because a *look* is shared — three levels
 * of one game are lit and graded the same way, and the alternative is the same six values
 * copied into three documents, drifting one edit at a time. That is the same reason a material
 * is a file.
 */
export class RenderSettings {
  /** In document order. `apply` runs in that order; passes are chained in it. */
  readonly effects: readonly Effect[];

  /**
   * The scene's fog, if the document declared one — `scene.fog`, set while these settings are
   * current and cleared when they are not.
   *
   * Fog lives here rather than in the scene document for a rule, not a preference: under
   * `<Scene>` every bare element is a node, because that document *is* the tree. `Fog` is not a
   * node, so it belongs where the other non-node, non-behaviour things live — beside the tone
   * curve and the bloom that it works with anyway.
   */
  readonly fog: Fog | FogExp2 | null;

  constructor(effects: readonly Effect[] = [], fog: Fog | FogExp2 | null = null) {
    this.effects = effects;
    this.fog = fog;
  }
}

/**
 * Which render settings are currently in force, and what changing them costs.
 *
 * A separate object because the bookkeeping is where this goes wrong, and it went wrong exactly
 * once already: three levels naming one render document share **one** `RenderSettings`
 * instance, so remembering only "which settings" and skipping when they match meant every level
 * after the first got no fog — `scene.fog` is state on the scene, not on the renderer, and the
 * second scene is a different scene. What has to be remembered is the *pair*.
 */
export class RenderState {
  private settings: RenderSettings | null = null;
  private scene: Scene | null = null;

  /**
   * Make `scene`'s settings current. Returns true when the **pass chain** has to be rebuilt,
   * which is only when the document itself changed — a level change that keeps the same look
   * keeps its chain, and does not flash a frame without the effects.
   */
  apply(renderer: WebGLRenderer, scene: Scene): boolean {
    const settings = scene.render;
    const sameSettings = settings === this.settings;
    if (sameSettings && scene === this.scene) return false;
    this.settings = settings;
    this.scene = scene;

    // Defaults first, then whatever this scene asks for. Without the reset, turning an effect
    // off would mean removing an element *and* knowing which field it had written.
    renderer.toneMapping = NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = false;
    scene.fog = settings?.fog ?? null;
    for (const effect of settings?.effects ?? []) effect.apply?.({ renderer, scene });

    return !sameSettings;
  }

  /** Forget what was applied, so the next `apply` writes everything again. */
  reset(): void {
    this.settings = null;
    this.scene = null;
  }
}
