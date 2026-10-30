import { createYm2612 } from 'tetorica-fm2612/ym2612.js';
import { SegaPSG } from 'tetorica-fm2612/segapsg.js';
import { YM2612DirectTransport, YM2612Synth } from 'tetorica-fm2612/ym2612synth.js';
import { SegaPSGDirectTransport, SegaPSGSynth } from 'tetorica-fm2612/segapsgsynth.js';
import ym2612Module from 'tetorica-fm2612/generated/ym2612_wasm.js';
import segapsgModule from 'tetorica-fm2612/generated/segapsg_wasm.js';
import type { WasmModuleFactory } from 'tetorica-fm2612';
import type { Chips } from './engine.js';

/** The chips' WebAssembly, as bytes: fetched once on the page, and handed to wherever chips are made. */
export interface ChipBinaries {
  ym: Uint8Array;
  psg: Uint8Array;
}

/**
 * A YM2612 and a PSG from their bytes. Works on the page and inside an AudioWorklet alike: every
 * module is imported statically, because a worklet may not `import()` and has no `fetch`.
 */
export async function makeChips(binaries: ChipBinaries): Promise<Chips> {
  const [ym, psg] = await Promise.all([
    // The generated modules are typed loosely; they are the factories the chips load themselves.
    createYm2612(ym2612Module as WasmModuleFactory, { wasmBinary: binaries.ym }),
    SegaPSG.create({ moduleFactory: segapsgModule as WasmModuleFactory, moduleOptions: { wasmBinary: binaries.psg } }),
  ]);
  return {
    ym,
    psg,
    fm: new YM2612Synth({ transport: new YM2612DirectTransport(ym) }),
    tone: new SegaPSGSynth({ transport: new SegaPSGDirectTransport(psg) }),
  };
}
