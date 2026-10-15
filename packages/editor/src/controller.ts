/**
 * What the editor does, apart from how it looks: where every live object was written, what the
 * inspector shows for a node, and every write — to the live object at once, then to the `.tsx`
 * file it came from, one attribute spliced and everything else byte for byte.
 *
 * The interface reads it and calls it; `changed` tells the interface to read it again.
 */
import type { Behaviour, EditHost } from '@scenoco-three/core';
import type { Object3D } from 'three';
import { Docs, type Address } from './docs.js';
import { History, type Step, type Written } from './history.js';

export type Mode = 'translate' | 'rotate' | 'scale';
export type Space = 'world' | 'local';

/** What the gizmo writes, by its mode. */
const MODE_PROPERTY = { translate: 'position', rotate: 'rotation', scale: 'scale' } as const;

/** One inspector row. */
export interface Row {
  name: string;
  /** The value a widget edits — a number, flag, string, `#rrggbb` or list of numbers — or, locked, the text shown. */
  value: unknown;
  /** Shown, not edited: a name in the scene, a constructor argument, a value nothing could read. */
  locked?: string;
  /** Not written in the file: the value is the default. */
  unset?: boolean;
  /** Radians on the object, degrees in the widget. */
  degrees?: boolean;
  /** `preview` applies to the live object only — a scrub in progress — and writes nothing. */
  commit?: (value: unknown, preview?: boolean) => void;
  /** Take the attribute out of the file. */
  clear?: () => void;
}

export interface Group {
  title: string;
  rows: Row[];
  hint?: string;
}

export interface Inspected {
  title: string;
  /** `file.tsx:12`, when an element made it. */
  source?: string;
  hint?: string;
  groups: Group[];
}

export class Controller {
  readonly host: EditHost;
  mode: Mode = 'translate';
  space: Space = 'world';
  status = { text: 'loading…', error: false };
  private readonly docs = new Docs();
  private readonly history = new History();
  /** Where each live object's element is — worked out once, before any edit moves the text. */
  private readonly addresses = new Map<object, Address>();
  private readonly ready: Promise<void>;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  /** Called after anything the interface shows has changed. */
  changed: () => void = () => {};

  constructor(host: EditHost) {
    this.host = host;
    host.on('transform', (node) => node && void this.writeTransform(node));
    this.ready = this.locateAll();
    void this.ready.then(
      () => this.say(`${this.addresses.size} elements · tap one to select it`),
      (error: unknown) => this.say(message(error), true),
    );
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.host.setMode(mode);
    this.changed();
  }

  setSpace(space: Space): void {
    this.space = space;
    this.host.setSpace(space);
    this.changed();
  }

  /** Whether an element wrote this node — the tree dims the ones code made. */
  authored(node: Object3D): boolean {
    return !!this.host.sourceOf(node);
  }

  /** A message under the toolbar; anything but an error fades. */
  say(text: string, error = false): void {
    this.status = { text, error };
    clearTimeout(this.statusTimer);
    if (!error) this.statusTimer = setTimeout(() => ((this.status = { text: '', error: false }), this.changed()), 4000);
    this.changed();
  }

  // --- where every live object was written --------------------------------------------------

  /** Every node, and what hangs on it — geometry, materials, behaviours — mapped to its element. */
  private async locateAll(): Promise<void> {
    const made: object[] = [];
    this.host.root.traverse((node) => made.push(node, ...parts(node), ...this.host.behavioursOn(node)));
    await Promise.all(
      made.map(async (object) => {
        const source = this.host.sourceOf(object);
        if (!source) return;
        const address = await this.docs.locate(source.fileName, source.lineNumber, source.columnNumber);
        if (address) this.addresses.set(object, address);
      }),
    );
  }

  // --- the inspector ---------------------------------------------------------------------------

  async inspect(node: Object3D): Promise<Inspected> {
    await this.ready.catch(() => {});
    const address = this.addresses.get(node);
    const source = this.host.sourceOf(node);
    const groups: Group[] = [];

    // The transform, always: what the gizmo moves, live, whether or not the element writes it.
    const element = address ? await this.docs.element(address) : undefined;
    groups.push({
      title: 'Transform',
      rows: (['position', 'rotation', 'scale'] as const).map((name) => ({
        name,
        value: node[name].toArray().slice(0, 3),
        degrees: name === 'rotation',
        unset: !element?.attributes.some((a) => a.name === name),
        ...(address ? {} : { locked: 'Made by code — not written as an element' }),
        commit: (value: unknown, preview?: boolean) => void this.write(node, address, name, value, preview),
        ...(element?.attributes.some((a) => a.name === name) && address ? { clear: () => void this.remove(address, name) } : {}),
      })),
    });

    if (address) groups.push(await this.attributes(node, address, ['position', 'rotation', 'scale'], node.type));
    for (const part of parts(node)) {
      const at = this.addresses.get(part);
      if (at) groups.push(await this.attributes(part, at, [], (await this.docs.element(at))?.tag ?? part.constructor.name));
    }
    for (const behaviour of this.host.behavioursOn(node)) groups.push(await this.behaviour(behaviour));
    return {
      title: label(node),
      ...(source ? { source: `${source.fileName.split('/').pop()}:${source.lineNumber}` } : {}),
      ...(address ? {} : { hint: 'Not written as an element here — made by code or passed in a prop.' }),
      groups,
    };
  }

  /** An element's own attributes, each editable when its value could be read. */
  private async attributes(target: object, address: Address, skip: string[], title: string): Promise<Group> {
    const element = await this.docs.element(address);
    const rows: Row[] = [];
    for (const attribute of element?.attributes ?? []) {
      if (skip.includes(attribute.name)) continue;
      const clear = () => void this.remove(address, attribute.name);
      if (attribute.value.kind === 'reference') {
        rows.push({ name: attribute.name, value: attribute.value.text, locked: 'A name in the scene — change it in the file', clear });
      } else if (attribute.name === 'args' || attribute.name === 'ref' || attribute.name === 'attach') {
        // Constructor arguments make the object; changing them means building it again.
        rows.push({ name: attribute.name, value: attribute.text ?? 'true', locked: 'Makes the object — change it in the file' });
      } else {
        rows.push({
          name: attribute.name,
          value: attribute.value.value,
          degrees: attribute.name === 'rotation',
          commit: (value, preview) => void this.write(target, address, attribute.name, value, preview),
          clear,
        });
      }
    }
    return { title, rows, ...(rows.length ? {} : { hint: 'No attributes.' }) };
  }

  /** A behaviour's settings: what the element writes, and every other public field at its default. */
  private async behaviour(behaviour: Behaviour): Promise<Group> {
    const address = this.addresses.get(behaviour);
    const element = address ? await this.docs.element(address) : undefined;
    const rows: Row[] = [];
    for (const field of this.host.fieldsOf(behaviour)) {
      const written = element?.attributes.find((a) => a.name === field.name);
      const commit = (value: unknown, preview?: boolean) => void this.write(behaviour, address, field.name, value, preview);
      if (written?.value.kind === 'reference') {
        rows.push({ name: field.name, value: written.value.text, locked: 'A name in the scene — change it in the file', ...(address ? { clear: () => void this.remove(address, field.name) } : {}) });
      } else if (written) {
        rows.push({ name: field.name, value: written.value.value, commit, ...(address ? { clear: () => void this.remove(address, field.name) } : {}) });
      } else {
        const live = plain((behaviour as unknown as Record<string, unknown>)[field.name]);
        rows.push({
          name: field.name,
          value: live ?? '—',
          unset: true,
          ...(live === undefined ? { locked: 'No attribute can express this value' } : address ? { commit } : { locked: 'Made by code — not written as an element' }),
        });
      }
    }
    return { title: behaviour.constructor.name, rows };
  }

  // --- writing ---------------------------------------------------------------------------------

  /** The live object first, so the change is seen at once; then the file. */
  private async write(target: object, address: Address | undefined, name: string, value: unknown, preview = false): Promise<void> {
    this.host.apply(target, name, value);
    if (preview || !address) return;
    try {
      const before = await this.written(address, name);
      await this.docs.set(address, name, value);
      this.record({ ...address, name, before, after: await this.written(address, name) });
      this.say(`saved ${name} → ${address.file.split('/').pop()}`);
    } catch (error) {
      this.say(`not saved: ${message(error)}`, true);
    }
  }

  /**
   * Take an attribute out of the file. What the object goes back to is its constructor's default,
   * which only building it again can say — so the page builds it again.
   */
  private async remove(address: Address, name: string): Promise<void> {
    try {
      const before = await this.written(address, name);
      await this.docs.remove(address, name);
      this.record({ ...address, name, before, after: null });
      location.reload();
    } catch (error) {
      this.say(`not removed: ${message(error)}`, true);
    }
  }

  private async writeTransform(node: Object3D): Promise<void> {
    const name = MODE_PROPERTY[this.mode];
    await this.write(node, this.addresses.get(node), name, (node[name].toArray() as number[]).slice(0, 3));
  }

  // --- undo -------------------------------------------------------------------------------------

  private async written(address: Address, name: string): Promise<Written | null> {
    const attribute = (await this.docs.element(address))?.attributes.find((a) => a.name === name);
    return attribute ? { text: attribute.text, value: attribute.value } : null;
  }

  private record(step: Step): void {
    if (JSON.stringify(step.before) !== JSON.stringify(step.after)) this.history.push(step);
    this.changed();
  }

  /**
   * Put one step's other side back into the file. A value the editor can read is applied to the
   * live object at once; anything else — a removed attribute, a named reference — only building the
   * scene again can show, so the page reloads.
   */
  async step(undo: boolean): Promise<void> {
    const step = undo ? this.history.undo() : this.history.redo();
    if (!step) return;
    const state = undo ? step.before : step.after;
    try {
      if (state) await this.docs.setText(step, step.name, state.text);
      else await this.docs.remove(step, step.name);
    } catch (error) {
      this.history.restore(step, undo);
      this.say(`could not ${undo ? 'undo' : 'redo'}: ${message(error)}`, true);
      return;
    }
    const target = [...this.addresses].find(([, at]) => at.file === step.file && at.index === step.index)?.[0];
    if (!state || state.value.kind !== 'value' || !target) {
      location.reload();
      return;
    }
    this.host.apply(target, step.name, state.value.value);
    this.say(`${undo ? 'undid' : 'redid'} ${step.name}`);
  }
}

/** A node's geometry and materials — what its child elements may have filled. */
function parts(node: Object3D): object[] {
  const drawn = node as Object3D & { geometry?: object; material?: object | object[] };
  return [drawn.geometry, ...(Array.isArray(drawn.material) ? drawn.material : [drawn.material])].filter((p): p is object => !!p);
}

/** A live field's value in the shapes a widget offers: numbers, flags, strings, colours, vectors. */
function plain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  const v = value as { isColor?: boolean; getHexString?: () => string; toArray?: () => unknown[] };
  if (v.isColor && v.getHexString) return `#${v.getHexString()}`;
  if (typeof v.toArray === 'function') return v.toArray().filter((x) => typeof x === 'number');
  if (Array.isArray(value) && value.every((x) => typeof x !== 'object')) return value;
  return undefined;
}

export function label(node: Object3D): string {
  return node.name ? `${node.name} · ${node.type}` : node.type;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
