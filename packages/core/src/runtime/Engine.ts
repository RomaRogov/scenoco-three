import {
  PerspectiveCamera,
  WebGLRenderer,
  type Camera,
  type Scene,
  type WebGLRendererParameters,
} from 'three';
import { SceneManager } from './SceneManager.js';
import { Time } from './Time.js';
import { Input } from '../input/Input.js';
import { EffectChain } from './EffectChain.js';
import { RenderState, type Effect } from './RenderSettings.js';

export interface EngineOptions {
  /** Existing canvas to draw into. One is created and appended to `container` if omitted. */
  canvas?: HTMLCanvasElement;
  /** Element the canvas is sized against and appended to. Defaults to `document.body`. */
  container?: HTMLElement;
  /** Extra parameters forwarded to the `WebGLRenderer` constructor. */
  renderer?: WebGLRendererParameters;
  /** Cap for `devicePixelRatio`. Defaults to 2 — beyond that the cost rarely shows. */
  maxPixelRatio?: number;
  /** Fixed timestep in seconds. Defaults to 1/50. */
  fixedTimeStep?: number;
  /** Pause the loop when the tab is hidden. Defaults to true. */
  pauseWhenHidden?: boolean;
}

/**
 * The host: owns the renderer, the animation frame loop and canvas sizing, and pumps
 * `SceneManager` once per frame.
 *
 * It is entirely optional. If you already have a render loop, drop `Engine` and call
 * `SceneManager.tick(timestamp)` yourself before rendering.
 */
export class Engine {
  /**
   * The engine driving this page, or `null` where there is none — a test, a server render.
   * There is one host, and a system needing the canvas reads it here rather than being handed
   * it through every layer in between.
   */
  static current: Engine | null = null;

  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly container: HTMLElement;

  /** Runs after the event cycle, before the draw call. */
  onBeforeRender: (() => void) | null = null;
  /** Runs after the draw call. */
  onAfterRender: (() => void) | null = null;

  private readonly maxPixelRatio: number;
  private readonly pauseWhenHidden: boolean;
  private frameHandle: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unwatchScenes: (() => void) | null = null;
  private running = false;
  /** The post-processing chain, once a scene has asked for one. */
  private effects: EffectChain | null = null;
  /** What is currently pushed onto the renderer, so a change is noticed once. */
  private readonly renderState = new RenderState();
  /** Bumped per chain build, so a slow import cannot install a chain that is already stale. */
  private effectsGeneration = 0;
  /** Resolves when the chain a scene asked for has landed. See {@link effectsReady}. */
  private effectsPending: Promise<void> | null = null;

  constructor(options: EngineOptions = {}) {
    this.container = options.container ?? document.body;
    this.canvas = options.canvas ?? document.createElement('canvas');
    if (!this.canvas.parentElement) this.container.appendChild(this.canvas);
    this.canvas.style.display = 'block';

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      ...options.renderer,
    });
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.pauseWhenHidden = options.pauseWhenHidden ?? true;
    if (options.fixedTimeStep) Time.fixedDeltaTime = options.fixedTimeStep;

    Input.attach(this.canvas);
    Engine.current = this;
    this.observeSize();
    this.resize();
    // `resize` sets each camera's aspect, and at construction there is no scene to set it on.
    // Loading one is the other moment the answer changes, so it is the other moment to ask —
    // without this the first camera keeps three's default aspect of 1, a squashed frame.
    this.unwatchScenes = SceneManager.onSceneLoaded(() => this.resize());
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  /** True while the animation frame loop is running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Start the frame loop. Safe to call twice. */
  start(): this {
    if (this.running) return this;
    this.running = true;
    this.resize(); // whatever is active now is what the first frame draws through
    SceneManager.resetFrameClock();
    this.frameHandle = requestAnimationFrame(this.frame);
    return this;
  }

  /** Stop the frame loop. The scene keeps its state; `start` resumes without a time jump. */
  stop(): this {
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    return this;
  }

  /** Release the renderer, listeners and input handlers. */
  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unwatchScenes?.();
    this.unwatchScenes = null;
    this.effects?.dispose();
    this.effects = null;
    this.renderState.reset();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    Input.detach();
    this.renderer.dispose();
    if (Engine.current === this) Engine.current = null;
  }

  /** Match the drawing buffer and every live camera to the container's size. */
  resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    // A container with no size yet — a hidden tab, an unlaid-out panel — would make every
    // aspect `0 / 0`, and a NaN projection matrix draws nothing. Keep the last good size.
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height, true);
    this.effects?.setSize(width, height);

    const aspect = width / height;
    // Every *loaded* scene, not only the one being drawn: a scene is loaded while the outgoing
    // one is still active, so sizing the active camera alone misses it.
    for (const scene of SceneManager.loadedScenes) {
      const camera = scene.mainCamera;
      if (!camera) continue;
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
  }

  private readonly frame = (timestamp: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    SceneManager.tick(timestamp);
    // Input edges are true for exactly one frame, so they clear once every component has read them.
    Input.endFrame();

    this.onBeforeRender?.();
    this.render();
    this.onAfterRender?.();
  };

  /**
   * Draw one frame: the active scene, then whatever survived the last load, on top.
   *
   * A persistent scene draws after the active one without clearing colour, so a HUD that
   * outlives the level is drawn over it; depth *is* cleared between the two, so a 3D world
   * cannot poke through a 2D overlay.
   */
  render(): void {
    const scene = SceneManager.activeScene;
    const camera = scene?.mainCamera;
    if (!scene || !camera) return;

    this.renderScene(scene, camera);

    const overlays = SceneManager.persistentScenes;
    if (overlays.length === 0) return;
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    for (const overlay of overlays) {
      if (overlay === scene) continue;
      this.renderer.clearDepth();
      this.renderer.render(overlay, overlay.mainCamera ?? camera);
    }
    this.renderer.autoClear = autoClear;
  }

  /**
   * Draw one scene through one camera with that scene's render settings applied — what a
   * preview or a capture outside the loop should call, since `renderer.render` skips tone
   * mapping and every post pass.
   */
  renderScene(scene: Scene, camera: Camera): void {
    this.applyRenderSettings(scene);
    if (this.effects) this.effects.render(scene, camera);
    else this.renderer.render(scene, camera);
  }

  /**
   * Size the drawing buffer and the post-processing chain together, for a host capturing at
   * some resolution other than the container's. A composer left at the old size renders its
   * passes at the wrong scale.
   */
  setFrameSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.effects?.setSize(width, height);
  }

  /**
   * Make the active scene's render settings current — on change, not every frame: assigning
   * `toneMapping` invalidates every shader the renderer has built.
   */
  private applyRenderSettings(scene: Scene): void {
    if (!this.renderState.apply(this.renderer, scene)) return;

    this.effects?.dispose();
    this.effects = null;
    const passes = (scene.render?.effects ?? []).filter((effect) => effect.createPass);
    if (passes.length > 0) this.buildEffects(passes);
  }

  /**
   * Bring up the post-processing chain for the effects that declare a pass. Loaded on demand,
   * so frames drawn before the import lands are drawn straight rather than not at all.
   */
  private buildEffects(effects: readonly Effect[]): void {
    const generation = ++this.effectsGeneration;
    this.effectsPending = EffectChain.create(this.renderer, effects)
      .then((chain) => {
        // The settings may have changed again, or the engine been disposed, mid-import.
        if (Engine.current !== this || generation !== this.effectsGeneration) return chain.dispose();
        this.effects = chain;
        this.resize();
      })
      .catch((error: unknown) => {
        console.error('[scenoco] post-processing is unavailable; rendering without it.', error);
      });
    void this.effectsPending;
  }

  /**
   * Resolves once the post-processing chain the active scene asked for is in place. A game
   * never notices the frame or two without it; anything that draws *once* and looks at the
   * result — a screenshot — must await this first.
   */
  async effectsReady(): Promise<void> {
    await this.effectsPending;
  }

  private readonly handleVisibility = (): void => {
    if (!this.pauseWhenHidden) return;
    // rAF already stalls while hidden. What matters is that the frame on the way back does not
    // carry the whole background duration as its delta, and that held keys do not stick.
    SceneManager.resetFrameClock();
    if (document.hidden) Input.clear();
  };

  private observeSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', () => this.resize());
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }
}
