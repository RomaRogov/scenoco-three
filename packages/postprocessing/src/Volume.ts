import { ACESFilmicToneMapping, Color, HalfFloatType, NeutralToneMapping, NoToneMapping, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Vector3, type ToneMapping } from 'three';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Behaviour, QualitySettings, System, Time, gameOf, service, type BehaviourType, type Game } from '@scenoco-three/core';
import { Bloom, ChromaticAberration, ColorAdjustments, DepthOfField, FilmGrain, Tonemapping, Vignette } from './Effects.js';

/** Everything that needs only the pixel it is at: one pass, so a few effects cost as little as one. */
const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1 },
    contrast: { value: 1 },
    saturation: { value: 1 },
    hue: { value: 0 },
    colorFilter: { value: new Color('#ffffff') },
    fringe: { value: 0 },
    vignette: { value: 0 },
    softness: { value: 1 },
    vignetteColor: { value: new Color('#000000') },
    center: { value: new Vector2(0.5, 0.5) },
    grain: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure, contrast, saturation, hue, fringe, vignette, softness, grain, time;
    uniform vec3 colorFilter, vignetteColor;
    uniform vec2 center;
    varying vec2 vUv;
    void main() {
      vec2 off = (vUv - 0.5) * fringe * 0.05;
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, base.g, texture2D(tDiffuse, vUv - off).b);
      c *= exposure;
      c = max((c - 0.18) * contrast + 0.18, 0.0) * colorFilter;
      const vec3 axis = vec3(0.57735);
      c = c * cos(hue) + cross(axis, c) * sin(hue) + axis * dot(axis, c) * (1.0 - cos(hue));
      c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, saturation);
      vec2 d = abs(vUv - center) * vignette * 3.0;
      c *= mix(vignetteColor, vec3(1.0), pow(clamp(1.0 - dot(d, d), 0.0, 1.0), softness * 5.0));
      float speck = fract(sin(dot(vUv + fract(time), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      gl_FragColor = vec4(max(c + c * speck * grain, 0.0), base.a);
    }
  `,
};

const CURVES: Record<Tonemapping['mode'], ToneMapping> = { None: NoToneMapping, Neutral: NeutralToneMapping, ACES: ACESFilmicToneMapping };

/** What draws a game with a Volume in it: it takes over `game.render` while there is one. */
class VolumeStack extends System {
  private readonly volumes = new Set<Volume>();
  private game: Game | null = null;
  private plain: (() => void) | null = null;
  private plainCurve: ToneMapping = NoToneMapping;
  private passes: ReturnType<typeof makePasses> | null = null;
  private readonly size = new Vector2();
  private readonly drawn = new Vector2();
  private ratio = 0;
  private warned = false;

  add(volume: Volume): void {
    this.volumes.add(volume);
    if (this.game) return;
    this.game = gameOf(volume.node);
    if (!this.game) return;
    this.plain = this.game.render;
    this.plainCurve = this.game.renderer.toneMapping;
    this.game.render = () => this.draw();
  }

  remove(volume: Volume): void {
    this.volumes.delete(volume);
    if (this.volumes.size > 0 || !this.game) return;
    this.game.render = this.plain!;
    this.game.renderer.toneMapping = this.plainCurve;
    this.game = null;
    this.passes?.composer.dispose();
    this.passes = null;
    this.drawn.set(0, 0);
  }

  override onDestroy(): void {
    this.passes?.composer.dispose();
  }

  /** Per effect, the highest-priority Volume that has it, on, wins; the newest of equals. */
  private pick<T extends Behaviour>(type: BehaviourType<T>): T | null {
    let best: T | null = null;
    let priority = -Infinity;
    for (const volume of this.volumes) {
      if (volume.priority < priority) continue;
      const found = volume.getComponents(type).find((c) => c.enabled);
      if (found) {
        best = found;
        priority = volume.priority;
      }
    }
    return best;
  }

  private draw(): void {
    const game = this.game!;
    const renderer = game.renderer;
    const curve = this.pick(Tonemapping);
    renderer.toneMapping = curve ? CURVES[curve.mode] : this.plainCurve;
    // A quality level without post-processing: the scene as the game draws it, its tone curve kept.
    if (!QualitySettings.postProcessing) return this.plain!();

    const bloom = this.pick(Bloom);
    const grade = this.pick(ColorAdjustments);
    const vignette = this.pick(Vignette);
    const fringe = this.pick(ChromaticAberration);
    const grain = this.pick(FilmGrain);
    let lens = this.pick(DepthOfField);
    if (lens && !(game.camera as PerspectiveCamera | null)?.isPerspectiveCamera) {
      if (!this.warned) console.warn('DepthOfField works with a perspective camera only: this one draws without it.');
      this.warned = true;
      lens = null;
    }
    const graded = grade || vignette || fringe || grain;
    if (!bloom && !graded && !lens) return this.plain!();

    const passes = (this.passes ??= makePasses(game));
    renderer.getSize(this.size);
    if (!this.size.equals(this.drawn) || renderer.getPixelRatio() !== this.ratio) {
      this.drawn.copy(this.size);
      this.ratio = renderer.getPixelRatio();
      passes.composer.setPixelRatio(this.ratio);
      passes.composer.setSize(this.size.x, this.size.y);
    }
    const camera = game.camera!;
    passes.scene.camera = camera;

    passes.lens.enabled = !!lens;
    if (lens) {
      const u = passes.lens.uniforms as Record<string, { value: number }>;
      passes.lens.camera = camera;
      u.focus!.value = lens.focusDistance;
      // The lens's opening in metres, as the focal length over the f-stop says.
      u.aperture!.value = lens.focalLength / 1000 / lens.aperture;
      u.maxblur!.value = 0.01;
      u.aspect!.value = (camera as PerspectiveCamera).aspect;
      u.nearClip!.value = (camera as PerspectiveCamera).near;
      u.farClip!.value = (camera as PerspectiveCamera).far;
    }
    passes.bloom.enabled = !!bloom;
    if (bloom) {
      passes.bloom.threshold = bloom.threshold;
      passes.bloom.strength = bloom.intensity / UNREAL_GAIN;
      passes.bloom.radius = bloom.scatter;
      (passes.bloom as unknown as { bloomTintColors: Vector3[] }).bloomTintColors.forEach((v) => v.set(bloom.tint.r, bloom.tint.g, bloom.tint.b));
    }
    passes.grade.enabled = !!graded;
    if (graded) {
      const u = passes.grade.uniforms as unknown as typeof GRADE.uniforms;
      u.exposure.value = 2 ** (grade?.postExposure ?? 0);
      u.contrast.value = ((grade?.contrast ?? 0) + 100) / 100;
      u.saturation.value = ((grade?.saturation ?? 0) + 100) / 100;
      u.hue.value = ((grade?.hueShift ?? 0) * Math.PI) / 180;
      u.colorFilter.value.copy(grade?.colorFilter ?? WHITE);
      u.fringe.value = fringe?.intensity ?? 0;
      u.vignette.value = vignette?.intensity ?? 0;
      u.softness.value = vignette?.smoothness ?? 1;
      u.vignetteColor.value.copy(vignette?.color ?? WHITE);
      u.center.value.copy(vignette?.center ?? MIDDLE);
      u.grain.value = grain?.intensity ?? 0;
      u.time.value = Time.unscaledTime;
    }
    passes.composer.render();
  }
}

/**
 * URP's bloom: what is above the threshold, with a soft knee, spread by a blur that keeps its energy,
 * then added `intensity` times. three's UnrealBloomPass keeps the whole of a pixel over its threshold
 * and adds nine times its blur at strength 1 — three for "compatibility", times mip weights summing to
 * three at any radius — so URP's values there wash a bright scene out. The threshold below is URP's
 * prefilter, and the strength is divided by that gain.
 */
const UNREAL_GAIN = 9;
const PREFILTER = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    float brightness = max(texel.r, max(texel.g, texel.b));
    float knee = luminosityThreshold * 0.5 + 1e-4;
    float soft = clamp(brightness - luminosityThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    float contribution = max(soft, brightness - luminosityThreshold) / max(brightness, 1e-4);
    gl_FragColor = vec4(texel.rgb * contribution, 1.0);
  }
`;

const WHITE = new Color('#ffffff');
const MIDDLE = new Vector2(0.5, 0.5);

function makePasses(game: Game) {
  // Half-float, so colours brighter than white survive until the bloom picks them out. Multisampled
  // only if the renderer is: a game that asked for crisp edges keeps them.
  const samples = game.renderer.getContext().getContextAttributes()?.antialias ? 4 : 0;
  const composer = new EffectComposer(game.renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples }));
  const scene = new RenderPass(game.scene, game.camera!);
  const lens = new BokehPass(game.scene, game.camera!, {});
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 1, 0.7, 0.9);
  bloom.materialHighPassFilter.fragmentShader = PREFILTER;
  bloom.materialHighPassFilter.needsUpdate = true;
  const grade = new ShaderPass(GRADE);
  composer.addPass(scene);
  composer.addPass(lens);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return { composer, scene, lens, bloom, grade };
}

/**
 * URP's `Volume`: the effects on its node shape how the whole game is drawn, while it is active.
 * `<Group><Volume /><Bloom intensity={0.5} /><Tonemapping /></Group>`.
 */
export class Volume extends Behaviour {
  /** Between Volumes holding the same effect, the higher wins. */
  priority = 0;

  override onEnable(): void {
    service(this.node, VolumeStack).add(this);
  }

  override onDisable(): void {
    service(this.node, VolumeStack).remove(this);
  }
}
