import { NoToneMapping } from 'three';
import type { Fog, FogExp2, Scene, WebGLRenderer } from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * One thing that decides how a frame is drawn — tone mapping, shadows, bloom. Its settings are
 * its own fields; both hooks are optional, and an effect usually has one.
 *
 * Core defines the model; the concrete effects live in `@scenoco-three/postfx`.
 */
export abstract class Effect {
  /**
   * Configure the frame, when these settings become current rather than every frame. Whatever
   * it writes is reset for a scene without it, so one level's look cannot leak into the next.
   */
  apply?(target: { renderer: WebGLRenderer; scene: Scene }): void;

  /** A postprocessing pass for the chain. Called once, when the chain is built. */
  createPass?(): Pass;
}

/**
 * How a scene is drawn — a set of effects, and the fog. Its own object because a look is shared:
 * three levels of one game are lit and graded the same way.
 */
export class RenderSettings {
  /** In order: `apply` runs in it, and passes are chained in it. */
  readonly effects: readonly Effect[];

  /** The scene's fog — set while these settings are current, cleared when they are not. */
  readonly fog: Fog | FogExp2 | null;

  constructor(effects: readonly Effect[] = [], fog: Fog | FogExp2 | null = null) {
    this.effects = effects;
    this.fog = fog;
  }
}

/**
 * Which render settings are currently in force, and on which scene.
 *
 * The **pair** matters: three levels can share one `RenderSettings`, and skipping on matching
 * settings alone leaves every level after the first with no fog, because `scene.fog` is state
 * on the scene rather than on the renderer.
 */
export class RenderState {
  private settings: RenderSettings | null = null;
  private scene: Scene | null = null;

  /**
   * Make `scene`'s settings current. True when the pass chain has to be rebuilt, which is only
   * when the settings themselves changed.
   */
  apply(renderer: WebGLRenderer, scene: Scene): boolean {
    const settings = scene.render;
    const sameSettings = settings === this.settings;
    if (sameSettings && scene === this.scene) return false;
    this.settings = settings;
    this.scene = scene;

    // Defaults first: otherwise turning an effect off means knowing which field it wrote.
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
