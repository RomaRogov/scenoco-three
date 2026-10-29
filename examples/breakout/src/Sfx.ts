import { Behaviour, findObjectOfType } from '@scenoco-three/core';
import { Music } from './Music.js';
import { Progress } from './Progress.js';
import { audioBus } from './sound/bus.js';
import { loadChips } from './sound/chips.js';
import { SfxBank, type SfxName } from './sound/sfx.js';
import { keyOf } from './sound/song.js';

/** The effects that duck the music for a moment while they play. */
const BIG: readonly SfxName[] = ['catch', 'multi', 'lose', 'clear', 'over', 'win'];

/**
 * The sound effects, on chips of their own: `findObjectOfType(Sfx)?.play('break', combo)`. Each is
 * in the stage's key, so it sits in the music; a brick's break climbs the scale with the combo.
 * Lives in the `Run` scene beside the music, kept across levels.
 */
export class Sfx extends Behaviour {
  /** 0 to 1. */
  volume = 0.8;

  private bank: SfxBank | null = null;
  private progress: Progress | null = null;

  override awake(): void {
    this.progress = findObjectOfType(Progress);
    const bus = audioBus();
    if (!bus) return;
    bus.sfx.gain.value = this.volume;
    void loadChips().then((chips) => {
      if (!this.isDestroyed) this.bank = new SfxBank(chips, bus.context.sampleRate);
    });
  }

  /** Play an effect now; `step` climbs its scale — a brick's break, by the combo. */
  play(name: SfxName, step = 0): void {
    const bus = audioBus();
    if (!bus || !this.bank || bus.context.state !== 'running') return;
    const { left, right } = this.bank.get(name, keyOf(this.progress?.stage ?? 0), step);
    const buffer = bus.context.createBuffer(2, left.length, bus.context.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = bus.context.createBufferSource();
    source.buffer = buffer;
    source.connect(bus.sfx);
    source.start();
    if (BIG.includes(name)) {
      // The music steps back under a fanfare, and comes back as it ends.
      const level = findObjectOfType(Music)?.volume ?? 1;
      const now = bus.context.currentTime;
      bus.music.gain.cancelScheduledValues(now);
      bus.music.gain.setTargetAtTime(0.25 * level, now, 0.03);
      bus.music.gain.setTargetAtTime(level, now + buffer.duration * 0.8, 0.25);
    }
  }
}
