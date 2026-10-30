import ym2612Wasm from 'tetorica-fm2612/generated/ym2612_wasm.wasm?url';
import segapsgWasm from 'tetorica-fm2612/generated/segapsg_wasm.wasm?url';
import type { ChipBinaries } from './chips.js';

let binaries: Promise<ChipBinaries> | null = null;

/** The chips' WebAssembly, fetched once on the page: Vite copies each file into the build. */
export function chipBinaries(): Promise<ChipBinaries> {
  const bytes = (url: string) => fetch(url).then(async (r) => new Uint8Array(await r.arrayBuffer()));
  return (binaries ??= Promise.all([bytes(ym2612Wasm), bytes(segapsgWasm)]).then(([ym, psg]) => ({ ym, psg })));
}
