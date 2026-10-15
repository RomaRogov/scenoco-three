import { Behaviour } from './Behaviour.js';
import { Event } from './Event.js';
import type { ConstructableBehaviour } from './types.js';

export interface FieldInfo {
  name: string;
  default: unknown;
}

/**
 * A behaviour's settings, read from a fresh instance: its own public fields and their defaults.
 * `_`-prefixed and `#private` fields are not settings, and neither are events.
 */
export function fieldsOf(type: ConstructableBehaviour): FieldInfo[] {
  const probe = new type() as unknown as Record<string, unknown>;
  const base = new Set(Object.keys(new (class extends Behaviour {})()));
  return Object.keys(probe)
    .filter((name) => !base.has(name) && !name.startsWith('_') && !(probe[name] instanceof Event))
    .map((name) => ({ name, default: probe[name] }));
}

/** A JSON Schema for a behaviour's settings, inferred from the defaults — for validation and editors. */
export function schemaOf(type: ConstructableBehaviour): object {
  const properties: Record<string, object> = {};
  for (const { name, default: value } of fieldsOf(type)) properties[name] = schemaOfValue(value);
  return { title: type.name, type: 'object', properties, additionalProperties: false };
}

function schemaOfValue(value: unknown): object {
  if (typeof value === 'number') return { type: 'number', default: value };
  if (typeof value === 'string') return { type: 'string', default: value };
  if (typeof value === 'boolean') return { type: 'boolean', default: value };
  if (Array.isArray(value)) return { type: 'array', default: value };
  const v = value as { isColor?: boolean; getHexString?: () => string; toArray?: () => number[] } | null;
  if (v?.isColor && v.getHexString) return { type: 'string', format: 'color', default: `#${v.getHexString()}` };
  if (v && typeof v.toArray === 'function') {
    const items = v.toArray();
    return { type: 'array', items: { type: 'number' }, minItems: items.length, maxItems: items.length, default: items };
  }
  // A reference — a node, another behaviour, an asset — or null: set by code or by the scene, not by data.
  return {};
}
