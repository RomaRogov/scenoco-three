import type { YM2612Synth } from 'tetorica-fm2612/ym2612synth.js';
import type { SegaPSGSynth } from 'tetorica-fm2612/segapsgsynth.js';
import { CARRIERS, patches, type Patch } from './patches.js';

/** Stereo samples, as an AudioBuffer takes them. */
export type Pcm = { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> };

/** What makes stereo PCM at its own rate: a chip. */
interface Source {
  sampleRate(): number;
  generateStereo(frames: number): { left: Float32Array; right: Float32Array };
}

/** The Mega Drive's two sound chips, played by the same code, the YM2612 for FM and the PSG beside it. */
export interface Chips {
  ym: Source;
  psg: Source;
  fm: YM2612Synth;
  tone: SegaPSGSynth;
}

/**
 * A chip's output at another rate, carried across calls: each chip runs at its own clock (53 267 Hz
 * for the YM2612), the page at the AudioContext's. Linear interpolation over a small queue, so one
 * render continues the last with no seam.
 */
class Resampler {
  private left = new Float32Array(4096);
  private right = new Float32Array(4096);
  private length = 0;
  /** Where the next output frame falls in the queue, in source frames. */
  private position = 0;
  private readonly step: number;
  private readonly source: Source;

  constructor(source: Source, outRate: number) {
    this.source = source;
    this.step = source.sampleRate() / outRate;
  }

  /** Add `frames` output frames into `outL`/`outR` from `offset`, times `gain`. */
  mix(outL: Float32Array, outR: Float32Array, offset: number, frames: number, gain: number): void {
    const needed = Math.floor(this.position + frames * this.step) + 2;
    if (needed > this.length) this.fill(needed - this.length);
    let at = this.position;
    for (let i = 0; i < frames; i++) {
      const k = at | 0;
      const t = at - k;
      outL[offset + i]! += gain * (this.left[k]! + (this.left[k + 1]! - this.left[k]!) * t);
      outR[offset + i]! += gain * (this.right[k]! + (this.right[k + 1]! - this.right[k]!) * t);
      at += this.step;
    }
    const used = at | 0;
    this.left.copyWithin(0, used, this.length);
    this.right.copyWithin(0, used, this.length);
    this.length -= used;
    this.position = at - used;
  }

  private fill(frames: number): void {
    if (this.length + frames > this.left.length) {
      const grown = (n: Float32Array) => {
        const next = new Float32Array((this.length + frames) * 2);
        next.set(n.subarray(0, this.length));
        return next;
      };
      this.left = grown(this.left);
      this.right = grown(this.right);
    }
    const { left, right } = this.source.generateStereo(frames);
    this.left.set(left, this.length);
    this.right.set(right, this.length);
    this.length += frames;
  }
}

/** How loud each chip is in the mix: the PSG's square is far louder than one FM channel. */
const FM_GAIN = 1.6;
const PSG_GAIN = 1.3;
const DC_POLE = 0.9987;
/** Seconds between a key-off and the key-on that re-strikes it: long enough for the chip to see. */
const KEY_GAP = 0.0015;

/**
 * Plays the chips at the output rate, with `tick` called every `tickSeconds` in between — where a
 * sequencer writes its registers, so every note and every envelope step lands on its exact frame.
 */
export class Engine {
  readonly chips: Chips;
  readonly rate: number;
  /** Seconds between two ticks; the sequencer changes it with the tempo. */
  tickSeconds = 0.02;
  private readonly fmOut: Resampler;
  private readonly psgOut: Resampler;
  private untilTick = 0;
  /** The DC blocker's last input and output, left then right. */
  private readonly dc = new Float64Array(4);
  private settled = false;
  /** Notes waiting out their key-off, by channel (-1: none), and the frames until they sound. */
  private readonly strike = [-1, -1, -1, -1, -1, -1];
  private untilStrike = 0;
  private readonly tick: () => void;
  /** The output's level, 0 to 1, moving by `fadeStep` a frame towards `fadeTarget`. */
  private gain = 1;
  private fadeTarget = 1;
  private fadeStep = 0;
  /** Each FM channel's patch and how far its carriers are turned down, in TL steps (0.75 dB). */
  private readonly patch: (Patch | null)[] = [null, null, null, null, null, null];

  constructor(chips: Chips, rate: number, tick: () => void) {
    this.chips = chips;
    this.rate = rate;
    this.tick = tick;
    this.fmOut = new Resampler(chips.ym, rate);
    this.psgOut = new Resampler(chips.psg, rate);
  }

  /** `frames` of stereo, the ticks run in between. */
  render(frames: number): Pcm {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    this.renderInto(left, right);
    return { left, right };
  }

  /**
   * Fill `left` and `right` with what comes next, the ticks run in between: an AudioWorklet's own
   * output arrays, so nothing is made each call on the audio thread.
   */
  renderInto(left: Float32Array, right: Float32Array): void {
    const frames = left.length;
    left.fill(0);
    right.fill(0);
    let done = 0;
    while (done < frames) {
      if (this.untilTick <= 0) {
        this.tick();
        this.untilTick += this.tickSeconds * this.rate;
      }
      let n = Math.min(frames - done, Math.max(1, Math.ceil(this.untilTick)));
      if (this.untilStrike > 0) n = Math.min(n, this.untilStrike);
      this.fmOut.mix(left, right, done, n, FM_GAIN);
      this.psgOut.mix(left, right, done, n, PSG_GAIN);
      this.untilTick -= n;
      done += n;
      if (this.untilStrike > 0 && (this.untilStrike -= n) <= 0) {
        for (const [channel, midi] of this.strike.entries()) {
          if (midi < 0) continue;
          this.chips.fm.noteOn(channel, midi);
          this.strike[channel] = -1;
        }
      }
    }
    // The YM2612 idles at an offset from zero: a one-pole high-pass, ~10 Hz, takes it out. It starts
    // settled on the first frame — what the chip idles at — so the first render does not click.
    if (!this.settled) {
      this.settled = true;
      this.dc[0] = left[0] ?? 0;
      this.dc[2] = right[0] ?? 0;
    }
    for (const [channel, out] of [left, right].entries()) {
      let x1 = this.dc[channel * 2]!;
      let y1 = this.dc[channel * 2 + 1]!;
      for (let i = 0; i < frames; i++) {
        const x = out[i]!;
        y1 = x - x1 + DC_POLE * y1;
        x1 = x;
        out[i] = y1;
      }
      this.dc[channel * 2] = x1;
      this.dc[channel * 2 + 1] = y1;
    }
    if (this.gain !== 1 || this.fadeTarget !== 1) {
      for (let i = 0; i < frames; i++) {
        if (this.gain !== this.fadeTarget) {
          const towards = this.fadeTarget - this.gain;
          this.gain = Math.abs(towards) <= this.fadeStep ? this.fadeTarget : this.gain + Math.sign(towards) * this.fadeStep;
        }
        // Squared, so the fade sounds even to the ear rather than dropping off at the end.
        const g = this.gain * this.gain;
        left[i]! *= g;
        right[i]! *= g;
      }
    }
  }

  /**
   * Fade the output to `level` (0 to 1) over `seconds`, on the frames it renders: in step with the
   * music to the sample, wherever the page's own clock is.
   */
  fade(level: number, seconds: number): void {
    this.fadeTarget = level;
    this.fadeStep = seconds > 0 ? 1 / (seconds * this.rate) : 1;
  }

  /** True once a fade to 0 has arrived. */
  get silent(): boolean {
    return this.gain === 0 && this.fadeTarget === 0;
  }

  // --- what a sequencer plays with ------------------------------------------------------------

  /** Put `patch` on an FM channel, its carriers `quieter` TL steps down from the patch's own. */
  voice(channel: number, patch: Patch, quieter = 0, pan: 'both' | 'left' | 'right' = 'both'): void {
    const preset = patches[patch];
    this.chips.fm.setPreset(channel, preset);
    this.patch[channel] = patch;
    if (quieter) this.volume(channel, quieter);
    this.chips.fm.setPan(channel, pan !== 'right', pan !== 'left');
  }

  /** Turn an FM channel's carriers down from its patch's own levels, by `quieter` TL steps. */
  volume(channel: number, quieter: number): void {
    const name = this.patch[channel];
    if (!name) return;
    const preset = patches[name];
    for (const op of CARRIERS[preset.algorithm]!) {
      const own = preset.operators[op]?.tl ?? 0;
      this.chips.fm.setOperator(channel, op, { tl: Math.min(127, own + Math.max(0, Math.round(quieter))) });
    }
  }

  /**
   * Strike a note. The chip restarts an envelope only on a key-on it sees after a key-off, so a
   * note struck over a sounding one is let go first and struck a moment later — about 1.5 ms.
   */
  note(channel: number, midi: number): void {
    this.chips.fm.noteOff(channel);
    this.strike[channel] = Math.max(0, Math.min(127, Math.round(midi)));
    this.untilStrike = Math.max(this.untilStrike, Math.round(this.rate * KEY_GAP));
  }

  release(channel: number): void {
    this.strike[channel] = -1;
    this.chips.fm.noteOff(channel);
  }

  /** Bend an FM channel to `hz` without striking it again. */
  bend(channel: number, hz: number): void {
    this.chips.fm.setFrequency(channel, hz);
  }
}

/** A MIDI note's frequency. */
export function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
