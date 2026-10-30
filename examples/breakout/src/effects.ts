import { hz } from './sound/engine.js';
import { noise, stab, sweep, type Score } from './sound/bank.js';

/** Every sound effect, by name. */
export type SfxName = 'break' | 'clank' | 'paddle' | 'wall' | 'launch' | 'laser' | 'catch' | 'multi' | 'lose' | 'clear' | 'over' | 'win';

/** A minor pentatonic, the arcade's reward scale: no wrong note on any combo. */
const PENTATONIC = [0, 3, 5, 7, 10];
function degree(base: number, step: number): number {
  return base + 12 * Math.floor(step / 5) + PENTATONIC[((step % 5) + 5) % 5]!;
}

/** The score for `name`: `key` transposes it to the stage's key, `step` climbs the scale with a combo. */
export function score(name: SfxName, key: number, step: number): Score {
  const at: Score['at'] = [];
  const A = 57 + key; // the key's A3
  switch (name) {
    case 'break': {
      // A bright metal pluck on the combo's note, a fifth above it a breath later, and a crack of noise.
      const n = degree(A + 24, step);
      at.push([0, (e) => (e.voice(0, 'arp', 0), e.voice(1, 'arp', 10), e.note(0, n))]);
      at.push([0.025, (e) => e.note(1, n + 7)]);
      at.push([0.07, (e) => (e.release(0), e.release(1))]);
      noise(at, 0, 5, 0.006);
      return { length: 0.5, at };
    }
    case 'clank':
      at.push([0, (e) => (e.voice(0, 'clank', 0), e.note(0, A - 5))]);
      at.push([0.05, (e) => e.release(0)]);
      noise(at, 0, 3, 0.005, 'medium');
      return { length: 0.32, at };
    case 'paddle':
      at.push([0, (e) => (e.voice(0, 'bass', 0), e.note(0, A - 12))]);
      at.push([0.06, (e) => e.release(0)]);
      return { length: 0.28, at };
    case 'wall':
      at.push([0, (e) => e.chips.tone.tone(0, { frequency: hz(A + 36), attenuation: 7 })]);
      at.push([0.02, (e) => e.chips.tone.setAttenuation(0, 11)]);
      at.push([0.04, (e) => e.chips.tone.off(0)]);
      return { length: 0.06, at };
    case 'launch':
      at.push([0, (e) => (e.voice(0, 'zap', 4), e.note(0, 60))]);
      sweep(at, 0, 260, 1400, 0, 0.14);
      at.push([0.14, (e) => e.release(0)]);
      return { length: 0.3, at };
    case 'laser':
      at.push([0, (e) => (e.voice(0, 'zap', 10), e.note(0, 90))]);
      sweep(at, 0, 2400, 280, 0, 0.09);
      at.push([0.09, (e) => e.release(0)]);
      return { length: 0.16, at };
    case 'catch':
      // Up the scale, four notes, the last one left to ring.
      at.push([0, (e) => (e.voice(0, 'arp', 0), e.voice(1, 'lead', 8))]);
      [0, 2, 4, 5].forEach((s, i) => at.push([i * 0.05, (e) => (e.note(0, degree(A + 24, s)), e.note(1, degree(A + 12, s)))]));
      at.push([0.32, (e) => (e.release(0), e.release(1))]);
      return { length: 0.75, at };
    case 'multi':
      at.push([0, (e) => (e.voice(0, 'arp', 0), e.voice(1, 'arp', 4, 'left'), e.voice(2, 'arp', 4, 'right'))]);
      [0, 1, 2].forEach((ch) => at.push([ch * 0.07, (e) => e.note(ch, degree(A + 24, 2 + ch * 2))]));
      at.push([0.4, (e) => [0, 1, 2].forEach((ch) => e.release(ch))]);
      return { length: 0.85, at };
    case 'lose':
      // Two stab voices falling two octaves, a long hiss under them.
      at.push([0, (e) => (e.voice(0, 'stab', 0), e.voice(1, 'stab', 4), e.note(0, A), e.note(1, A - 5))]);
      sweep(at, 0, hz(A), hz(A) / 4, 0, 0.7);
      sweep(at, 1, hz(A - 5), hz(A - 5) / 4, 0, 0.7);
      at.push([0.7, (e) => (e.release(0), e.release(1))]);
      noise(at, 0, 2, 0.05, 'low');
      return { length: 1.4, at };
    case 'clear':
    case 'win': {
      // i – VI – VII, then the major I: the minor key brightening for a moment, as a stage ends.
      at.push([0, (e) => [0, 1, 2].forEach((ch) => e.voice(ch, 'stab', ch * 3))]);
      at.push([0, (e) => (e.voice(3, 'lead', 2), e.voice(4, 'bass', 0))]);
      const chords = [[A + 12, A + 15, A + 19], [A + 8, A + 12, A + 15], [A + 10, A + 14, A + 17], [A + 12, A + 16, A + 19]];
      const times = [0, 0.18, 0.36, 0.54];
      chords.forEach((c, i) => stab(at, times[i]!, c, i === 3 ? (name === 'win' ? 1.6 : 0.9) : 0.12));
      [A + 12, A + 7, A + 10, A + 12].forEach((b, i) => at.push([times[i]!, (e) => e.note(4, b - 12)]));
      at.push([0.54, (e) => e.note(3, A + 28)]);
      at.push([name === 'win' ? 2.1 : 1.3, (e) => (e.release(3), e.release(4))]);
      if (name === 'win') [0, 2, 4, 5, 7, 9].forEach((s, i) => at.push([0.6 + i * 0.09, (e) => (e.voice(5, 'arp', 2), e.note(5, degree(A + 24, s)))]));
      return { length: name === 'win' ? 3 : 2, at };
    }
    case 'over': {
      // Down through the minor: i – VII – VI, and the dominant left hanging.
      at.push([0, (e) => [0, 1, 2].forEach((ch) => e.voice(ch, 'stab', ch * 3))]);
      at.push([0, (e) => e.voice(4, 'bass', 0)]);
      const chords = [[A + 12, A + 15, A + 19], [A + 10, A + 14, A + 17], [A + 8, A + 12, A + 15], [A + 7, A + 11, A + 14]];
      chords.forEach((c, i) => stab(at, i * 0.32, c, i === 3 ? 1.1 : 0.22));
      [A, A - 2, A - 4, A - 5].forEach((b, i) => at.push([i * 0.32, (e) => e.note(4, b - 12)]));
      at.push([2.1, (e) => e.release(4)]);
      return { length: 2.9, at };
    }
  }
}

