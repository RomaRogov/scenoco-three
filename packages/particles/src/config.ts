import {
  AdditiveBlending,
  type Blending,
  Color,
  MathUtils,
  MeshBasicMaterial,
  NormalBlending,
  TextureLoader,
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
  Noise,
  PiecewiseBezier,
  PointEmitter,
  RectangleEmitter,
  RenderMode,
  RotationOverLife,
  SizeOverLife,
  SphereEmitter,
  Vector3,
  Vector4,
  type Behavior,
  type ParticleSystemParameters,
} from 'three.quarks';
import { defaultParticleTexture } from './particleTexture.js';

/** Unity's gravity constant — `gravityModifier` multiplies it. */
const GRAVITY = 9.81;

/**
 * The intermediate particle description — a plain JSON shape produced by both the
 * inline `<ParticleSystem>` component (from its flat props) and the `.particle.xml`
 * compiler (from its Unity module tags). `configToParameters` turns it into a live
 * three.quarks system. Angles/rotations are **degrees**; colors are hex ints; the
 * over-lifetime arrays are evenly-spaced keyframes (a gradient / a curve).
 */
export interface ParticleConfig {
  duration?: number;
  looping?: boolean;
  prewarm?: boolean;
  startLifetime?: number;
  startSpeed?: number;
  startSize?: number;
  startRotation?: number;
  startColor?: number;
  gravityModifier?: number;
  simulationSpace?: string;
  rateOverTime?: number;
  bursts?: Array<{ time: number; count: number }>;
  shape?: { type?: string; radius?: number; angle?: number; arc?: number };
  renderer?: { renderMode?: string; blending?: string; texture?: string };
  /** Color (+alpha) over lifetime — evenly-spaced hex-color keyframes. */
  colorOverLifetime?: number[];
  /** Size multiplier over lifetime — evenly-spaced value keyframes. */
  sizeOverLifetime?: number[];
  /** Angular velocity over lifetime, degrees/sec. */
  rotationOverLifetime?: number;
  noise?: { strength?: number; frequency?: number };
}

const RENDER_MODE: Record<string, RenderMode> = {
  Billboard: RenderMode.BillBoard,
  StretchedBillboard: RenderMode.StretchedBillBoard,
  HorizontalBillboard: RenderMode.HorizontalBillBoard,
  VerticalBillboard: RenderMode.VerticalBillBoard,
  Mesh: RenderMode.Mesh,
};
const BLENDING: Record<string, Blending> = { Additive: AdditiveBlending, Alpha: NormalBlending };

/** Build a live three.quarks system config from the intermediate description. */
export function configToParameters(c: ParticleConfig): ParticleSystemParameters {
  const behaviors: NonNullable<ParticleSystemParameters['behaviors']> = [];
  if (c.gravityModifier) {
    behaviors.push(new ApplyForce(new Vector3(0, -1, 0), new ConstantValue(c.gravityModifier * GRAVITY)));
  }
  if (c.colorOverLifetime?.length) behaviors.push(new ColorOverLife(gradientFromColors(c.colorOverLifetime)));
  if (c.sizeOverLifetime?.length) behaviors.push(new SizeOverLife(curveFromValues(c.sizeOverLifetime)));
  if (c.rotationOverLifetime) behaviors.push(new RotationOverLife(new ConstantValue(MathUtils.degToRad(c.rotationOverLifetime))));
  if (c.noise) behaviors.push(new Noise(new ConstantValue(c.noise.frequency ?? 2), new ConstantValue(c.noise.strength ?? 1)));

  const col = new Color(c.startColor ?? 0xffffff);
  return {
    duration: c.duration ?? 5,
    looping: c.looping ?? true,
    prewarm: c.prewarm ?? false,
    startLife: new ConstantValue(c.startLifetime ?? 5),
    startSpeed: new ConstantValue(c.startSpeed ?? 5),
    startSize: new ConstantValue(c.startSize ?? 1),
    startRotation: new ConstantValue(MathUtils.degToRad(c.startRotation ?? 0)),
    startColor: new ConstantColor(new Vector4(col.r, col.g, col.b, 1)),
    emissionOverTime: new ConstantValue(c.rateOverTime ?? 10),
    emissionBursts: (c.bursts ?? []).map((b) => ({
      time: b.time,
      count: new ConstantValue(b.count),
      cycle: 1,
      interval: 0,
      probability: 1,
    })),
    shape: toEmitter(c.shape ?? {}),
    material: particleMaterial(c.renderer?.blending, c.renderer?.texture),
    renderMode: RENDER_MODE[c.renderer?.renderMode ?? 'Billboard'] ?? RenderMode.BillBoard,
    renderOrder: 0,
    worldSpace: c.simulationSpace === 'World',
    behaviors,
  };
}

/** Unity shape → three.quarks emitter (angles/arcs are degrees in the config). */
function toEmitter(s: { type?: string; radius?: number; angle?: number; arc?: number }) {
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

/** Evenly-spaced hex colors → a three.quarks color gradient (full alpha, fading out at the end). */
function gradientFromColors(colors: number[]): Gradient {
  const stops = colors.map((hex, i): [Vector3, number] => {
    const c = new Color(hex);
    return [new Vector3(c.r, c.g, c.b), colors.length === 1 ? 0 : i / (colors.length - 1)];
  });
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

/** The particle sprite material — declared texture, or the soft round default. */
function particleMaterial(blending?: string, url?: string): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    blending: BLENDING[blending ?? 'Additive'] ?? AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const map = url ? new TextureLoader().load(url) : defaultParticleTexture();
  if (map) material.map = map; // omit when headless (no canvas) → no THREE warning
  return material;
}
