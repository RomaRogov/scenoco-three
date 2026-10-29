import { createSoundChip, type WasmModuleFactory } from 'tetorica-fm2612';
import { YM2612DirectTransport, YM2612Synth } from 'tetorica-fm2612/ym2612synth.js';
import { SegaPSGDirectTransport, SegaPSGSynth } from 'tetorica-fm2612/segapsgsynth.js';
import ym2612Module from 'tetorica-fm2612/generated/ym2612_wasm.js';
import ym2612Wasm from 'tetorica-fm2612/generated/ym2612_wasm.wasm?url';
import segapsgModule from 'tetorica-fm2612/generated/segapsg_wasm.js';
import segapsgWasm from 'tetorica-fm2612/generated/segapsg_wasm.wasm?url';
import type { Chips } from './engine.js';

/**
 * The two chips, loaded the way a bundler can follow: each chip's module imported, its WASM a URL
 * Vite copies into the build. Their bytes are fetched once, however many pairs of chips are made.
 */
const bytes = new Map<string, Promise<Uint8Array>>();
function fetched(url: string): Promise<Uint8Array> {
  let pending = bytes.get(url);
  if (!pending) bytes.set(url, (pending = fetch(url).then(async (r) => new Uint8Array(await r.arrayBuffer()))));
  return pending;
}

export async function loadChips(): Promise<Chips> {
  const [ym, psg] = await Promise.all([
    // The generated modules are typed loosely; they are the factories `createSoundChip` loads itself.
    createSoundChip('ym2612', { execution: 'direct', moduleFactory: ym2612Module as WasmModuleFactory, moduleOptions: { wasmBinary: await fetched(ym2612Wasm) } }),
    createSoundChip('segapsg', { execution: 'direct', moduleFactory: segapsgModule as WasmModuleFactory, moduleOptions: { wasmBinary: await fetched(segapsgWasm) } }),
  ]);
  return {
    ym,
    psg,
    fm: new YM2612Synth({ transport: new YM2612DirectTransport(ym) }),
    tone: new SegaPSGSynth({ transport: new SegaPSGDirectTransport(psg) }),
  };
}
