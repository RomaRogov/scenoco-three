import {
  PerspectiveCamera,
  WebGLRenderer,
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
   *
   * Unity's `Camera.main` and `Application` are statics for the same reason: there is one host,
   * and something has to be able to reach its renderer without every layer in between passing it
   * down. A system that needs the canvas — the UI renderer needs it to size the screen and to
   * forward pointer events — reads it here, and behaves itself when it is null.
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
    // A camera's aspect is set by `resize`, and at construction there is no scene to set it on:
    // every project builds the engine first and loads a scene second, which left the very first
    // camera at three's default aspect of 1 until something happened to resize the window. On a
    // wide canvas that is a horizontally squashed frame — and on a game with a fixed playfield,
    // the edges of the field simply are not on screen. Loading a scene is the other moment the
    // answer changes, so it is the other moment to ask.
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
    // A container with no size yet — a hidden tab, a panel that has not been laid out — would
    // otherwise make every camera's aspect `0 / 0`, and a NaN projection matrix draws nothing at
    // all. There is no useful answer at this size, so the last good one is kept until there is.
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(width, height, true);
    this.effects?.setSize(width, height);

    const aspect = width / height;
    // Every *loaded* scene, not only the one being drawn. A scene is loaded before it becomes
    // active — `onSceneLoaded` fires from inside the load, while the outgoing scene is still the
    // active one — so sizing only the active camera left every scene after the first at three's
    // default aspect of 1, which is a squashed frame and a cropped playfield.
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
    // Input edges (`getKeyDown`, `getMouseButtonDown`) are true for exactly one frame, so
    // they must be cleared after every component has had its chance to read them.
    Input.endFrame();

    this.onBeforeRender?.();
    this.render();
    this.onAfterRender?.();
  };

  /**
   * Draw one frame: the active scene, then whatever survived the last load, on top.
   *
   * A persistent scene is drawn after the active one **without clearing**, through its own
   * camera when it has one. That is what makes `dontDestroyOnLoad` visible rather than merely
   * alive: a HUD scene that outlives the level is drawn over the level, and the depth buffer is
   * cleared between the two so a 3D world cannot poke through a 2D overlay.
   */
  render(): void {
    const scene = SceneManager.activeScene;
    const camera = scene?.mainCamera;
    if (!scene || !camera) return;

    this.applyRenderSettings(scene);
    if (this.effects) this.effects.render(scene, camera);
    else this.renderer.render(scene, camera);

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
   * Make the active scene's render settings current.
   *
   * Applied when the settings *change*, not every frame: assigning `toneMapping` invalidates
   * every compiled shader, so doing it unconditionally would rebuild the program cache sixty
   * times a second. A scene that names no settings gets the renderer's defaults back, so one
   * level's look cannot leak into the next.
   */
  /**
   * Make the active scene's render settings current.
   *
   * The work is `RenderState`'s, which is also where the "has this changed?" bookkeeping lives:
   * assigning `toneMapping` invalidates every compiled shader, so it must not happen sixty
   * times a second, and the pass chain must not be rebuilt for a level that shares its look.
   */
  private applyRenderSettings(scene: Scene): void {
    if (!this.renderState.apply(this.renderer, scene)) return;

    this.effects?.dispose();
    this.effects = null;
    const passes = (scene.render?.effects ?? []).filter((effect) => effect.createPass);
    if (passes.length > 0) this.buildEffects(passes);
  }

  /**
   * Bring up the post-processing chain for the effects that declare a pass.
   *
   * Loaded on demand and never before: `EffectComposer` and its dependencies are a real chunk
   * of three's addons, and a game whose scenes declare no passes must not pay for them. Until
   * the import lands, frames are drawn straight — a frame or two without the effect, not a
   * blank screen.
   */
  private buildEffects(effects: readonly Effect[]): void {
    const generation = ++this.effectsGeneration;
    void EffectChain.create(this.renderer, effects)
      .then((chain) => {
        // The settings may have changed again, or the engine been disposed, while the import
        // was in flight.
        if (Engine.current !== this || generation !== this.effectsGeneration) return chain.dispose();
        this.effects = chain;
        this.resize();
      })
      .catch((error: unknown) => {
        console.error('[scenoco] post-processing is unavailable; rendering without it.', error);
      });
  }

  private readonly handleVisibility = (): void => {
    if (!this.pauseWhenHidden) return;
    // rAF already stalls while the tab is hidden, so there is nothing to pause. What matters
    // is that the frame landing on the way back does not carry the whole background duration
    // as its delta — and that held keys do not stay stuck down.
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
