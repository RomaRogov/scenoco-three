import { hz, type Engine } from './engine.js';

/**
 * The music: a tracker playing a sixteen-bar piece in A minor on the two chips, its parts let in
 * and out by how hot the game is. Rows are sixteenth notes, six ticks each, as the old trackers ran.
 *
 * - **0 — waiting**: the dark pad and a slow bass. Banners, a resting ball.
 * - **1 — playing**: the bass drives, the drums come in.
 * - **2 — rolling**: metal arpeggios over it — a combo, or half the wall gone.
 * - **3 — on fire**: the lead and its PSG echo, hats in sixteenths — a long combo, or the end in sight.
 *
 * Changes land on the music's own boundaries, never mid-bar:
 * - a part **enters** on the next bar;
 * - a part **leaves** only where a four-bar phrase ends, and only if nothing asked for it through the
 *   whole phrase — so a combo broken by the paddle does not pull the drums out from bar to bar. Down
 *   to the resting pad (a banner, a ball on the paddle) is the exception: that happens at the next bar;
 * - starting over — a lost ball, the next stage's key, a level loaded — never cuts: the music fades
 *   out where it is, then the piece begins again from its top on the next downbeat, fading in over
 *   its first bar.
 */

/** Each stage's key, in semitones from A minor: C minor, then G minor, then round again. */
const STAGE_KEYS = [0, 3, -2];
export function keyOf(stage: number): number {
  return STAGE_KEYS[stage % STAGE_KEYS.length]!;
}

const ROWS = 16;
const TICKS = 6;
/** Bars to a phrase: where a part may leave. */
const PHRASE = 4;
/** Seconds the music takes to fade before it starts over. */
const FADE_OUT = 0.9;

/** A chord: its root in semitones from the key's, and whether its third is minor. */
type Chord = readonly [root: number, minor: boolean];
const Am: Chord = [0, true];
const F: Chord = [-4, false];
const C: Chord = [3, false];
const G: Chord = [-2, false];
const E: Chord = [-5, false];
const Dm: Chord = [5, true];

/** Sixteen bars: the A section climbs to E, the harmonic-minor dominant; B turns through D minor. */
const FORM: readonly Chord[] = [Am, Am, F, F, C, C, G, E, Dm, Dm, Am, Am, F, G, E, E];

/**
 * The lead, a bar a line: a note starts there, `-` holds it, `.` lets it go. Written in A minor;
 * a stage in another key transposes it.
 */
const LEAD = [
  'E5 -  -  -  A5 -  -  -  G5 -  E5 -  D5 -  E5 - ',
  'C5 -  -  -  D5 -  E5 -  -  -  -  -  .  .  .  . ',
  'F5 -  -  -  E5 -  -  -  D5 -  C5 -  D5 -  -  - ',
  'A4 -  -  -  C5 -  -  -  D5 -  -  -  .  .  .  . ',
  'E5 -  -  -  G5 -  -  -  C6 -  -  -  B5 -  G5 - ',
  'E5 -  -  -  -  -  -  -  D5 -  E5 -  G5 -  -  - ',
  'D5 -  -  -  G5 -  -  -  B5 -  -  -  A5 -  G5 - ',
  'G#5 - -  -  -  -  -  -  B5 -  -  -  E5 -  -  - ',
  'F5 -  -  -  A5 -  -  -  D6 -  -  -  C6 -  A5 - ',
  'F5 -  -  -  E5 -  D5 -  -  -  -  -  .  .  .  . ',
  'E5 -  -  -  A5 -  -  -  C6 -  -  -  B5 -  A5 - ',
  'E5 -  -  -  -  -  -  -  .  .  .  .  E5 -  G5 - ',
  'A5 -  -  -  -  -  G5 -  F5 -  -  -  E5 -  D5 - ',
  'B4 -  -  -  D5 -  -  -  G5 -  -  -  F5 -  D5 - ',
  'E5 -  G#5 - B5 -  -  -  D6 -  -  -  C6 -  B5 - ',
  'G#5 - -  -  -  -  -  -  -  -  -  -  .  .  .  . ',
].map((bar) => bar.trim().split(/\s+/));

/** The bass, by intensity: `R` the root, `O` its octave, `F` its fifth. */
const BASS = {
  slow: 'R - - - - - - - R - - - - - - -',
  drive: 'R - O R - R O - R - O R F - O -',
};

const NOTE = /^([A-G])(#?)(\d)$/;
const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(name: string): number {
  const [, letter, sharp, octave] = NOTE.exec(name)!;
  return 12 * (Number(octave) + 1) + STEPS[letter!]! + (sharp ? 1 : 0);
}

/** `n` brought into the octave starting at `low`. */
function within(n: number, low: number): number {
  return low + ((((n - low) % 12) + 12) % 12);
}

/** FM channels, and the PSG's. */
const BASS_CH = 0;
const LEAD_CH = 1;
const ARP_CH = 2;
const PAD_A = 3;
const PAD_B = 4;
const KICK_CH = 5;
const ECHO = 0; // PSG tone

export class Song {
  /** What the game asks for: applied at the next bar. */
  intensity = 0;
  key = 0;
  tempo = 138;

  private readonly engine: Engine;
  private playing = 0;
  private playingKey = 0;
  private bar = 0;
  private row = 0;
  private tick = 0;
  /** Fading out, to start the piece over at the first downbeat after it is silent. */
  private leaving = false;
  /** The most intensity asked for since this phrase began: the floor a part leaving must clear. */
  private asked = 0;

  // What each sounding part is doing, for its per-tick work.
  private kick = -1;
  private noise = -1;
  private noiseLevel = 15;
  private noiseFade = 0;
  private leadNote = 0;
  private leadHeld = 0;
  private echo: number[] = [];
  private echoLevel = 15;
  private padChord: Chord | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
    engine.voice(BASS_CH, 'bass', 3);
    engine.voice(LEAD_CH, 'lead', 8);
    engine.voice(ARP_CH, 'arp', 6, 'left');
    engine.voice(PAD_A, 'pad', 0, 'left');
    engine.voice(PAD_B, 'pad', 0, 'right');
    engine.voice(KICK_CH, 'kick', 4);
    // The PSG powers up with every channel at full volume: silence is something to ask for.
    engine.chips.tone.allNotesOff();
    engine.chips.tone.noiseOff();
    this.timing();
  }

  /** Fade out and start the piece over from its top: a lost ball, a level loaded. */
  restart(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.engine.fade(0, FADE_OUT);
  }

  /** Every voice off, and nothing left echoing or held for the next note. */
  private hush(): void {
    for (let ch = 0; ch < 6; ch++) this.engine.release(ch);
    this.engine.chips.tone.allNotesOff();
    this.engine.chips.tone.noiseOff();
    this.noise = -1;
    this.echo = [];
    this.echoLevel = 15;
    this.leadNote = 0;
    this.padChord = null;
  }

  /** Called by the engine every tick. */
  step(): void {
    this.asked = Math.max(this.asked, this.intensity);
    if (this.tick === 0) {
      if (this.row === 0) this.startBar();
      if (!this.engine.silent) this.playRow();
    }
    this.perTick();
    if (++this.tick === TICKS) {
      this.tick = 0;
      if (++this.row === ROWS) {
        this.row = 0;
        this.bar = (this.bar + 1) % FORM.length;
      }
    }
  }

  private timing(): void {
    this.engine.tickSeconds = 60 / this.tempo / 4 / TICKS;
  }

  private startBar(): void {
    // A new stage is a new tune: the old one fades, and it begins from its first bar in its own key.
    if (this.key !== this.playingKey) this.restart();
    if (this.leaving && this.engine.silent) {
      this.leaving = false;
      this.hush();
      this.playingKey = this.key;
      this.bar = 0;
      this.playing = this.intensity;
      this.asked = this.intensity;
      this.engine.fade(1, (60 / this.tempo) * 4);
    }
    const phraseEnds = this.bar % PHRASE === 0;
    if (this.intensity > this.playing || this.intensity === 0) this.playing = this.intensity;
    else if (phraseEnds && this.asked < this.playing) this.playing = this.asked;
    if (phraseEnds) this.asked = this.intensity;
    this.timing();
  }

  private playRow(): void {
    const chord = FORM[this.bar]!;
    const root = chord[0] + this.playingKey;
    const third = chord[1] ? 3 : 4;
    const tones = [0, third, 7, 12];
    const r = this.row;
    const level = this.playing;

    // Pad: the chord's third and fifth, held, struck again only when the chord changes.
    if (chord !== this.padChord) {
      this.padChord = chord;
      this.engine.note(PAD_A, within(57 + root + third, 55));
      this.engine.note(PAD_B, within(57 + root + 7, 60));
    }

    // Bass.
    const pattern = level === 0 ? BASS.slow : BASS.drive;
    const cell = pattern.split(' ')[r];
    const low = within(45 + root, 40);
    if (cell === 'R') this.engine.note(BASS_CH, low);
    else if (cell === 'O') this.engine.note(BASS_CH, low + 12);
    else if (cell === 'F') this.engine.note(BASS_CH, low + 7);

    // Drums from 1: four on the floor, snare on two and four, hats on the off-beats.
    const fill = level >= 2 && (this.bar === 7 || this.bar === 15) && r >= 12;
    if (level >= 1) {
      if (r % 4 === 0) this.strikeKick();
      if (r === 4 || r === 12 || fill) this.hit(true);
      else if (r % 4 === 2 || (level >= 3 && r % 2 === 1)) this.hit(false);
    }

    // Arpeggio from 2: up and down the chord in sixteenths.
    if (level >= 2) {
      const order = [0, 1, 2, 3, 2, 1];
      this.engine.note(ARP_CH, within(57 + root, 64) + tones[order[r % order.length]!]!);
    } else if (r === 0) this.engine.release(ARP_CH);

    // Lead from 3, with its PSG echo three rows behind.
    const written = LEAD[this.bar]![r]!;
    if (level >= 3) {
      if (written === '.') this.engine.release(LEAD_CH);
      else if (written !== '-') {
        this.leadNote = midi(written) + this.playingKey;
        this.leadHeld = 0;
        this.engine.note(LEAD_CH, this.leadNote);
      }
    } else if (r === 0) this.engine.release(LEAD_CH);
    this.echo.push(level >= 3 && written !== '-' && written !== '.' ? midi(written) + this.playingKey : -1);
    const echoed = this.echo.length > 3 ? this.echo.shift()! : -1;
    if (echoed >= 0) {
      this.engine.chips.tone.tone(ECHO, { frequency: hz(echoed), attenuation: 8 });
      this.echoLevel = 8;
    }
  }

  private strikeKick(): void {
    this.engine.note(KICK_CH, 40);
    this.kick = 0;
  }

  /** The PSG's noise: a snare, loud and long, or a hat, quiet and short. */
  private hit(snare: boolean): void {
    const tone = this.engine.chips.tone;
    tone.noise({ type: 'white', rate: snare ? 'medium' : 'high', attenuation: snare ? 0 : 4 });
    this.noise = 0;
    this.noiseLevel = snare ? 0 : 4;
    this.noiseFade = snare ? 2 : 4;
  }

  private perTick(): void {
    const engine = this.engine;
    // The kick's pitch falls from a punch to a thud over its first ticks.
    if (this.kick >= 0) {
      engine.bend(KICK_CH, 45 + 140 * Math.exp(-this.kick * 0.9));
      if (++this.kick > 10) this.kick = -1;
    }
    if (this.noise >= 0) {
      this.noiseLevel += this.noiseFade;
      if (this.noiseLevel >= 15) {
        engine.chips.tone.noiseOff();
        this.noise = -1;
      } else engine.chips.tone.setAttenuation(3, this.noiseLevel);
    }
    // The echo fades as a delay would.
    if (this.echoLevel < 15 && this.tick % 2 === 1) {
      this.echoLevel += 1;
      engine.chips.tone.setAttenuation(ECHO, this.echoLevel);
    }
    // A held lead note starts to sing after a beat: vibrato, a fifth of a semitone deep.
    if (this.playing >= 3 && this.leadNote) {
      this.leadHeld++;
      if (this.leadHeld > TICKS * 3) engine.bend(LEAD_CH, hz(this.leadNote + 0.2 * Math.sin(this.leadHeld * 0.7)));
    }
  }
}
