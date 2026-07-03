import type { ParsedElement, SrcCompileResult, SrcDiagnostic } from '@scenoco-three/core';
import type { ParticleConfig } from './config.js';

type Emit = (message: string, code?: string) => void;

/**
 * Compile a `.particle.xml` document (root `<ParticleSystem>` with Unity module
 * child tags) into the intermediate {@link ParticleConfig}. Registered via
 * `registerSrcCompiler('ParticleSystem', …)` so the core compiler delegates the
 * component's `src=` here — the format is owned entirely by this package.
 *
 * Attribute formats match the rest of SceNoCo: `x y z` vectors, `#hex` colors,
 * `[a, b, c]` arrays (a color gradient / a value curve are just arrays).
 */
export function compileParticleDocument(root: ParsedElement): SrcCompileResult {
  const diagnostics: SrcDiagnostic[] = [];
  const err: Emit = (message, code) => diagnostics.push({ message, ...(code ? { code } : {}) });

  if (root.tag !== 'ParticleSystem') {
    err(`a .particle.xml needs a <ParticleSystem> root, got <${root.tag}>`, 'particle-bad-root');
    return { diagnostics };
  }

  const config: ParticleConfig = {};
  const a = root.attributes;
  // Main module — root attributes.
  num(a.duration, (v) => (config.duration = v));
  bool(a.looping, (v) => (config.looping = v));
  bool(a.prewarm, (v) => (config.prewarm = v));
  num(a.startLifetime, (v) => (config.startLifetime = v));
  num(a.startSpeed, (v) => (config.startSpeed = v));
  num(a.startSize, (v) => (config.startSize = v));
  num(a.startRotation, (v) => (config.startRotation = v));
  color(a.startColor, (v) => (config.startColor = v), err);
  num(a.gravityModifier, (v) => (config.gravityModifier = v));
  if (a.simulationSpace) config.simulationSpace = a.simulationSpace;

  // Modules — child tags.
  for (const child of root.children) {
    const c = child.attributes;
    switch (child.tag) {
      case 'Emission': {
        num(c.rateOverTime, (v) => (config.rateOverTime = v));
        const bursts = child.children
          .filter((x) => x.tag === 'Burst')
          .map((b) => ({ time: toNum(b.attributes.time) ?? 0, count: toNum(b.attributes.count) ?? 0 }));
        if (bursts.length) config.bursts = bursts;
        break;
      }
      case 'Shape': {
        const shape: NonNullable<ParticleConfig['shape']> = {};
        if (c.type) shape.type = c.type;
        num(c.radius, (v) => (shape.radius = v));
        num(c.angle, (v) => (shape.angle = v));
        num(c.arc, (v) => (shape.arc = v));
        config.shape = shape;
        break;
      }
      case 'Renderer': {
        const r: NonNullable<ParticleConfig['renderer']> = {};
        if (c.renderMode) r.renderMode = c.renderMode;
        if (c.blending) r.blending = c.blending;
        if (c.texture) r.texture = c.texture;
        config.renderer = r;
        break;
      }
      case 'ColorOverLifetime':
        config.colorOverLifetime = colorArray(c.colors, err);
        break;
      case 'SizeOverLifetime':
        config.sizeOverLifetime = floatArray(c.curve, err);
        break;
      case 'RotationOverLifetime':
        num(c.angularVelocity, (v) => (config.rotationOverLifetime = v));
        break;
      case 'Noise': {
        const n: NonNullable<ParticleConfig['noise']> = {};
        num(c.strength, (v) => (n.strength = v));
        num(c.frequency, (v) => (n.frequency = v));
        config.noise = n;
        break;
      }
      default:
        err(`unknown particle module <${child.tag}>`, 'particle-unknown-module');
    }
  }

  return { config, diagnostics };
}

// ── format parsers (consistent with SceNoCo codecs) ──────────────────────────────

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function toNum(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const v = Number(raw.trim());
  return Number.isFinite(v) ? v : undefined;
}
function num(raw: string | undefined, set: (v: number) => void): void {
  const v = toNum(raw);
  if (v !== undefined) set(v);
}
function bool(raw: string | undefined, set: (v: boolean) => void): void {
  if (raw !== undefined) set(raw.trim() === 'true');
}
function parseHex(raw: string): number | null {
  const m = HEX.exec(raw.trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = [...hex].map((ch) => ch + ch).join('');
  return parseInt(hex, 16);
}
function color(raw: string | undefined, set: (v: number) => void, err: Emit): void {
  if (raw === undefined) return;
  const v = parseHex(raw);
  if (v === null) err(`expected a hex color like "#ffcc00", got "${raw}"`, 'particle-bad-color');
  else set(v);
}
/** Split a `[a, b, c]` literal into trimmed element strings (SceNoCo array form). */
function splitArray(raw: string): string[] {
  return raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
function floatArray(raw: string | undefined, err: Emit): number[] | undefined {
  if (raw === undefined) return undefined;
  const out = splitArray(raw).map(Number);
  if (!out.length || out.some((v) => !Number.isFinite(v))) {
    err(`expected a number array like "[1, 0.5, 0]", got "${raw}"`, 'particle-bad-array');
    return undefined;
  }
  return out;
}
function colorArray(raw: string | undefined, err: Emit): number[] | undefined {
  if (raw === undefined) return undefined;
  const out: number[] = [];
  for (const p of splitArray(raw)) {
    const v = parseHex(p);
    if (v === null) {
      err(`expected a color array like "[#ffdd66, #ff3300]", got "${raw}"`, 'particle-bad-array');
      return undefined;
    }
    out.push(v);
  }
  return out.length ? out : undefined;
}
