/** What the panel shows of the selected node: its tags and their attributes, from `Reader`. */
import type { Behaviour, EditHost, Source } from '@scenoco-three/core';
import type { Object3D } from 'three';
import type { History } from './history.js';
import { type ElementJson, keyOf, type SceneFiles, sourceKey, where } from './server.js';
import type { Address, Attr, Stage, Tag, View } from './types.js';
import { asShown, codeOf, kindOf, read, shown } from './values.js';

/** What a tag is shown as: written into its file, live only and why, or locked; and whether every copy takes a change. */
interface Context {
  liveOnly?: string;
  locked?: boolean;
  wide?: boolean;
}

const TRANSFORM = ['position', 'rotation', 'scale'] as const;

/**
 * A node read as the TSX that made it: its element, what its children attached, the behaviours on
 * it — each attribute live, and where a change to it is written, or why it is not.
 */
export class Reader {
  private readonly host: EditHost;
  private readonly files: SceneFiles;
  private readonly history: History;
  /** The prefab being edited, if one is: what is inside it is written, what is outside is locked. */
  private readonly stage: () => Stage | null;

  constructor(host: EditHost, files: SceneFiles, history: History, stage: () => Stage | null) {
    this.host = host;
    this.files = files;
    this.history = history;
    this.stage = stage;
  }

  /**
   * The node as its TSX. A prefab's copy is two layers: its tag — this copy's overrides, in the
   * scene — and the prefab's own, read-only until prefab mode is entered (`enter`). In prefab mode
   * what the prefab is made of is written into its file, and every copy takes each change.
   */
  async view(node: Object3D): Promise<View> {
    const { host } = this;
    const stage = this.stage();
    const made = host.madeBy(node);
    const part = this.partOf(node);
    if (stage && !within(node, stage.root)) {
      return { ...(await this.plain(node, { locked: true })), note: `outside the prefab <${stage.name}> — ← Scene to edit the scene` };
    }
    if (part && part !== stage?.root) {
      const name = this.prefabName(part);
      return { ...(await this.plain(node, { locked: true })), note: `part of the prefab <${name}>`, enter: { root: part, name } };
    }
    const shared = this.sharedBy(node);
    if (shared) {
      return {
        ...(await this.plain(node, { locked: true })),
        note: `part of <${shared.name}>, a plain component placed ${shared.count} times`,
        advice:
          `Its markup is written once, so an edit here would change every <${shared.name}>. Make it a prefab — ` +
          `export const ${shared.name} = prefab((props) => …) — to edit it in prefab mode and set each copy's props on its tag.`,
      };
    }
    const wide = !!stage;
    const liveOnly = !stage && host.spawned(node) ? 'spawned while the game ran' : undefined;
    if (stage && node === stage.root) {
      // The prefab's own root: its element in the prefab's file. Each copy's tag places and names it.
      const own = host.own(node) ?? {};
      const tag = await this.tagOf(node, own.source, own.given, { wide }, { fixed: 'each copy’s tag places it — change that in the scene' });
      return { tag, attached: await this.attached(node, { wide }), behaviours: await this.behaviours(node, { wide }) };
    }
    if (made?.prefab) {
      const own = host.own(node) ?? {};
      const tag = await this.tagOf(node, host.sourceOf(node), host.givenOf(node), { liveOnly, wide }, { props: made.props, name: this.tagName(node) });
      const ownTag = await this.tagOf(node, own.source, own.given, { locked: true }, { fixed: false });
      // The prefab's own behaviours are its, locked here; the ones this copy's tag added are the scene's.
      const added = new Set<object>(made.added.behaviours);
      const on = this.host.behavioursOn(node);
      const prefabs = await Promise.all(on.filter((b) => !added.has(b)).map((b) => this.behaviour(b, { locked: true })));
      const mine = await Promise.all(on.filter((b) => added.has(b)).map((b) => this.behaviour(b, { liveOnly, wide })));
      const prefab = { name: this.prefabName(node), where: own.source && where(own.source), own: ownTag, behaviours: prefabs, root: node };
      return { tag, attached: [], behaviours: mine, prefab, note: liveOnly };
    }
    return { ...(await this.plain(node, { liveOnly, wide })), note: liveOnly };
  }

  /** A node that is neither a prefab's copy nor its root in prefab mode: its own element and behaviours. */
  private async plain(node: Object3D, ctx: Context): Promise<View> {
    const made = this.host.madeBy(node);
    const fixed = made && !made.prefab ? `<${this.tagName(node)}> is a plain component: its tag cannot place it` : undefined;
    const tag = await this.tagOf(node, this.host.sourceOf(node), this.host.givenOf(node), ctx, made ? { props: made.props, fixed } : {});
    return { tag, attached: made ? [] : await this.attached(node, ctx), behaviours: made ? [] : await this.behaviours(node, ctx) };
  }

  /** What the node holds that an element made — its geometry, its material, a scene's fog — as tags of their own. */
  private async attached(node: Object3D, ctx: Context): Promise<Tag[]> {
    const tags: Tag[] = [];
    for (const value of Object.values(node)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Object3D).isObject3D) continue;
      const source = this.host.sourceOf(value);
      if (source) tags.push(await this.tagOf(value, source, this.host.givenOf(value), ctx, { fixed: false }));
    }
    return tags;
  }

  /**
   * One element as a tag. `props`: a function's tag, whose props are its attributes. `fixed`: the
   * transform and name are not this element's to write — false leaves them out.
   */
  private async tagOf(
    node: object,
    source: Source | undefined,
    given: Readonly<Record<string, unknown>> | undefined,
    ctx: Context,
    how: { props?: Readonly<Record<string, unknown>>; fixed?: string | false; name?: string },
  ): Promise<Tag> {
    const address = source ? await this.files.addressFor(source) : null;
    const element = address ? await this.files.element(address) : undefined;
    const texts = new Map(element?.attributes.map((a) => [a.name, a.text]));
    const liveOnly = ctx.liveOnly ?? (ctx.locked || address ? undefined : source ? 'not found in its file' : 'made in code');
    const here = { ...ctx, liveOnly, from: source && sourceKey(source) };
    const attrs: Attr[] = [];
    if (how.fixed !== false) {
      const fixed = { ...here, liveOnly: here.liveOnly ?? how.fixed };
      const at = node as Object3D;
      if (at.name || texts.has('name')) attrs.push(this.attr(node, 'name', at.name, texts, given ?? {}, fixed, address));
      for (const name of TRANSFORM) attrs.push(this.attr(node, name, at[name], texts, given ?? {}, fixed, address));
    }
    if (how.props) {
      // A function's tag: its props, live as last passed, then those it declares and the tag leaves
      // out, at their defaults. Changing one calls the function again.
      const types = this.files.typesOf(address);
      const declared = Object.keys(types?.fields ?? {}).filter((name) => !(name in how.props!));
      for (const [name, value] of [...Object.entries(how.props), ...declared.map((name) => [name, types?.defaults?.[name]] as const)]) {
        if (name === 'children' || name === 'name' || (TRANSFORM as readonly string[]).includes(name)) continue;
        const attr = this.attr(node, name, value, texts, given ?? {}, here, address);
        if (attr.written || attr.kind) attrs.push({ ...attr, prop: true });
      }
    } else {
      // The element's own attributes past the transform, in the order written.
      for (const [name, text] of texts) {
        if (name === 'name' || (TRANSFORM as readonly string[]).includes(name)) continue;
        const items = element?.attributes.find((a) => a.name === name)?.items;
        if (name === 'args' && Array.isArray(given?.args)) attrs.push(...this.argAttrs(node, text, items, given.args, here, address));
        else attrs.push(this.attr(node, name, read(node, name), texts, given ?? {}, here, address, text));
      }
    }
    return { name: how.name ?? element?.tag ?? node.constructor.name, attrs: withItems(attrs, element), where: source && where(source) };
  }

  private behaviours(node: Object3D, ctx: Context): Promise<Tag[]> {
    return Promise.all(this.host.behavioursOn(node).map((b) => this.behaviour(b, ctx)));
  }

  private async behaviour(b: Behaviour, ctx: Context): Promise<Tag> {
    const source = this.host.sourceOf(b);
    const address = source ? await this.files.addressFor(source) : null;
    const element = address ? await this.files.element(address) : undefined;
    const texts = new Map(element?.attributes.map((a) => [a.name, a.text]));
    const given = this.host.givenOf(b) ?? {};
    const liveOnly = ctx.liveOnly ?? (ctx.locked || address ? undefined : source ? 'not found in its file' : 'added in code');
    const here = { ...ctx, liveOnly, from: source && sourceKey(source) };
    // What the class declares private is not the element's to set.
    const hidden = new Set(this.files.typesOf(address)?.hidden);
    const fields = Object.keys(b).filter((key) => !key.startsWith('_') && !key.startsWith('#') && !hidden.has(key));
    // Written attributes first, in the file's order; then the other fields, at their defaults.
    const order = [...texts.keys(), ...fields.filter((f) => !texts.has(f))];
    const attrs: Attr[] = [];
    for (const name of order) {
      const value = (b as unknown as Record<string, unknown>)[name];
      if (typeof value === 'function') continue;
      const attr = this.attr(b, name, value, texts, given, here, address);
      // An unwritten field only shows when it can be edited: a list or a reference has nothing to show.
      if (!attr.written && !attr.kind) continue;
      attrs.push(attr);
    }
    return { name: b.constructor.name, attrs: withItems(attrs, element), where: source && where(source) };
  }

  private attr(
    target: object,
    name: string,
    live: unknown,
    texts: Map<string, string | null>,
    given: Readonly<Record<string, unknown>>,
    ctx: Context & { from?: string },
    address: Address | null,
    text: string | null = texts.get(name) ?? null,
  ): Attr {
    const field = this.files.typesOf(address)?.fields[name];
    const kind = kindOf(live, name, field);
    const written = texts.has(name);
    const value = kind ? shown(live, kind) : live;
    const writes = !ctx.liveOnly && !ctx.locked && address ? address : undefined;
    const from = written && writes && kind && name in given ? asShown(given[name], kind, name, value, field) : undefined;
    const moved = from !== undefined && JSON.stringify(from) !== JSON.stringify(value);
    const unsaved = !!writes && this.history.isUnsaved(keyOf(writes, name));
    const back = moved ? from : unsaved ? this.history.beforeOf(keyOf(writes, name)) : undefined;
    return {
      name,
      value,
      kind,
      written,
      text,
      liveOnly: ctx.liveOnly,
      locked: ctx.locked,
      wide: ctx.wide && !!writes,
      element: ctx.from,
      at: writes,
      unsaved,
      file: from,
      source: back !== undefined && JSON.stringify(back) !== JSON.stringify(value) ? back : undefined,
      target,
      links: written && address ? this.files.linksOf(address, name) : undefined,
      ...(kind === 'option' && field?.kind === 'option' && { options: field.options }),
    };
  }

  /**
   * `args={[…]}` as a line per argument, named for the constructor's parameter. One the live object
   * can take — the property it sets, or a geometry made again — and written as a value is editable;
   * the rest are shown as written.
   */
  private argAttrs(target: object, whole: string | null, items: string[] | undefined, given: unknown[], ctx: Context & { from?: string }, address: Address | null): Attr[] {
    const settable = this.host.parameters(target);
    // The constructor `args` fits: as many parameters as it gives, or the first that takes that many.
    const constructors = this.files.typesOf(address)?.constructors ?? [];
    const declared = constructors.find((c) => c.length === given.length) ?? constructors.find((c) => c.length >= given.length) ?? [];
    const writes = !ctx.liveOnly && !ctx.locked && address ? address : undefined;
    const now = this.history.argsOf(this.host.current(target)) ?? { list: [...given], items: items ? [...items] : given.map(codeOf) };
    const unsaved = !!writes && this.history.isUnsaved(keyOf(writes, 'args'));
    return now.list.map((value, index) => {
      const name = declared[index]?.name ?? `arg${index}`;
      const field = declared[index]?.field;
      const own = kindOf(value, name, field);
      const kind = own && settable[index]?.settable && items?.length === given.length ? own : undefined;
      const first = kind ? shown(given[index], kind) : given[index];
      const shownValue = kind ? shown(value, kind) : value;
      const moved = kind !== undefined && JSON.stringify(first) !== JSON.stringify(shownValue);
      return {
        name,
        value: shownValue,
        kind,
        written: true,
        text: now.items[index] ?? codeOf(value),
        liveOnly: ctx.liveOnly,
        locked: ctx.locked,
        wide: ctx.wide && !!writes,
        element: ctx.from,
        at: writes,
        unsaved,
        file: first,
        source: moved ? first : undefined,
        target,
        arg: { index, now, original: items ?? [], whole },
        ...(kind === 'option' && field?.kind === 'option' && { options: field.options }),
      };
    });
  }

  /**
   * The prefab copy a node is part of — the nearest one above it — or null. A node its copy's tag added
   * is the scene's, as an object added to a Unity prefab instance: not part of the prefab.
   */
  private partOf(node: Object3D): Object3D | null {
    for (let below = node, up = node.parent; up; below = up, up = up.parent) {
      const made = this.host.madeBy(up);
      if (made?.prefab && !made.added.nodes.includes(below)) return up;
    }
    return null;
  }

  /**
   * The plain component a node is inside of that is placed more than once — a function not made a
   * prefab, whose markup every use shares — or null. Looked for up to the prefab copy the node is
   * in, which prefab mode already guards.
   */
  private sharedBy(node: Object3D): { name: string; count: number } | null {
    for (let up = node.parent; up; up = up.parent) {
      const made = this.host.madeBy(up);
      if (made?.prefab || up === this.stage()?.root) return null;
      if (!made) continue;
      let count = 0;
      this.host.scene.traverse((n) => void (this.host.madeBy(n)?.fn === made.fn && count++));
      if (count > 1) return { name: made.name || this.tagName(up), count };
    }
    return null;
  }

  /** A prefab's name: the constant its function is written in — `prefab(() => …)` has none of its own. */
  prefabName(root: Object3D): string {
    const own = this.host.own(root)?.source;
    const owner = own && this.files.ownerAt(own);
    return owner ?? (this.host.madeBy(root)?.name || this.tagName(root));
  }

  /**
   * What a node's tag says: `<Bridge>` for what a function's tag made — a prefab's function has no
   * name of its own, `prefab(() => …)`, so it is read from the file — and the class for the rest.
   */
  tagName(node: Object3D): string {
    const made = this.host.madeBy(node);
    if (!made) return node.constructor.name;
    // A spawned copy has no tag to read: its prefab's name is.
    if (this.host.spawned(node) && made.prefab && !this.host.spawned(node.parent ?? node)) {
      // Not `prefabName`: it falls back here while the prefab's file is still being read.
      const own = this.host.own(node)?.source;
      return (own && this.files.ownerAt(own)) || made.name || node.name || node.type;
    }
    const source = this.host.sourceOf(node);
    return (source && this.files.tagAt(source)) || made.name || node.name || node.type;
  }
}

/** Each written list's item texts, onto its attribute. */
function withItems(attrs: Attr[], element: ElementJson | undefined): Attr[] {
  const items = new Map(element?.attributes.flatMap((a) => (a.items ? [[a.name, a.items] as const] : [])));
  return attrs.map((attr) => (!attr.arg && items.has(attr.name) ? { ...attr, items: items.get(attr.name) } : attr));
}

function within(node: Object3D, root: Object3D): boolean {
  for (let n: Object3D | null = node; n; n = n.parent) if (n === root) return true;
  return false;
}
