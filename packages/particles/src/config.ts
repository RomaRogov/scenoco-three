import {
  AdditiveBlending,
  type Blending,
  Color,
  MathUtils,
  MeshBasicMaterial,
  NormalBlending,
  type Texture,
} from 'three';
import {
  ApplyForce,
  Bezier,
  CircleEmitter,
  ColorOverLife,
  ConeEmitter,
  ConstantColor,
  ConstantValue,
  DonutEmitter,
  Gradient,
  HemisphereEmitter,
  Noise as NoiseBehavior,
  PiecewiseBezier,
  PointEmitter,
  RectangleEmitter,
  RenderMode,
  RotationOverLife,
  SizeOverLife,
  SphereEmitter,
  Vector3,
  Vector4,
  type ParticleSystemParameters,
} from 'three.quarks';
import { defaultParticleTexture } from './particleTexture.js';

/** Unity's gravity constant — `gravityModifier` multiplies it. */
const GRAVITY = 9.81;

/** Whether particles follow the emitter or stay where they were born. */
export type SimulationSpace = 'Local' | 'World';

/** The emitter's shape, named as Unity's `ParticleSystemShapeType` names it. */
export type ParticleShape =
  | 'Cone'
  | 'Sphere'
  | 'Hemisphere'
  | 'Circle'
  | 'Donut'
  | 'Rectangle'
  | 'Point';

/** How each particle is drawn, named as Unity's `ParticleSystemRenderMode` names it. */
export type ParticleRenderMode =
  | 'Billboard'
  | 'StretchedBillboard'
  | 'HorizontalBillboard'
  | 'VerticalBillboard'
  | 'Mesh';

/** Sprite blend mode. `Additive` glows; `Alpha` is ordinary transparency. */
export type ParticleBlending = 'Additive' | 'Alpha';

/**
 * What a particle effect is, as data: a constant in a `.ts` module, played by a `ParticleSystem`.
 *
 * ```ts
 * export const fire: ParticleEffect = {
 *   duration: 3, startLifetime: 1.6, startColor: new Color('#ffdd66'),
 *   emission: { rateOverTime: 90, bursts: [{ time: 0, count: 10 }] },
 *   shape: { type: 'Cone', radius: 0.35, angle: 14 },
 * };
 * ```
 *
 * The modules are Unity's, and are named as Unity names them, because that is the vocabulary
 * whoever writes one of these files already has.
 *
 * Every field is optional, so a partial effect is a valid one; the defaults are the ones
 * named on {@link configToParameters}. Angles and rotations are **degrees**, as in Unity's inspector. The over-lifetime curves are evenly-spaced keyframes.
 */
export interface ParticleEffect {
  /** Length of one emission cycle, in seconds. */
  duration?: number;
  /** Restart the cycle when it ends. */
  looping?: boolean;
  /** On the first cycle, start as if a full duration had already run. */
  prewarm?: boolean;
  /** Seconds each particle stays alive. */
  startLifetime?: number;
  /** Initial speed along the emission direction. */
  startSpeed?: number;
  /** Initial particle size. */
  startSize?: number;
  /** Initial roll, in degrees. */
  startRotation?: number;
  /** Initial particle colour. */
  startColor?: Color;
  /** Multiplier on Unity's gravity, applied over each particle's life. */
  gravityModifier?: number;
  /** `Local`: particles follow the emitter. `World`: they stay where they were born. */
  simulationSpace?: SimulationSpace;
  /** How many particles appear, and when. */
  emission?: Emission;
  /** The volume or surface particles spawn from. */
  shape?: Shape;
  /** How the particles are drawn. */
  renderer?: Renderer;
  /** Turbulence applied over life. */
  noise?: Noise;
  /** Colour over lifetime. */
  colorOverLifetime?: ColorOverLifetime;
  /** Size over lifetime. */
  sizeOverLifetime?: SizeOverLifetime;
  /** Spin over lifetime. */
  rotationOverLifetime?: RotationOverLifetime;
}

/** How many particles appear, and when. */
export interface Emission {
  /** Particles emitted per second. */
  rateOverTime?: number;
  /** One-off emissions at a given time in the cycle. */
  bursts?: Burst[];
}

/** One puff of particles at one moment of the cycle. */
export interface Burst {
  /** Seconds into the cycle. */
  time: number;
  /** How many particles this burst emits. */
  count: number;
}

/** The volume or surface particles spawn from. */
export interface Shape {
  type?: ParticleShape;
  radius?: number;
  /** Cone half-angle, in degrees. */
  angle?: number;
  /** How much of the shape emits, in degrees — 360 is all of it. */
  arc?: number;
}

/** How the particles are drawn. */
export interface Renderer {
  renderMode?: ParticleRenderMode;
  blending?: ParticleBlending;
  /**
   * The sprite each particle is drawn with. Omitted, they use a soft round default.
   *
   * Declared `Texture`, so an effect takes an image the same way a material's `map` does —
   * `renderer: { texture: sharedTexture(sparkUrl) }` — and the same image used by a material is
   * the same `Texture` object, uploaded once.
   */
  texture?: Texture;
}

/** Turbulence applied over each particle's life. */
export interface Noise {
  strength?: number;
  frequency?: number;
}

/** Colour over lifetime — evenly-spaced keyframes. */
export interface ColorOverLifetime {
  colors: Color[];
}

/** Size multiplier over lifetime — evenly-spaced keyframes. */
export interface SizeOverLifetime {
  curve: number[];
}

/** Spin over lifetime. */
export interface RotationOverLifetime {
  /** Degrees per second. */
  angularVelocity: number;
}

const RENDER_MODE: Record<ParticleRenderMode, RenderMode> = {
  Billboard: RenderMode.BillBoard,
  StretchedBillboard: RenderMode.StretchedBillBoard,
  HorizontalBillboard: RenderMode.HorizontalBillBoard,
  VerticalBillboard: RenderMode.VerticalBillBoard,
  Mesh: RenderMode.Mesh,
};
const BLENDING: Record<ParticleBlending, Blending> = {
  Additive: AdditiveBlending,
  Alpha: NormalBlending,
};

/**
 * Build the live three.quarks parameters from an effect.
 *
 * This is the only place the two vocabularies meet: everything above is Unity's, everything
 * three.quarks needs — generators, behaviors, emitters, radians — is made here.
 */
export function configToParameters(c: ParticleEffect): ParticleSystemParameters {
  const behaviors: NonNullable<ParticleSystemParameters['behaviors']> = [];
  if (c.gravityModifier) {
    behaviors.push(new ApplyForce(new Vector3(0, -1, 0), new ConstantValue(c.gravityModifier * GRAVITY)));
  }
  if (c.colorOverLifetime?.colors.length) {
    behaviors.push(new ColorOverLife(gradientFromColors(c.colorOverLifetime.colors)));
  }
  if (c.sizeOverLifetime?.curve.length) behaviors.push(new SizeOverLife(curveFromValues(c.sizeOverLifetime.curve)));
  if (c.rotationOverLifetime) {
    const spin = MathUtils.degToRad(c.rotationOverLifetime.angularVelocity);
    behaviors.push(new RotationOverLife(new ConstantValue(spin)));
  }
  if (c.noise) {
    const { frequency = 2, strength = 1 } = c.noise;
    behaviors.push(new NoiseBehavior(new ConstantValue(frequency), new ConstantValue(strength)));
  }

  const color = c.startColor ?? WHITE;
  return {
    duration: c.duration ?? 5,
    looping: c.looping ?? true,
    prewarm: c.prewarm ?? false,
    startLife: new ConstantValue(c.startLifetime ?? 5),
    startSpeed: new ConstantValue(c.startSpeed ?? 5),
    startSize: new ConstantValue(c.startSize ?? 1),
    startRotation: new ConstantValue(MathUtils.degToRad(c.startRotation ?? 0)),
    startColor: new ConstantColor(new Vector4(color.r, color.g, color.b, 1)),
    emissionOverTime: new ConstantValue(c.emission?.rateOverTime ?? 10),
    emissionBursts: (c.emission?.bursts ?? []).map((b) => ({
      time: b.time,
      count: new ConstantValue(b.count),
      cycle: 1,
      interval: 0,
      probability: 1,
    })),
    shape: toEmitter(c.shape ?? {}),
    material: particleMaterial(c.renderer?.blending, c.renderer?.texture),
    renderMode: RENDER_MODE[c.renderer?.renderMode ?? 'Billboard'],
    renderOrder: 0,
    worldSpace: c.simulationSpace === 'World',
    behaviors,
  };
}

const WHITE = /* @__PURE__ */ new Color(0xffffff);

/** Unity shape → three.quarks emitter. Angles and arcs are degrees in the config. */
function toEmitter(s: Shape) {
  const radius = s.radius ?? 1;
  const arc = MathUtils.degToRad(s.arc ?? 360);
  switch (s.type) {
    case 'Sphere':
      return new SphereEmitter({ radius });
    case 'Hemisphere':
      return new HemisphereEmitter({ radius, arc });
    case 'Circle':
      return new CircleEmitter({ radius, arc });
    case 'Donut':
      return new DonutEmitter({ radius, arc });
    case 'Rectangle':
      return new RectangleEmitter({ width: radius * 2, height: radius * 2 });
    case 'Point':
      return new PointEmitter();
    case 'Cone':
    default:
      return new ConeEmitter({ radius, angle: MathUtils.degToRad(s.angle ?? 25), arc, thickness: 1 });
  }
}

/** Evenly-spaced colours → a three.quarks gradient (full alpha, fading out at the end). */
function gradientFromColors(colors: Color[]): Gradient {
  const stops = colors.map((color, i): [Vector3, number] => [
    new Vector3(color.r, color.g, color.b),
    colors.length === 1 ? 0 : i / (colors.length - 1),
  ]);
  // Fade alpha to zero over the last third so particles die out softly.
  const alpha: Array<[number, number]> = [
    [1, 0],
    [1, 0.7],
    [0, 1],
  ];
  return new Gradient(stops, alpha);
}

/** Evenly-spaced values → a piecewise-linear three.quarks curve. */
function curveFromValues(values: number[]): PiecewiseBezier {
  if (values.length === 1) {
    const v = values[0]!;
    return new PiecewiseBezier([[new Bezier(v, v, v, v), 0]]);
  }
  const segments: Array<[Bezier, number]> = [];
  const n = values.length - 1;
  for (let i = 0; i < n; i++) {
    const a = values[i]!;
    const b = values[i + 1]!;
    segments.push([new Bezier(a, a + (b - a) / 3, a + (2 * (b - a)) / 3, b), i / n]);
  }
  return new PiecewiseBezier(segments);
}

/** The particle sprite material — the declared texture, or the soft round default. */
function particleMaterial(blending?: ParticleBlending, texture?: Texture): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    blending: BLENDING[blending ?? 'Additive'],
    transparent: true,
    depthWrite: false,
  });
  // Already a `Texture` (`sharedTexture(url)`); nothing here loads anything.
  const map = texture ?? defaultParticleTexture();
  if (map) material.map = map; // omit when headless (no canvas) → no THREE warning
  return material;
}
