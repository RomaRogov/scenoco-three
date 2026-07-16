import type { Color, Euler, Object3D, Vector2, Vector3 } from 'three';
import type { Component, EnumDef } from '@scenoco-three/core';
import { componentName, round, toDeg, toRad } from './meta.js';

// The inspector's field widgets (one editor per value shape), the shared DOM row
// helpers they render into, and the read-only value formatter — panels.ts
// composes these into sections.

// ── DOM helpers ────────────────────────────────────────────────────────────────────

export function div(className: string, text?: string): HTMLDivElement {
  const el = document.createElement('div');
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

export function row(key: string, value: string): HTMLDivElement {
  const r = div('sc-row');
  r.append(div('k', key), div('v', value));
  return r;
}

/** A row whose value cell holds an editor element. */
export function editRow(key: string, control: HTMLElement): HTMLDivElement {
  const r = div('sc-row');
  const v = div('v');
  v.append(control);
  r.append(div('k', key), v);
  return r;
}

// ── editable field builders ──────────────────────────────────────────────────────

/** A labelled multi-axis vector editor (x/y/z), each axis scrub + number input. */
export function vecEditor(
  key: string,
  get: () => number[],
  commit: (value: number[], opts?: { coalesce?: boolean }) => void,
  labels: string[] = ['x', 'y', 'z'],
): HTMLElement {
  const r = div('sc-row sc-vec');
  r.append(div('k', key));
  const fields = div('v sc-axes');
  labels.forEach((axis, i) => {
    fields.append(
      axisField(
        axis,
        () => get()[i] ?? 0,
        (v, opts) => {
          const next = get();
          next[i] = v;
          commit(next, opts);
        },
      ),
    );
  });
  r.append(fields);
  return r;
}

/** Euler editor: UI in degrees, commits radians (the compiled/runtime unit). */
export function eulerEditor(
  key: string,
  getRad: () => number[],
  commitRad: (value: number[], opts?: { coalesce?: boolean }) => void,
): HTMLElement {
  return vecEditor(
    key,
    () => getRad().map(toDeg),
    (degs, opts) => commitRad(degs.map(toRad), opts),
  );
}

/** One axis: a scrub handle (the axis letter) + a number input. */
function axisField(label: string, get: () => number, set: (v: number, opts?: { coalesce?: boolean }) => void): HTMLElement {
  const cell = div('sc-axis');
  const handle = div('sc-axis-k', label);
  const input = numInput(() => get(), (v, opts) => set(v, opts));
  scrub(handle, () => Number(input.value) || 0, (v) => {
    input.value = fmtNum(v);
    set(v, { coalesce: true });
  });
  cell.append(handle, input);
  return cell;
}

/** A standalone number row (single scalar property). */
export function numField(get: () => number, set: (v: number, opts?: { coalesce?: boolean }) => void, int = false): HTMLElement {
  return numInput(get, (v, opts) => set(int ? Math.round(v) : v, opts), int);
}

function numInput(get: () => number, set: (v: number, opts?: { coalesce?: boolean }) => void, int = false): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'sc-input sc-num';
  input.inputMode = int ? 'numeric' : 'decimal';
  input.value = fmtNum(get());
  input.onchange = () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) set(int ? Math.round(v) : v);
  };
  return input;
}

export function textField(get: () => string, set: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sc-input';
  input.value = get();
  input.onchange = () => set(input.value);
  return input;
}

export function colorField(getHex: () => number, set: (hex: number) => void): HTMLElement {
  const wrap = div('sc-color');
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'sc-swatch';
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'sc-input sc-hex';
  const sync = () => {
    const css = '#' + getHex().toString(16).padStart(6, '0');
    picker.value = css;
    hex.value = css;
  };
  sync();
  picker.oninput = () => {
    hex.value = picker.value;
    set(parseInt(picker.value.slice(1), 16));
  };
  hex.onchange = () => {
    const v = parseInt(hex.value.replace(/^#/, ''), 16);
    if (Number.isFinite(v)) {
      set(v);
      picker.value = '#' + v.toString(16).padStart(6, '0');
    }
  };
  wrap.append(picker, hex);
  return wrap;
}

/** A dropdown of enum member names; maps the live native value ↔ its name. */
export function enumEditor(key: string, def: EnumDef, get: () => unknown, set: (v: string | number) => void): HTMLElement {
  const select = document.createElement('select');
  select.className = 'sc-input sc-select';
  for (const member of def.names) {
    const opt = document.createElement('option');
    opt.value = member;
    opt.textContent = member;
    select.append(opt);
  }
  const current = def.byValue.get(get() as string | number);
  if (current !== undefined) select.value = current;
  select.onchange = () => {
    const value = def.byName.get(select.value);
    if (value !== undefined) set(value);
  };
  return editRow(key, select);
}

export function boolEditor(key: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const r = div('sc-row');
  r.append(div('k', key));
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'sc-toggle';
  toggle.checked = get();
  toggle.onchange = () => set(toggle.checked);
  const v = div('v');
  v.append(toggle);
  r.append(v);
  return r;
}

/** Drag horizontally on `handle` to scrub a numeric value (pointer + touch). */
function scrub(handle: HTMLElement, get: () => number, set: (v: number) => void, step = 0.05): void {
  handle.classList.add('sc-scrub');
  let startX = 0;
  let startV = 0;
  let active = false;
  let pid = -1;
  handle.addEventListener('pointerdown', (e) => {
    active = true;
    pid = e.pointerId;
    startX = e.clientX;
    startV = get();
    handle.setPointerCapture(pid);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!active) return;
    set(startV + (e.clientX - startX) * step);
  });
  const end = (): void => {
    if (!active) return;
    active = false;
    try {
      handle.releasePointerCapture(pid);
    } catch {
      /* capture already gone */
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ── value formatting (read-only fallback) ─────────────────────────────────────────

export function fmt(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean' || typeof v === 'string') return String(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  const o = v as Record<string, unknown> & { isVector3?: boolean; isVector2?: boolean; isColor?: boolean; isEuler?: boolean; isObject3D?: boolean };
  if (o.isVector3 || o.isVector2) return vec(o as unknown as Vector3);
  if (o.isEuler) return euler(o as unknown as Euler);
  if (o.isColor) return `#${(o as unknown as Color).getHexString()}`;
  if (o.isObject3D) return (o as unknown as Object3D).name || '(node)';
  if (o.constructor?.name === 'PrefabRef') return '(prefab)';
  if ('node' in o && 'engine' in o) return componentName(v as Component) ?? '(component)';
  return String(v);
}

export const vec = (v: Vector3 | Vector2): string =>
  'z' in v ? `${round(v.x)} ${round(v.y)} ${round((v as Vector3).z)}` : `${round(v.x)} ${round(v.y)}`;
export const euler = (e: Euler): string => `${toDeg(e.x)} ${toDeg(e.y)} ${toDeg(e.z)}`;
export const eulerArr = (e: Euler): number[] => [e.x, e.y, e.z];
const fmtNum = (n: number): string => String(round(n));
