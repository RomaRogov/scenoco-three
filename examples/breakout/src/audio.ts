import { AudioContext as ThreeAudio } from 'three';
import { createBus, type Bus } from './sound/bus.js';

let bus: Bus | null | undefined;

/** The game's bus, on three.js's AudioContext, made on first ask; null where there is no Web Audio — a test, a server. */
export function audioBus(): Bus | null {
  if (bus !== undefined) return bus;
  if (typeof window === 'undefined' || !('AudioContext' in window)) return (bus = null);
  return (bus = createBus(ThreeAudio.getContext() as AudioContext));
}
