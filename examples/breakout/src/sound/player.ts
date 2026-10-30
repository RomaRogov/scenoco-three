import { chipBinaries } from './binaries.js';
import { makeChips } from './chips.js';
import { Engine } from './engine.js';
import type { Program } from './worklet.js';

/** A program playing the chips, wherever it runs: `post` reaches its `receive`. */
export interface ChipPlayer {
  post(message: unknown): void;
  stop(): void;
}

export interface PlayerOptions {
  /** The module that registers `name` with `playInWorklet` — with Vite, `import url from './song.worklet.ts?worker&url'`. */
  worklet: string;
  name: string;
  /** The same program the worklet runs, for where there is no AudioWorklet. */
  program: (engine: Engine) => Program;
  output: AudioNode;
}

const loaded = new Map<string, Promise<void>>();

/**
 * Play `program` on the audio thread, in an AudioWorklet, into `output`. A page that is not a secure
 * context — the dev server opened on a phone at `http://192.168…` — has no AudioWorklet: there the
 * same program plays on the page's own thread instead, rendered a little ahead into queued buffers.
 */
export async function startPlayer(context: AudioContext, options: PlayerOptions): Promise<ChipPlayer> {
  if (context.audioWorklet) {
    try {
      return await inWorklet(context, options);
    } catch (error) {
      console.error(`${options.name} worklet failed to load, so the music plays on the page's thread:`, error);
    }
  } else {
    console.warn(`No AudioWorklet here — it needs https or localhost — so ${options.name} plays on the page's thread.`);
  }
  return onPage(context, options);
}

async function inWorklet(context: AudioContext, { worklet, name, output }: PlayerOptions): Promise<ChipPlayer> {
  let module = loaded.get(worklet);
  if (!module) loaded.set(worklet, (module = context.audioWorklet.addModule(worklet)));
  const [binaries] = await Promise.all([chipBinaries(), module]);
  const node = new AudioWorkletNode(context, name, { numberOfInputs: 0, outputChannelCount: [2], processorOptions: binaries });
  node.port.addEventListener('message', (event: MessageEvent<{ error?: string }>) => {
    if (event.data?.error) console.error(`${name} worklet: ${event.data.error}`);
  });
  node.port.start();
  node.connect(output);
  return { post: (message) => node.port.postMessage(message), stop: () => node.disconnect() };
}

/** Seconds rendered ahead of what is heard: enough to ride out a slow frame. */
const LOOKAHEAD = 0.2;
const FRAMES = 2048;

async function onPage(context: AudioContext, { program, output }: PlayerOptions): Promise<ChipPlayer> {
  const engine = new Engine(await makeChips(await chipBinaries()), context.sampleRate, () => playing.tick());
  const playing = program(engine);
  /** When, on the AudioContext's clock, the next buffer starts. */
  let next = 0;
  const pump = () => {
    if (context.state !== 'running') return;
    // After a stall — a hidden tab — start again just ahead, rather than catch up with a burst.
    if (next < context.currentTime) next = context.currentTime + 0.03;
    while (next < context.currentTime + LOOKAHEAD) {
      const { left, right } = engine.render(FRAMES);
      const buffer = context.createBuffer(2, FRAMES, engine.rate);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      source.start(next);
      next += FRAMES / engine.rate;
    }
  };
  const timer = setInterval(pump, 25);
  return { post: (message) => playing.receive?.(message), stop: () => clearInterval(timer) };
}
