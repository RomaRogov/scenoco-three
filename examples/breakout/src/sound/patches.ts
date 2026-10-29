import type { YM2612Preset } from 'tetorica-fm2612/ym2612synth.js';

/**
 * The FM voices, in the Mega Drive's own idiom: high feedback for grit, detuned and inharmonic
 * operators (multipliers 3, 7, 11) for the metallic ring, fast attacks and short decays.
 *
 * An operator's `tl` is attenuation — 0 loudest, 127 silent; a modulator's sets brightness, a
 * carrier's the volume. `ar`/`d1r`/`d2r`/`rr` are rates (higher is faster), `sl` the level the first
 * decay falls to (0 high, 15 low). `multi` 0 is half the note, 1 the note, 2 an octave up; `dt` 1–3
 * detunes up, 5–7 down. Which operators are carriers is the algorithm's: 4 → the 2nd and 4th, 5 → all
 * but the 1st, 7 → all four, 0–3 → only the 4th.
 */
export const patches = {
  /** Slap bass with a steel edge: two detuned stacks, the top one hit an octave up. */
  bass: {
    algorithm: 4,
    feedback: 6,
    operators: [
      { multi: 1, dt: 3, tl: 26, ar: 31, d1r: 14, sl: 7, d2r: 5, rr: 10 },
      { multi: 1, dt: 0, tl: 6, ar: 31, d1r: 9, sl: 3, d2r: 3, rr: 10 },
      { multi: 2, dt: 7, tl: 34, ar: 31, d1r: 18, sl: 9, d2r: 7, rr: 10 },
      { multi: 1, dt: 7, tl: 12, ar: 31, d1r: 10, sl: 4, d2r: 2, rr: 10 },
    ],
  },
  /** A lead that rings like struck steel: an inharmonic 7× modulator over a gritty 3× one. */
  lead: {
    algorithm: 4,
    feedback: 6,
    operators: [
      { multi: 3, dt: 1, tl: 30, ar: 31, d1r: 6, sl: 3, d2r: 2, rr: 7 },
      { multi: 1, dt: 0, tl: 4, ar: 30, d1r: 5, sl: 2, d2r: 1, rr: 7 },
      { multi: 7, dt: 6, tl: 44, ar: 31, d1r: 10, sl: 6, d2r: 3, rr: 7 },
      { multi: 1, dt: 3, tl: 14, ar: 30, d1r: 5, sl: 2, d2r: 1, rr: 7 },
    ],
  },
  /** Arpeggios: a bell-like pluck, 11× and 5× partials that die fast and leave a dark core. */
  arp: {
    algorithm: 4,
    feedback: 3,
    operators: [
      { multi: 5, dt: 2, tl: 32, ar: 31, d1r: 16, sl: 8, d2r: 8, rr: 9 },
      { multi: 1, dt: 0, tl: 2, ar: 31, d1r: 12, sl: 5, d2r: 5, rr: 9 },
      { multi: 11, dt: 6, tl: 42, ar: 31, d1r: 20, sl: 10, d2r: 10, rr: 9 },
      { multi: 2, dt: 0, tl: 8, ar: 31, d1r: 14, sl: 6, d2r: 6, rr: 9 },
    ],
  },
  /** A dark pad: three detuned carriers swelling in under one soft modulator. */
  pad: {
    algorithm: 5,
    feedback: 5,
    operators: [
      { multi: 1, dt: 0, tl: 34, ar: 14, d1r: 4, sl: 3, d2r: 1, rr: 5 },
      { multi: 1, dt: 3, tl: 18, ar: 12, d1r: 3, sl: 2, d2r: 0, rr: 5 },
      { multi: 2, dt: 6, tl: 28, ar: 13, d1r: 4, sl: 3, d2r: 1, rr: 5 },
      { multi: 0, dt: 7, tl: 20, ar: 12, d1r: 3, sl: 2, d2r: 0, rr: 5 },
    ],
  },
  /** The kick: one pure carrier, its pitch swept down by the sequencer, gone in a beat. */
  kick: {
    algorithm: 7,
    feedback: 0,
    operators: [
      { tl: 127, ar: 31, rr: 15 },
      { tl: 127, ar: 31, rr: 15 },
      { multi: 1, tl: 40, ar: 31, d1r: 16, sl: 15, d2r: 0, rr: 15 },
      { multi: 1, tl: 0, ar: 31, d1r: 11, sl: 15, d2r: 0, rr: 13 },
    ],
  },
  /** An orchestra-hit stab, as Streets of Rage stacked them: brassy, gritty, cut short. */
  stab: {
    algorithm: 4,
    feedback: 7,
    operators: [
      { multi: 1, dt: 3, tl: 22, ar: 31, d1r: 10, sl: 5, d2r: 4, rr: 9 },
      { multi: 1, dt: 0, tl: 6, ar: 31, d1r: 8, sl: 4, d2r: 3, rr: 9 },
      { multi: 3, dt: 6, tl: 30, ar: 31, d1r: 12, sl: 6, d2r: 5, rr: 9 },
      { multi: 2, dt: 0, tl: 10, ar: 31, d1r: 9, sl: 4, d2r: 3, rr: 9 },
    ],
  },
  /** A metallic clank: inharmonic partials, no pitch to speak of. */
  clank: {
    algorithm: 4,
    feedback: 7,
    operators: [
      { multi: 11, dt: 5, tl: 18, ar: 31, d1r: 22, sl: 12, d2r: 14, rr: 12 },
      { multi: 1, dt: 0, tl: 8, ar: 31, d1r: 18, sl: 10, d2r: 12, rr: 11 },
      { multi: 7, dt: 2, tl: 24, ar: 31, d1r: 24, sl: 12, d2r: 14, rr: 12 },
      { multi: 3, dt: 6, tl: 14, ar: 31, d1r: 20, sl: 11, d2r: 12, rr: 11 },
    ],
  },
  /** A laser's zap: maximum feedback on a single stack, swept down. */
  zap: {
    algorithm: 0,
    feedback: 7,
    operators: [
      { multi: 2, dt: 0, tl: 20, ar: 31, d1r: 10, sl: 6, d2r: 6, rr: 12 },
      { multi: 1, dt: 3, tl: 26, ar: 31, d1r: 10, sl: 6, d2r: 6, rr: 12 },
      { multi: 3, dt: 0, tl: 30, ar: 31, d1r: 12, sl: 7, d2r: 6, rr: 12 },
      { multi: 1, dt: 0, tl: 4, ar: 31, d1r: 12, sl: 8, d2r: 8, rr: 12 },
    ],
  },
} satisfies Record<string, YM2612Preset>;

export type Patch = keyof typeof patches;

/** Which operators sound, by algorithm: the ones a channel's volume scales. */
export const CARRIERS: readonly (readonly number[])[] = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
