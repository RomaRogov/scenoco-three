/**
 * Game state as plain data: a behaviour as its fields and getters, a vector as an array, a colour as
 * "#rrggbb" — what the bridge answers with, and the scene as an outline of text.
 */
import * as THREE from 'three';
import { Behaviour, Event, behavioursOn } from '../kernel/index.js';
import type { Scope } from './scope.js';

/** The scene as indented text, `depth` levels down, with every behaviour's fields. */
export function outline(scene: THREE.Object3D, depth: number): string[] {
  const lines: string[] = [];
  const visit = (node: THREE.Object3D, level: number) => {
    const own = behavioursOn(node).filter((b) => !b.isDestroyed);
    const plainKids = node.children.filter((c) => !c.name && behavioursOn(c).length === 0 && !hasNamedOrBehaviour(c));
    const label = `${'  '.repeat(level)}- ${node.type}${node.name ? ` "${node.name}"` : ''} at ${fmt(node.getWorldPosition(new THREE.Vector3()))}`;
    const parts = own.map((b) => `${b.constructor.name}${b.enabled ? '' : ' (disabled)'} ${compact(fields(b))}`);
    lines.push(parts.length ? `${label} — ${parts.join(' · ')}` : label);
    if (level + 1 >= depth) {
      if (node.children.length) lines.push(`${'  '.repeat(level + 1)}(${node.children.length} children below the depth)`);
      return;
    }
    for (const child of node.children) if (!plainKids.includes(child)) visit(child, level + 1);
    if (plainKids.length) lines.push(`${'  '.repeat(level + 1)}(+${plainKids.length} unnamed ${plainKids.length === 1 ? 'object' : 'objects'} without behaviours)`);
  };
  visit(scene, 0);
  return lines;
}

/** `Player` — every live Player; `Player.lane` — that field of each; `#runner` — a node by name. */
export function telemetry(target: string, reading: Pick<Scope, 'nodeNamed' | 'byClass'>): unknown {
  const { nodeNamed, byClass } = reading;
  if (target.startsWith('#')) {
    const node = nodeNamed(target.slice(1));
    return {
      type: node.type,
      name: node.name,
      position: fmt(node.position),
      worldPosition: fmt(node.getWorldPosition(new THREE.Vector3())),
      rotation: fmt(node.rotation),
      scale: fmt(node.scale),
      visible: node.visible,
      children: node.children.length,
      behaviours: Object.fromEntries(behavioursOn(node).map((b) => [b.constructor.name, fields(b)])),
    };
  }
  const [type, ...path] = target.split('.');
  const list = byClass().get(type!);
  if (!list) {
    const known = [...byClass().keys()].sort().join(', ');
    throw new Error(`no live behaviour of class ${type}. Live classes: ${known || 'none'}`);
  }
  return list.map((b) => {
    const host = b.node as THREE.Object3D;
    const where = host.name || host.type;
    if (path.length === 0) return { on: where, at: fmt(host.getWorldPosition(new THREE.Vector3())), ...fields(b) };
    let value: unknown = b;
    for (const key of path) value = (value as Record<string, unknown>)?.[key];
    return { on: where, [path.join('.')]: plain(value, 2) };
  });
}

/** A reading as one console line: a behaviour as its fields, as `eval` answers. */
export function readable(value: unknown): unknown {
  if (value instanceof Behaviour) return { class: value.constructor.name, ...fields(value) };
  if (Array.isArray(value) && value.some((v) => v instanceof Behaviour)) return value.map(readable);
  return plain(value, 3);
}

function hasNamedOrBehaviour(node: THREE.Object3D): boolean {
  let found = false;
  node.traverse((n) => {
    if (n !== node && (n.name || behavioursOn(n).length)) found = true;
  });
  return found;
}

/** A behaviour's state: its own fields, then its getters — what a person would look at in an inspector. */
export function fields(b: Behaviour): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(b)) {
    if (key.startsWith('_')) continue;
    const value = (b as unknown as Record<string, unknown>)[key];
    if (typeof value === 'function') continue;
    out[key] = plain(value, 1);
  }
  // Up to the framework's own base classes: `node`, `camera`, `enabled` are the same on every behaviour.
  for (let proto = Object.getPrototypeOf(b); proto && proto.constructor.name !== 'Behaviour'; proto = Object.getPrototypeOf(proto)) {
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (!desc.get || key.startsWith('_') || key in out) continue;
      try {
        out[key] = plain(desc.get.call(b), 1);
      } catch {
        // a getter that needs something not there yet
      }
    }
  }
  return out;
}

/** A value as JSON in three's own vocabulary: vectors as arrays, colours as "#rrggbb", objects by name. */
export function plain(value: unknown, depth: number): unknown {
  // Spelled out, because JSON drops it: `{ score: undefined }` came back as `{}`, and read as "no such thing".
  if (value === undefined) return '<undefined>';
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return round(value);
  if (typeof value === 'function') return `<function ${(value as { name?: string }).name || 'anonymous'}>`;
  if (typeof value !== 'object') return String(value);
  const v = value as Record<string, unknown> & { constructor: { name: string } };
  if (v.isVector2 || v.isVector3 || v.isVector4 || v.isQuaternion || v.isEuler) return fmt(v as unknown as THREE.Vector3);
  if (v.isColor) return `#${(value as THREE.Color).getHexString()}`;
  if (value instanceof THREE.Object3D) return `<${value.type}${value.name ? ` "${value.name}"` : ''}>`;
  if (value instanceof Behaviour) return `<${value.constructor.name}${value.isDestroyed ? ' destroyed' : ''}>`;
  if (value instanceof Event) return `<Event, ${value.listenerCount} listener${value.listenerCount === 1 ? '' : 's'}>`;
  if (Array.isArray(value)) {
    if (depth <= 0) return `<${value.length} items>`;
    const items = value.slice(0, 12).map((item) => plain(item, depth - 1));
    return value.length > 12 ? [...items, `… ${value.length - 12} more`] : items;
  }
  if (value instanceof Map || value instanceof Set) return `<${v.constructor.name}, ${value.size}>`;
  const proto = Object.getPrototypeOf(value);
  // A class instance by its name — or as native, when the name is a minifier's (Rapier's are).
  if (proto !== Object.prototype && proto !== null) return v.constructor.name.length > 2 ? `<${v.constructor.name}>` : '<native>';
  if (depth <= 0) return '<object>';
  return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, plain(item, depth - 1)]));
}

export function fmt(v: { toArray(): number[] } | THREE.Euler): number[] {
  return (v as { toArray(): unknown[] }).toArray().filter((x) => typeof x === 'number').map((x) => round(x as number));
}

export function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function compact(record: Record<string, unknown>): string {
  const text = JSON.stringify(record);
  return text.length > 220 ? `${text.slice(0, 217)}…}` : text;
}
