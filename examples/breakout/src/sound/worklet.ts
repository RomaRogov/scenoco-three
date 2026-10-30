import { makeChips, type ChipBinaries } from './chips.js';
import { Engine } from './engine.js';

// What an AudioWorklet's scope gives, which TypeScript's DOM library does not declare.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: new (options: { processorOptions: ChipBinaries }) => AudioWorkletProcessorShape): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
interface AudioWorkletProcessorShape extends AudioWorkletProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

/** What a game runs on the audio thread: `tick` every engine tick, `receive` each message the page posts. */
export interface Program {
  tick(): void;
  receive?(message: unknown): void;
}

/**
 * Register `name` as an AudioWorklet processor that plays the chips live on the audio thread, the
 * page's own thread left to the game. Call it from a module the page loads with `startPlayer`:
 *
 *     playInWorklet('song', (engine) => {
 *       const song = new Song(engine);
 *       return { tick: () => song.step(), receive: (m) => song.receive(m) };
 *     });
 *
 * The program is made once the chips are; messages posted before then wait for it.
 */
export function playInWorklet(name: string, makeProgram: (engine: Engine) => Program): void {
  registerProcessor(
    name,
    class extends AudioWorkletProcessor {
      private engine: Engine | null = null;
      private program: Program | null = null;
      private readonly waiting: unknown[] = [];

      constructor(options: { processorOptions: ChipBinaries }) {
        super();
        this.port.onmessage = (event) => {
          if (this.program) this.program.receive?.(event.data);
          else this.waiting.push(event.data);
        };
        void makeChips(options.processorOptions).then((chips) => {
          const engine = new Engine(chips, sampleRate, () => this.program?.tick());
          this.program = makeProgram(engine);
          for (const message of this.waiting.splice(0)) this.program.receive?.(message);
          this.engine = engine;
        })
          // The audio thread's own errors reach no console: the page is told, and says it.
          .catch((error: unknown) => this.port.postMessage({ error: String((error as Error)?.stack ?? error) }));
      }

      process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const [left, right] = outputs[0] ?? [];
        if (this.engine && left && right) this.engine.renderInto(left, right);
        return true;
      }
    },
  );
}
