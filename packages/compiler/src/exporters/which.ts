/**
 * `scenoco which <name>` — symbol lookup for the scene language, rendered as
 * text for a terminal (or an agent reading one).
 *
 * Every line here is a **view over `generateApi()`**, never a second lookup path:
 * that model already carries descriptions, typed attributes, source locators and
 * the relation edges, so this file is formatting only and cannot drift from the
 * validator, the runtime, or the XSD. It exists so nothing has to read
 * `scene-api.json` or an `.xsd` to answer "what is this tag and what goes in it".
 */

import { nearestName } from '../dsl/diagnostics.js';
import type {
  Attribute,
  AttachmentApi,
  ComponentApi,
  NodeApi,
  PropertyApi,
  SceneApi,
  SourceRef,
} from './api.js';

/** The entity kinds `which` can report, in the order it disambiguates them. */
export type WhichKind = 'node' | 'attachment' | 'component' | 'system' | 'enum';

export interface WhichResult {
  ok: boolean;
  text: string;
}

/**
 * Look `name` up in the API model and render it. `kind` narrows the search when
 * one name is registered as more than one kind (the rapier/collision `<Physics>`
 * pair, a project component sharing a node tag's name); omit it and an
 * unambiguous name resolves on its own.
 */
export function whichText(api: SceneApi, name: string, kind?: WhichKind): WhichResult {
  const matches = findAll(api, name, kind);
  if (matches.length === 0) return { ok: false, text: notFound(api, name, kind) };
  // An ambiguous name renders every match: they are genuinely different tags,
  // and picking one silently would teach the wrong surface.
  return { ok: true, text: matches.map((m) => render(api, m)).join('\n') };
}

/** Every entity registered under `name`, optionally narrowed to one kind. */
type Match =
  | { kind: 'node'; entry: NodeApi }
  | { kind: 'attachment'; entry: AttachmentApi }
  | { kind: 'component'; entry: ComponentApi }
  | { kind: 'system'; entry: { name: string; processes?: string; source?: SourceRef } }
  | { kind: 'enum'; entry: EnumUse };

function findAll(api: SceneApi, name: string, kind?: WhichKind): Match[] {
  const out: Match[] = [];
  if (!kind || kind === 'node') {
    for (const n of api.nodes) if (n.tag === name) out.push({ kind: 'node', entry: n });
  }
  if (!kind || kind === 'attachment') {
    for (const a of api.attachments) if (a.tag === name) out.push({ kind: 'attachment', entry: a });
  }
  if (!kind || kind === 'component') {
    for (const c of api.components) if (c.name === name) out.push({ kind: 'component', entry: c });
  }
  if (!kind || kind === 'system') {
    for (const s of api.systems) if (s.name === name) out.push({ kind: 'system', entry: s });
  }
  if (!kind || kind === 'enum') {
    const found = enumUses(api).get(name);
    if (found) out.push({ kind: 'enum', entry: found });
  }
  return out;
}

/** One enum: its members, and every attribute/property written with it. */
interface EnumUse {
  name: string;
  values: string[];
  usedBy: string[];
}

/**
 * The enums reachable from this project's vocabulary, gathered from the tags that
 * use them rather than from a separate registry dump — so `which` stays a pure
 * view over the API model, and an enum nothing references is not offered as if it
 * were part of the language here.
 *
 * This exists because the type column names an enum ("CameraFit") without saying
 * what may be written in it. Naming a type an author then cannot look up is worse
 * than not naming it: it reads as a dead end.
 */
function enumUses(api: SceneApi): Map<string, EnumUse> {
  const out = new Map<string, EnumUse>();
  const add = (name: string, values: string[], user: string): void => {
    const found = out.get(name) ?? { name, values, usedBy: [] };
    if (!found.usedBy.includes(user)) found.usedBy.push(user);
    out.set(name, found);
  };
  for (const n of api.nodes) for (const a of n.attributes) if (a.values) add(a.type, a.values, `<${n.tag}> ${a.name}`);
  for (const t of api.attachments) for (const a of t.attributes) if (a.values) add(a.type, a.values, `<${t.tag}> ${a.name}`);
  for (const c of api.components) {
    for (const p of c.properties) if (p.kind === 'enum') add(p.enum, p.values, `<${c.name}> ${p.name}`);
  }
  return out;
}

/** Every registered name, for the did-you-mean on a miss. */
function allNames(api: SceneApi, kind?: WhichKind): string[] {
  const names: string[] = [];
  if (!kind || kind === 'node') names.push(...api.nodes.map((n) => n.tag));
  if (!kind || kind === 'attachment') names.push(...api.attachments.map((a) => a.tag));
  if (!kind || kind === 'component') names.push(...api.components.map((c) => c.name));
  if (!kind || kind === 'system') names.push(...api.systems.map((s) => s.name));
  if (!kind || kind === 'enum') names.push(...enumUses(api).keys());
  return names;
}

function notFound(api: SceneApi, name: string, kind?: WhichKind): string {
  const suggestion = nearestName(name, allNames(api, kind));
  const what = kind ? `${kind} "${name}"` : `"${name}"`;
  return suggestion
    ? `No ${what} is registered — did you mean "${suggestion}"?`
    : `No ${what} is registered. Run \`scenoco which\` with no name to list everything available here.`;
}

// ── rendering ────────────────────────────────────────────────────────────────

function render(api: SceneApi, m: Match): string {
  switch (m.kind) {
    case 'node':
      return renderNode(m.entry);
    case 'attachment':
      return renderAttachment(m.entry);
    case 'enum':
      return renderEnum(m.entry);
    case 'component':
      return renderComponent(api, m.entry);
    case 'system':
      return renderSystem(m.entry);
  }
}

function header(name: string, kind: string, source?: SourceRef): string {
  const where = source ? `  ${source.file ?? source.package}` : '';
  return `${name} — ${kind}${where}`;
}

function renderNode(n: NodeApi): string {
  const lines = [header(`<${n.tag}>`, 'node tag', n.source)];
  if (n.description) lines.push(`  ${n.description}`);
  if (n.produces) lines.push(`  Builds a THREE.${n.produces}`);
  lines.push(...attrSection('Attributes', n.attributes));
  if (n.hasTransform) {
    lines.push('  Transform      position, eulerAngles (degrees), scale, visible — on every node');
  }
  const required = n.accepts.filter((g) => g.required);
  const optional = n.accepts.filter((g) => !g.required);
  if (required.length > 0) {
    lines.push('  Requires');
    for (const g of required) lines.push(`    <${g.tags.join('> | <')}>  (a ${g.group}, inside <Attachments>)`);
  }
  if (optional.length > 0) {
    lines.push('  Accepts');
    for (const g of optional) lines.push(`    ${g.group.padEnd(12)} ${g.tags.map((t) => `<${t}>`).join(', ')}`);
  }
  const holds: string[] = [];
  if (n.children.object3d) holds.push('child nodes');
  if (n.children.components) holds.push('<Components>');
  if (holds.length > 0) lines.push(`  Holds          ${holds.join(', ')}`);
  if (n.usage) {
    lines.push('  Usage');
    for (const line of n.usage) lines.push(line === '' ? '' : `    ${line}`);
  }
  return lines.join('\n');
}

function renderAttachment(a: AttachmentApi): string {
  const lines = [header(`<${a.tag}>`, `attachment (${a.group})`, a.source)];
  if (a.description) lines.push(`  ${a.description}`);
  lines.push(...attrSection('Attributes', a.attributes));
  lines.push(`  Attaches to    ${a.targets.length > 0 ? a.targets.map((t) => `<${t}>`).join(', ') : '(nothing registered)'}`);
  lines.push(`  Cardinality    ${a.required ? 'required' : 'optional'}, ${a.unique ? 'at most one per node' : 'repeatable'} — inside <Attachments>`);
  // Only for the two groups a component actually mutates at runtime. Every
  // attachment is pooled, but nobody writes code that recolours a <Background>
  // per instance, and a line on all sixty tags would be noise where it isn't the
  // answer to anything. (`a.unique` just above is cardinality — a different axis
  // that happens to share the word; it is never rendered as "unique".)
  if (a.group === 'material' || a.group === 'geometry') {
    lines.push(`  Sharing        identical ones are pooled into a single instance — mutating it in code affects every node`);
    lines.push(`                 that authored it. Write unique="true" here for a placement of its own, or call`);
    lines.push(`                 node.uniqueMaterial() before the first mutation.`);
  }
  return lines.join('\n');
}

function renderComponent(api: SceneApi, c: ComponentApi): string {
  const lines = [header(`<${c.name}>`, 'component', c.source)];
  if (c.description) lines.push(`  ${c.description}`);
  if (c.properties.length === 0) lines.push('  Properties     (none)');
  else {
    lines.push('  Properties');
    // One column layout across scalar, enum and reference rows: the type column
    // is as wide as the widest type in *this* component, so the table lines up.
    const width = Math.max(...c.properties.map((p) => p.name.length));
    const typeWidth = Math.max(...c.properties.map((p) => propertyType(p).length));
    for (const p of c.properties) lines.push(`    ${propertyLine(p, width, typeWidth)}`);
  }
  // Who points at this component, and what runs it — the relations an author
  // needs to wire it up, already computed in the model.
  const referencedBy = api.relations.filter(
    (r) => r.kind === 'references' && r.to.entity === 'component' && r.to.name === c.name,
  );
  if (referencedBy.length > 0) {
    lines.push(`  Referenced by  ${referencedBy.map((r) => `${r.from.name}.${'via' in r ? r.via : ''}`).join(', ')}`);
  }
  const systems = api.systems.filter((s) => s.processes === c.name);
  if (systems.length > 0) lines.push(`  Processed by   ${systems.map((s) => s.name).join(', ')} (runs automatically)`);
  lines.push('  Placement      inside <Components> on a node');
  return lines.join('\n');
}

function renderEnum(e: EnumUse): string {
  return [
    `${e.name} — enum`,
    `  Values         ${e.values.join(' | ')}`,
    `  Written on     ${e.usedBy.join(', ')}`,
  ].join('\n');
}

function renderSystem(s: { name: string; processes?: string; source?: SourceRef }): string {
  const lines = [header(s.name, 'system', s.source)];
  lines.push(
    s.processes
      ? `  Runs automatically wherever a <${s.processes}> is in the scene`
      : '  Runs automatically while its query type is in the scene',
  );
  return lines.join('\n');
}

/** Attributes/properties share one aligned layout: name, type, default, description. */
function attrSection(title: string, attrs: Attribute[]): string[] {
  if (attrs.length === 0) return [`  ${title.padEnd(14)} (none)`];
  const width = Math.max(...attrs.map((a) => a.name.length));
  return [`  ${title}`, ...attrs.map((a) => `    ${attrLine(a, width)}`)];
}

function attrLine(a: Attribute, width: number): string {
  const type = a.array ? `[${a.type}]` : a.type;
  const meta = a.required ? 'required' : a.default !== undefined ? `= ${formatDefault(a.default)}` : '';
  // An enum's members are the useful "description" — they are what may be
  // written, and the type column only names the enum. Same rule as a component's
  // enum properties, so the two read alike.
  const tail = a.values ? a.values.join(' | ') : (a.description ?? '');
  return `${a.name.padEnd(width)}  ${type.padEnd(8)} ${meta.padEnd(12)} ${tail}`.trimEnd();
}

/** The type column for a property, in the form an author writes/reads it. */
function propertyType(p: PropertyApi): string {
  const base =
    p.kind === 'reference'
      ? p.references.entity === 'component'
        ? `#ref → <${p.references.name}>`
        : p.references.entity === 'node'
          ? '#ref → node'
          : 'prefab file'
      : p.kind === 'enum'
        ? p.enum
        : p.type;
  return p.array ? `[${base}]` : base;
}

function propertyLine(p: PropertyApi, width: number, typeWidth: number): string {
  const type = propertyType(p).padEnd(typeWidth);
  const hasDefault = p.kind !== 'reference' && p.default !== undefined;
  const meta = p.required ? 'required' : hasDefault ? `= ${formatDefault(p.default)}` : '';
  // An enum's members are the useful "description" — they are what may be written.
  const tail = p.kind === 'enum' ? p.values.join(' | ') : (p.description ?? '');
  return `${p.name.padEnd(width)}  ${type} ${meta.padEnd(12)} ${tail}`.trimEnd();
}

function formatDefault(d: Attribute['default']): string {
  if (Array.isArray(d)) return `"${d.map((x) => (Array.isArray(x) ? x.join(' ') : String(x))).join(' ')}"`;
  return typeof d === 'string' ? `"${d}"` : String(d);
}

/**
 * The whole vocabulary, one line per entity — what `scenoco which` prints with
 * no name. The list an author scans before asking about a specific tag.
 */
export function whichIndexText(api: SceneApi): string {
  const section = (title: string, rows: { name: string; description?: string }[]): string[] => {
    if (rows.length === 0) return [];
    const width = Math.max(...rows.map((r) => r.name.length));
    return ['', title, ...rows.map((r) => `  ${r.name.padEnd(width)}  ${r.description ?? ''}`.trimEnd())];
  };
  return [
    'The scene vocabulary registered here. `scenoco which <Name>` details any one of them.',
    ...section(
      'Node tags (write as elements in the scene tree)',
      api.nodes.map((n) => ({ name: `<${n.tag}>`, ...(n.description ? { description: n.description } : {}) })),
    ),
    ...section(
      'Attachments (inside <Attachments> on a node)',
      api.attachments.map((a) => ({ name: `<${a.tag}>`, description: `${a.group} — ${a.description ?? ''}`.trim() })),
    ),
    ...section(
      'Components (inside <Components> on a node)',
      api.components.map((c) => ({ name: `<${c.name}>`, ...(c.description ? { description: c.description } : {}) })),
    ),
    ...section(
      'Systems (run automatically; never written in XML)',
      api.systems.map((s) => ({ name: s.name, ...(s.processes ? { description: `processes <${s.processes}>` } : {}) })),
    ),
    '',
  ].join('\n');
}
