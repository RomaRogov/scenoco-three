/**
 * Where a game's sound goes: the music through a low-pass that muffles it under a banner, the
 * effects beside it, both into a compressor so a pile of effects cannot clip.
 */
export interface Bus {
  context: AudioContext;
  music: GainNode;
  muffle: BiquadFilterNode;
  sfx: GainNode;
  master: GainNode;
  /** Glide an AudioParam of this bus to `value` over about `seconds`. */
  glide(param: AudioParam, value: number, seconds: number): void;
}

export function createBus(context: AudioContext): Bus {
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.ratio.value = 4;
  compressor.knee.value = 8;
  master.connect(compressor).connect(context.destination);
  const muffle = context.createBiquadFilter();
  muffle.type = 'lowpass';
  muffle.frequency.value = 20000;
  muffle.Q.value = 0.9;
  muffle.connect(master);
  // What is under 35 Hz — the kick's sweep, the bass's lowest notes — no speaker the game is heard
  // on plays, and it would only take headroom from what they do.
  const rumble = context.createBiquadFilter();
  rumble.type = 'highpass';
  rumble.frequency.value = 35;
  rumble.connect(muffle);
  const music = context.createGain();
  music.connect(rumble);
  const sfx = context.createGain();
  sfx.connect(master);
  // A browser starts audio only after the player's first click, tap or key: every one asks again
  // until it has.
  const start = () => {
    if (context.state !== 'running') void context.resume();
  };
  for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, start, { capture: true });
  const glide = (param: AudioParam, value: number, seconds: number) => {
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(value, context.currentTime, seconds / 3);
  };
  return { context, music, muffle, sfx, master, glide };
}
