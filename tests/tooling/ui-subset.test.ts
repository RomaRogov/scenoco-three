import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { easingName } from '../../packages/unity/src/page.js';

/**
 * The rules card's UI rule, held to: a game's page is UI Toolkit's UXML and USS written in HTML, so it
 * ports to Unity file by file. The home page is the site.
 */
const root = new URL('../../', import.meta.url).pathname;
const pages = ['examples/breakout', 'examples/eggy', 'examples/race', 'examples/td', 'packages/create/template'];

/** CSS that USS does not have — the card's "Not there" list. */
const NOT_USS: [string, RegExp][] = [
  ['@keyframes or animation', /@keyframes|(^|[;{\s])animation(-[a-z]+)?\s*:/],
  ['calc, clamp, min or max', /\b(calc|clamp|min|max)\(/],
  ['a viewport or container unit', /\d(vw|vh|vmin|vmax|cqw|cqh|dvh|svh)\b/],
  ['em or rem', /\d(r?em)\b/],
  ['a gradient', /gradient\(/],
  ['box-shadow', /box-shadow/],
  ['::before or ::after', /::?(before|after)\b/],
  ['an attribute selector', /\[[a-z-]+(=[^\]]*)?\][^{;]*\{/],
  ['grid', /display\s*:\s*grid|grid-template/],
  ['position: fixed', /position\s*:\s*fixed/],
  ['inset', /(^|[;{\s])inset\s*:/],
  ['gap', /(^|[;{\s])gap\s*:/],
  ['z-index', /z-index/],
  ['line-height', /line-height/],
  ['!important', /!important/],
  ['@media', /@media/],
  ['a structural pseudo-class', /:(not|nth-[a-z]+|first-child|last-child|has)\(?/],
];

/** DOM writes UI Toolkit has no counterpart for. */
const NOT_UI_TOOLKIT: [string, RegExp][] = [
  ['innerHTML', /\.innerHTML\b/],
  ['dataset', /\.dataset\b/],
  ['a custom property set from code', /\.style\.setProperty/],
  ['the hidden property', /\.hidden\s*=/],
  ['element.animate', /\.animate\(\s*\[/],
  ['a reflow to restart an animation', /offsetWidth/],
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe('a game UI ports to UI Toolkit', () => {
  it("each page's markup, CSS and code stay within UXML, USS and what UI Toolkit can do", () => {
    const problems: string[] = [];
    for (const page of pages) {
      const html = readFileSync(join(root, page, 'index.html'), 'utf8');
      const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      for (const [what, pattern] of NOT_USS) if (pattern.test(css)) problems.push(`${page}/index.html: ${what}`);
      // USS names its easings; the curve CSS writes must be one of them, so both animate alike.
      for (const [curve] of css.matchAll(/cubic-bezier\([^)]*\)/g)) if (!easingName(curve)) problems.push(`${page}/index.html: ${curve} is none of USS's easings`);
      // CSS's flex-direction defaults to row and USS's to column: a flex rule that says neither lays out
      // differently once ported.
      for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
        const [selector, declarations = ''] = block.split('{');
        if (/display\s*:\s*flex/.test(declarations) && !/flex-direction/.test(declarations)) problems.push(`${page}/index.html: ${selector!.trim()} is flex with no flex-direction`);
      }
      const body = html.slice(html.indexOf('<body'));
      const tags = new Set([...body.matchAll(/<([a-z][a-z0-9]*)\b/g)].map((m) => m[1]!));
      for (const tag of tags) if (!['body', 'div', 'button', 'template', 'script'].includes(tag)) problems.push(`${page}/index.html: <${tag}>`);
      for (const [, name] of body.matchAll(/\sdata-([a-z-]+)=/g)) if (name !== 'button') problems.push(`${page}/index.html: data-${name}`);
      for (const file of files(join(root, page, 'src')).filter((f) => /\.tsx?$/.test(f))) {
        const code = readFileSync(file, 'utf8');
        for (const [what, pattern] of NOT_UI_TOOLKIT) if (pattern.test(code)) problems.push(`${file.slice(root.length)}: ${what}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
