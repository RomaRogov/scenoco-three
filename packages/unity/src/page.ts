/**
 * The game's page as UI Toolkit's own files. A SceNoCo page is UXML and USS written in HTML — its
 * `<style>` the USS, the element each `UIDocument` names the UXML — so this is a translation of
 * spelling, rule by rule, not a redesign:
 *
 * - each `UIDocument`'s element is a `.uxml`, each `<template>` one too; a `div` is a
 *   `VisualElement`, or a `Label` when it holds text or may (code sets `textContent`), a `button` a
 *   `Button`, `id` its `name`;
 * - the `<style>` is one `.uss`: what USS spells differently is respelled, what it does not have is
 *   left out with a word — `pointer-events` becomes each element's `picking-mode`;
 * - the images the CSS names are copied in, and its web fonts downloaded as `.ttf`, which Unity makes
 *   Font Assets of.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * USS's named easings, by the cubic-bezier each stands for. CSS writes the curve, USS the name: a page
 * that ports writes one of these curves, or one of the keywords both have.
 */
export const USS_EASINGS: Record<string, string> = {
  '0.12, 0, 0.39, 0': 'ease-in-sine',
  '0.61, 1, 0.88, 1': 'ease-out-sine',
  '0.37, 0, 0.63, 1': 'ease-in-out-sine',
  '0.32, 0, 0.67, 0': 'ease-in-cubic',
  '0.33, 1, 0.68, 1': 'ease-out-cubic',
  '0.65, 0, 0.35, 1': 'ease-in-out-cubic',
  '0.55, 0, 1, 0.45': 'ease-in-circ',
  '0, 0.55, 0.45, 1': 'ease-out-circ',
  '0.85, 0, 0.15, 1': 'ease-in-out-circ',
  '0.36, 0, 0.66, -0.56': 'ease-in-back',
  '0.34, 1.56, 0.64, 1': 'ease-out-back',
  '0.68, -0.6, 0.32, 1.6': 'ease-in-out-back',
};

/** The USS name of a `cubic-bezier(…)`, or undefined when USS has none. */
export function easingName(curve: string): string | undefined {
  const numbers = /cubic-bezier\(([^)]*)\)/.exec(curve)?.[1]?.split(',').map((n) => String(Number(n.trim())));
  return numbers ? USS_EASINGS[numbers.join(', ')] : undefined;
}

interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Element[];
  text: string;
  parent?: Element;
}

export interface PageOutput {
  /** Files to write into the Unity project, by path under it. */
  files: Map<string, string>;
  /** Files to copy: from the game → to a path under the Unity project. */
  copies: Map<string, string>;
  /** Files to download: URL → path under the Unity project. */
  downloads: Map<string, string>;
  /** Each document's UXML, by the element it names. */
  documents: Map<string, string>;
  warnings: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', times: '×' };
const decode = (s: string) => s.replace(/&(#\d+|[a-z]+);/g, (m, e: string) => (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : (ENTITIES[e] ?? m)));
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A page's elements: enough of HTML for the pages SceNoCo writes — no scripts, no void elements but these. */
function parse(html: string): Element {
  const root: Element = { tag: '#root', attrs: {}, children: [], text: '' };
  let at = root;
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      if (m[5].trim()) at.text += (at.text ? ' ' : '') + decode(m[5].trim().replace(/\s+/g, ' '));
      continue;
    }
    const [, close, tag, rest, self] = m as unknown as [string, string, string, string, string];
    if (close) {
      if (at.parent) at = at.parent;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rest.matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)")?/g)) attrs[a[1]!] = decode(a[2] ?? '');
    const el: Element = { tag: tag.toLowerCase(), attrs, children: [], text: '', parent: at };
    at.children.push(el);
    if (!self && !['meta', 'link', 'br', 'img', 'input'].includes(el.tag)) at = el;
  }
  return root;
}

const all = (e: Element): Element[] => [e, ...e.children.flatMap(all)];

/** One compound selector — `button#play.big:active` — and whether an element is it, pseudo-classes aside. */
function compoundMatches(compound: string, e: Element): boolean {
  const plain = compound.replace(/::?[\w-]+(\([^)]*\))?/g, '');
  if (plain === '' || plain === '*') return true;
  const tag = /^[a-zA-Z][\w-]*/.exec(plain)?.[0];
  if (tag && tag.toLowerCase() !== e.tag) return false;
  const id = /#([\w-]+)/.exec(plain)?.[1];
  if (id && e.attrs.id !== id) return false;
  const classes = (e.attrs.class ?? '').split(/\s+/);
  return [...plain.matchAll(/\.([\w-]+)/g)].every((c) => classes.includes(c[1]!));
}

/** A selector — compounds by descendant or child — and whether an element is it. `>` is read as descendant. */
function matches(selector: string, e: Element): boolean {
  const parts = selector.replace(/>/g, ' ').trim().split(/\s+/);
  if (!compoundMatches(parts.at(-1)!, e)) return false;
  let ancestor = e.parent;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (ancestor && !compoundMatches(parts[i]!, ancestor)) ancestor = ancestor.parent;
    if (!ancestor) return false;
    ancestor = ancestor.parent;
  }
  return true;
}

interface Rule {
  selectors: string[];
  declarations: [string, string][];
}

function rules(css: string): { rules: Rule[]; fontFaces: string[] } {
  const fontFaces: string[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{([^}]*)\}/g, (_, body: string) => (fontFaces.push(body), ''));
  const out: Rule[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = m[2]!
      .split(';')
      .filter((d) => d.includes(':'))
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as [string, string]);
    out.push({ selectors: m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), declarations });
  }
  return { rules: out, fontFaces };
}

/** A web font face the page loads: its family, weight and style, and the `.ttf` downloaded for it. */
interface Face {
  family: string;
  weight: number;
  italic: boolean;
  path: string;
}

/** The faces of the page's Google Fonts links: their CSS, asked for as a client that is served `.ttf`. */
async function webFonts(html: string, warnings: string[]): Promise<{ faces: Face[]; downloads: Map<string, string> }> {
  const faces: Face[] = [];
  const downloads = new Map<string, string>();
  for (const link of html.matchAll(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/g)) {
    const href = decode(link[1]!);
    let css: string;
    try {
      const response = await fetch(href, { headers: { 'User-Agent': 'scenoco-unity' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      css = await response.text();
    } catch (error) {
      warnings.push(`the page's fonts (${href}) could not be fetched — ${(error as Error).message}. Unity's default font stands in.`);
      continue;
    }
    for (const face of rules(css).fontFaces) {
      const get = (prop: string) => new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(face)?.[1]?.trim() ?? '';
      const family = get('font-family').replace(/['"]/g, '');
      const url = /url\(([^)]+\.ttf)\)/.exec(face)?.[1];
      if (!family || !url) continue;
      const weight = Number(get('font-weight')) || 400;
      const italic = get('font-style') === 'italic';
      const path = `Assets/UI/Fonts/${family.replace(/\s+/g, '')}-${weight}${italic ? 'Italic' : ''}.ttf`;
      faces.push({ family, weight, italic, path });
      downloads.set(url, path);
    }
  }
  return { faces, downloads };
}

/**
 * Translate the page at `root/index.html`: the elements `documents` name (a `UIDocument`'s `element`),
 * its templates, and its style.
 */
export async function convertPage(root: string, documents: string[], options: { fonts?: boolean } = {}): Promise<PageOutput> {
  const out: PageOutput = { files: new Map(), copies: new Map(), downloads: new Map(), documents: new Map(), warnings: [] };
  const file = join(root, 'index.html');
  if (!existsSync(file) || documents.length === 0) return out;
  const html = readFileSync(file, 'utf8');
  const tree = parse(html);
  const byId = new Map(all(tree).filter((e) => e.attrs.id).map((e) => [e.attrs.id!, e]));
  for (const id of documents) if (!byId.has(id)) out.warnings.push(`index.html has no element with id="${id}" for a UIDocument — it has no UXML.`);
  const roots = documents.flatMap((id) => byId.get(id) ?? []);
  // A <template> is parsed with its content as children, like any element.
  const templates = all(tree).filter((e) => e.tag === 'template' && e.attrs.id);
  const exported = [...roots, ...templates.flatMap((t) => t.children)];
  const inside = new Set(exported.flatMap(all));

  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const parsed = rules(css);
  const { faces, downloads } = options.fonts === false ? { faces: [], downloads: new Map<string, string>() } : await webFonts(html, out.warnings);
  for (const [url, path] of downloads) out.downloads.set(url, path);

  // Picking. Core's UIDocument takes pointer events off its element, and the page gives them back
  // where a player taps: pointer-events is inherited, and the last rule that sets it on an element
  // wins. A rule that gives them back counts whatever classes it names — code puts `.shown` on as the
  // game runs, and USS has no picking to switch — while UI Toolkit picks nothing hidden anyway.
  const loose = (sel: string) => sel.replace(/\.[\w-]+|::?[\w-]+(\([^)]*\))?/g, '') || '*';
  const picking = new Map<Element, boolean>();
  const pickable = (e: Element): boolean => {
    if (picking.has(e)) return picking.get(e)!;
    let value: boolean | undefined;
    for (const r of parsed.rules)
      for (const [p, v] of r.declarations) {
        if (p !== 'pointer-events') continue;
        if (v === 'none' ? r.selectors.some((sel) => !sel.includes(':') && matches(sel, e)) : r.selectors.some((sel) => matches(loose(sel), e))) value = v !== 'none';
      }
    // A document's element starts without them, and so does a template's, which code adds under one.
    const top = roots.includes(e) || e.parent?.tag === 'template';
    const result = value ?? (top || !e.parent || !inside.has(e.parent) ? !top : pickable(e.parent));
    picking.set(e, result);
    return result;
  };

  // --- USS -------------------------------------------------------------------------------------
  const url = (raw: string): string => {
    const path = raw.replace(/^['"]|['"]$/g, '');
    if (/^https?:/.test(path)) {
      const local = `Assets/UI/remote/${basename(new URL(path).pathname)}`;
      out.downloads.set(path, local);
      return `url("project://database/${local}")`;
    }
    const clean = path.replace(/^\//, '');
    const from = [join(root, 'public', clean), join(root, clean)].find((f) => existsSync(f));
    if (!from) {
      out.warnings.push(`index.html: ${path} was not found — left as it is.`);
      return `url("${path}")`;
    }
    const to = `Assets/UI/${clean}`;
    out.copies.set(from, to);
    return `url("project://database/${to}")`;
  };
  const fontFor = (family: string, weight: number, italic: boolean): Face | undefined => {
    const own = faces.filter((f) => f.family === family);
    return own.sort((a, b) => Math.abs(a.weight - weight) + (a.italic === italic ? 0 : 1000) - (Math.abs(b.weight - weight) + (b.italic === italic ? 0 : 1000)))[0];
  };
  const DROPPED = new Set(['pointer-events', 'cursor', 'appearance', '-webkit-appearance', 'user-select', '-webkit-user-select', 'touch-action', 'font', 'border-style', 'overflow-wrap', 'box-sizing']);
  const respell = (rule: Rule): [string, string][] => {
    const own = new Map(rule.declarations);
    const weight = own.get('font-weight');
    const bold = !!weight && /bold|[6-9]00/.test(weight);
    const italic = own.get('font-style') === 'italic';
    const result: [string, string][] = [];
    let font: Face | undefined;
    for (const [prop, raw] of rule.declarations) {
      if (DROPPED.has(prop) || /\binherit\b/.test(raw)) continue;
      let value = raw.replace(/url\(([^)]+)\)/g, (_, u: string) => url(u));
      value = value.replace(/cubic-bezier\([^)]*\)/g, (curve) => {
        const name = easingName(curve);
        if (name) return name;
        out.warnings.push(`index.html: ${curve} has no USS easing — ease-out stands in. Write one of the curves USS names.`);
        return 'ease-out';
      });
      switch (prop) {
        case 'font-family': {
          const family = value.split(',')[0]!.replace(/['"]/g, '').trim();
          font = fontFor(family, bold ? 700 : weight ? Number(weight) || 400 : 400, italic);
          if (font) result.push(['-unity-font-definition', `url("project://database/${font.path}")`]);
          else if (!/^(system-ui|sans-serif|serif|monospace)$/.test(family)) out.warnings.push(`index.html: no font file for "${family}" — Unity's default font stands in. Add its .ttf to Assets/UI/Fonts.`);
          break;
        }
        case 'font-weight':
        case 'font-style':
          break; // below, together
        case 'text-align':
          result.push(['-unity-text-align', { center: 'middle-center', left: 'middle-left', right: 'middle-right' }[value] ?? 'middle-left']);
          break;
        case 'border': {
          const [width, , color] = value.split(/\s+(?![^(]*\))/);
          result.push(['border-width', width!]);
          if (color) result.push(['border-color', color]);
          break;
        }
        case 'border-image': {
          const m = /(url\([^)]*\))\s+(\d+)\s+fill\s*\/\s*(\d+)px/.exec(value);
          if (!m) {
            out.warnings.push(`index.html: border-image ${raw} is not the "url() slice fill / width" USS can nine-slice — left out.`);
            break;
          }
          const [, image, slice, width] = m;
          result.push(['background-image', image!]);
          for (const side of ['left', 'top', 'right', 'bottom']) result.push([`-unity-slice-${side}`, slice!]);
          result.push(['-unity-slice-scale', `${Number(width) / Number(slice)}px`]);
          break;
        }
        default:
          result.push([prop, value]);
      }
    }
    // A face of the right weight is drawn as it is; USS's bold would thicken it again.
    const style = (bold && !(font && font.weight >= 600) ? 'bold' : '') + (italic && !(font && font.italic) ? 'italic' : '');
    if (weight || own.has('font-style')) result.push(['-unity-font-style', style === 'bolditalic' ? 'bold-and-italic' : style || 'normal']);
    return result;
  };

  const uss: string[] = [
    '/* Written by scenoco-unity from index.html, every export: edit the page, not this. */',
    '/* UI Toolkit\'s own look, taken off as the page takes the browser\'s off its buttons. */',
    '.unity-button { margin: 0; padding: 0; border-width: 0; border-radius: 0; background-color: rgba(0, 0, 0, 0); }',
    '.unity-label { margin: 0; padding: 0; }',
    '/* The page\'s UIDocument sizes its element to the panel; here the element fills it. */',
    'TemplateContainer { flex-grow: 1; }',
    ...roots.map((r) => `#${r.attrs.id} { position: absolute; left: 0; top: 0; right: 0; bottom: 0; }`),
  ];
  for (const rule of parsed.rules) {
    // A rule for the page around the game — html, body, the canvas, the loading screen — has no element here.
    // Classes are kept whether or not the page as written has them: code puts them on as the game runs.
    const ids = new Set([...inside].map((e) => e.attrs.id).filter(Boolean));
    const kept = rule.selectors.filter(
      (sel) => [...sel.matchAll(/#([\w-]+)/g)].every((m) => ids.has(m[1]!)) && !/(^|[\s>])(html|body|canvas|head)\b/.test(sel),
    );
    if (kept.length === 0) continue;
    const declarations = respell(rule);
    if (declarations.length) uss.push(`${kept.join(', ')} {\n${declarations.map(([p, v]) => `    ${p}: ${v};\n`).join('')}}`);
  }
  out.files.set('Assets/UI/Page.uss', uss.join('\n') + '\n');
  out.files.set('Assets/UI/Theme.tss', '@import url("unity-theme://default");\n');
  for (const face of parsed.fontFaces) {
    const family = /font-family\s*:\s*['"]?([^;'"]+)/.exec(face)?.[1];
    const local = /url\(([^)]+)\)/.exec(face)?.[1]?.replace(/['"]/g, '');
    const ttf = local && [join(root, 'public', local.replace(/\.woff2?$/, '.ttf')), join(root, 'public', local.replace(/\.woff2?$/, '.otf'))].find((f) => existsSync(f));
    if (ttf) out.copies.set(ttf, `Assets/UI/Fonts/${basename(ttf)}`);
    else out.warnings.push(`index.html: the font "${family}" is ${local} — Unity imports .ttf and .otf, not .woff2. Put its .ttf beside it and export again.`);
  }

  // --- UXML ------------------------------------------------------------------------------------
  const element = (e: Element, indent: string): string[] => {
    const kids = e.children.filter((c) => c.tag !== 'template' && c.tag !== 'script');
    // A div that holds text, or may: code sets textContent at run time, and only a Label shows text.
    const tag = e.tag === 'button' ? 'ui:Button' : e.tag === 'div' && (e.text || kids.length === 0) ? 'ui:Label' : 'ui:VisualElement';
    const attrs: string[] = [];
    if (e.attrs.id) attrs.push(`name="${escape(e.attrs.id)}"`);
    if (e.attrs.class) attrs.push(`class="${escape(e.attrs.class)}"`);
    if (e.text) attrs.push(`text="${escape(e.text)}"`);
    if (e.attrs.style) attrs.push(`style="${escape(e.attrs.style)}"`);
    if (!pickable(e)) attrs.push('picking-mode="Ignore"');
    if (!['div', 'button'].includes(e.tag)) out.warnings.push(`index.html: <${e.tag}> is not UI Toolkit's — written as a VisualElement.`);
    const head = `${indent}<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    if (kids.length === 0) return [`${head} />`];
    return [`${head}>`, ...kids.flatMap((k) => element(k, indent + '    ')), `${indent}</${tag}>`];
  };
  const uxml = (e: Element) =>
    ['<ui:UXML xmlns:ui="UnityEngine.UIElements">', '    <Style src="project://database/Assets/UI/Page.uss" />', ...element(e, '    '), '</ui:UXML>', ''].join('\n');
  for (const r of roots) {
    const path = `Assets/UI/${r.attrs.id}.uxml`;
    out.files.set(path, uxml(r));
    out.documents.set(r.attrs.id!, path);
  }
  for (const t of templates) {
    const content = t.children.filter((c) => c.tag !== 'script');
    if (content.length !== 1) out.warnings.push(`index.html: <template id="${t.attrs.id}"> holds ${content.length} elements — a template's UXML holds its first.`);
    if (content[0]) out.files.set(`Assets/UI/${t.attrs.id}.uxml`, uxml(content[0]));
  }
  return out;
}
