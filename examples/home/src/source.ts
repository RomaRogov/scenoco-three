/**
 * The "Source" button: this page's own files, as written, the scene first. Read at build time with
 * Vite's `?raw`, so what it shows is exactly what runs.
 */
const files = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '!./source.ts'], { query: '?raw', import: 'default', eager: true });

const REPO = 'https://github.com/RomaRogov/scenoco-three/tree/main/examples/home/src';

/** The scene, then the behaviours, then the rest. */
const order = (path: string) => (path.endsWith('.tsx') ? 0 : /\/main\.ts$/.test(path) ? 2 : 1);
const paths = Object.keys(files).sort((a, b) => order(a) - order(b) || a.localeCompare(b));

const KEYWORDS =
  'import|from|export|const|let|class|extends|return|new|if|else|for|of|in|private|readonly|override|this|await|async|true|false|null|type|interface|function|yield';
const TOKENS = new RegExp(
  [
    String.raw`(?<comment>\/\*[\s\S]*?\*\/|\/\/[^\n]*)`,
    String.raw`(?<string>'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\`(?:\\.|[^\`\\])*\`)`,
    String.raw`(?<tag></?[A-Z][\w.]*)`,
    String.raw`(?<keyword>\b(?:${KEYWORDS})\b)`,
    String.raw`(?<attr>\b[a-z][\w-]*(?==))`,
    String.raw`(?<type>\b[A-Z]\w*\b)`,
    String.raw`(?<number>\b\d+(?:\.\d+)?\b)`,
  ].join('|'),
  'g',
);

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Code as HTML, coloured by kind: comments, strings, tags, keywords, attributes, types, numbers. */
function highlight(code: string): string {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(TOKENS)) {
    const kind = Object.entries(match.groups!).find(([, v]) => v !== undefined)![0];
    out += escape(code.slice(last, match.index)) + `<span class="t-${kind}">${escape(match[0])}</span>`;
    last = match.index! + match[0].length;
  }
  return out + escape(code.slice(last));
}

export function installSourceButton(): void {
  const button = document.getElementById('source-button')!;
  const panel = document.getElementById('source')!;
  const tabs = panel.querySelector('.tabs')!;
  const code = panel.querySelector('code')!;
  const link = panel.querySelector<HTMLAnchorElement>('.github')!;

  const show = (path: string) => {
    code.innerHTML = highlight(files[path]!);
    code.parentElement!.scrollTop = 0;
    link.href = `${REPO}/${path.slice(2)}`;
    for (const tab of tabs.children) tab.classList.toggle('on', (tab as HTMLElement).dataset.path === path);
  };
  for (const path of paths) {
    const tab = document.createElement('button');
    tab.textContent = path.slice(2);
    tab.dataset.path = path;
    tab.onclick = () => show(path);
    tabs.appendChild(tab);
  }

  const open = (on: boolean) => {
    panel.hidden = !on;
    document.body.classList.toggle('source-open', on);
    button.setAttribute('aria-expanded', String(on));
  };
  button.onclick = () => open(button.getAttribute('aria-expanded') !== 'true');
  panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => open(false);
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') open(false);
  });
  show(paths[0]!);
}
