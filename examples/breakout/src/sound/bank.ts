import { Engine, type Chips, type Pcm } from './engine.js';

/**
 * A sound effect as a score: what the chips do at which second, and how long it rings. Each is
 * rendered once on its own pair of chips and kept, so it plays the moment it is asked for and never
 * takes a channel from the music.
 */
export interface Score {
  length: number;
  at: [seconds: number, play: (e: Engine) => void][];
}

/** Seconds between a score's ticks: where its events may fall. */
export const TICK = 0.004;

/** Sweep an FM channel from one pitch to another over `seconds`, as ticks of the score. */
export function sweep(at: Score['at'], channel: number, from: number, to: number, start: number, seconds: number): void {
  const steps = Math.max(1, Math.round(seconds / TICK));
  for (let i = 0; i <= steps; i++) at.push([start + i * TICK, (e) => e.bend(channel, from * (to / from) ** (i / steps))]);
}

/** The PSG's noise, struck and fading by one step of attenuation every `fade` seconds. */
export function noise(at: Score['at'], start: number, loud: number, fade: number, rate: 'low' | 'medium' | 'high' = 'high'): void {
  at.push([start, (e) => e.chips.tone.noise({ type: 'white', rate, attenuation: loud })]);
  for (let level = loud + 1; level <= 15; level++) at.push([start + (level - loud) * fade, (e) => e.chips.tone.setAttenuation(3, level)]);
}

/** Three channels struck together as one chord: an orchestra hit. */
export function stab(at: Score['at'], start: number, notes: number[], release: number): void {
  notes.forEach((n, ch) => {
    at.push([start, (e) => e.note(ch, n)]);
    at.push([start + release, (e) => e.release(ch)]);
  });
}

/** Renders sound effects on chips of their own, and keeps each rendering. */
export class SfxBank {
  private readonly chips: Chips;
  private readonly rate: number;
  private readonly kept = new Map<string, Pcm>();

  constructor(chips: Chips, rate: number) {
    this.chips = chips;
    this.rate = rate;
  }

  /** The effect kept as `id`: rendered from `score()` the first time, kept after. */
  get(id: string, score: () => Score): Pcm {
    let pcm = this.kept.get(id);
    if (!pcm) this.kept.set(id, (pcm = this.render(score())));
    return pcm;
  }

  private render(score: Score): Pcm {
    // A clean slate each time: the last effect's registers, and its tail, are not this one's.
    const { fm, tone } = this.chips;
    fm.reset();
    tone.allNotesOff();
    tone.noiseOff();
    const events = score.at.sort((a, b) => a[0] - b[0]);
    let next = 0;
    let time = 0;
    const engine = new Engine(this.chips, this.rate, () => {
      while (next < events.length && events[next]![0] <= time + 1e-9) events[next++]![1](engine);
      time += TICK;
    });
    engine.tickSeconds = TICK;
    // The chips' own tails are flushed first, so a previous effect's release does not leak in.
    this.chips.ym.generateStereo(256);
    this.chips.psg.generateStereo(256);
    const pcm = engine.render(Math.round(score.length * this.rate));
    // The last few milliseconds fade, so an effect cut at its length ends in silence, not a click.
    const fade = Math.min(pcm.left.length, Math.round(0.008 * this.rate));
    for (let i = 0; i < fade; i++) {
      const k = pcm.left.length - 1 - i;
      pcm.left[k]! *= i / fade;
      pcm.right[k]! *= i / fade;
    }
    return pcm;
  }
}
