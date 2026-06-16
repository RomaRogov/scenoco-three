import {
  Registry,
  allNodeDefs,
  allAttachmentDefs,
  TRANSFORM_ATTRS,
  type PropertyMeta,
  type NodeAttr,
  type NodeDef,
  type AttachmentDef,
} from '@scenoco-three/core/internal';
import { codecs, type ScalarType } from '../dsl/types.js';

export interface DocsOptions {
  /**
   * Compact mode for small-context local models: drops prose descriptions,
   * the prefab section, and the value-format table in favour of one-liners.
   * Roughly halves the token count while keeping every tag, attribute, type,
   * default and a worked example. Same registries, so it never drifts.
   */
  compact?: boolean;
}

/**
 * Generates `component-api.md` — the compact reference an agent loads into
 * context (CLAUDE.md / .cursorrules / AGENTS.md). Built from the same registries
 * as the runtime and the XSD, so it never drifts. Kept deliberately terse:
 * tags, attributes, types, defaults, one example each.
 */
export function generateDocs(options: DocsOptions = {}): string {
  const compact = options.compact ?? false;
  const defs = allNodeDefs();
  const byKind = (k: NodeDef['kind']) => defs.filter((d) => d.kind === k);
  const md: string[] = [];

  md.push('# SceNoCo Scene API');
  md.push('');
  md.push('Scenes are XML files. The root element is `<Scene>`. Rules:');
  md.push('');
  md.push('- An object is a `<Mesh>` with exactly one geometry child and an optional material child.');
  md.push('- Behaviour goes in a single `<Components>` block per node; each child is a component.');
  md.push('- `id` (optional, unique) labels any node or component; reference one elsewhere as `"#id"`.');
  md.push('- Angles are **degrees**; positions/vectors are space-separated; colors are hex or CSS names.');
  md.push('');

  md.push('## Value formats');
  md.push('');
  if (compact) {
    const types = (['float', 'int', 'bool', 'string', 'vec2', 'vec3', 'euler', 'color'] as const)
      .map((t) => `${t} \`${codecs[t].example}\``)
      .join(' · ');
    md.push(`${types} · reference \`"#someId"\``);
  } else {
    md.push('| Type | Example |');
    md.push('| --- | --- |');
    for (const t of ['float', 'int', 'bool', 'string', 'vec2', 'vec3', 'euler', 'color'] as const) {
      md.push(`| ${t} | \`${codecs[t].example}\` |`);
    }
    md.push('| reference | `"#someId"` |');
  }
  md.push('');

  md.push('## Nodes');
  md.push('');
  md.push('All spatial nodes also accept: ' + transformLine() + '.');
  md.push('');
  for (const def of [...byKind('scene'), ...byKind('object3d')]) {
    md.push(`### \`<${def.tag}>\`${def.description && !compact ? ` — ${def.description}` : ''}`);
    const attrs = nodeAttrLines(def.attrs, compact);
    if (attrs.length > 0) md.push(...attrs);
    md.push('');
  }

  // Attachments — leaves that configure a node (geometry/material on a mesh,
  // fog/background on the scene), grouped by their cardinality group.
  for (const [group, group_defs] of attachmentsByGroup()) {
    md.push(`## ${capitalize(group)} (attaches to ${targetSummary(group_defs)})`);
    md.push('');
    if (!compact && group === 'material') {
      md.push('Any attachment may set `src="file.material.xml"` to inherit attributes from a');
      md.push('resource file; inline attributes override it, and identical attachments are shared.');
      md.push('');
    }
    for (const def of group_defs) {
      md.push(`### \`<${def.tag}>\`${def.description && !compact ? ` — ${def.description}` : ''}`);
      md.push(...nodeAttrLines(def.attrs, compact));
      md.push('');
    }
  }

  md.push('## Components (inside `<Components>`)');
  md.push('');
  for (const name of Registry.componentNames()) {
    const meta = Registry.getComponent(name)!.meta;
    md.push(`### \`<${name}>\`${meta.description && !compact ? ` — ${meta.description}` : ''}`);
    for (const [attr, prop] of meta.properties) md.push(`- \`${attr}\` ${propertyLine(prop, compact)}`);
    md.push('');
  }

  if (!compact) {
    md.push('## Prefabs');
    md.push('');
    md.push('A `.prefab.xml` file has a `<Prefab>` root wrapping exactly one node; it must be');
    md.push('self-contained (every `#ref` resolves inside the file). Place one in a scene with a');
    md.push('`<PrefabInstance>` (a prefab file may also contain `<PrefabInstance>` children, so');
    md.push('prefabs nest):');
    md.push('');
    md.push('### `<PrefabInstance>` — instance of a prefab file');
    md.push('- `src` (string) *(required)* — the `.prefab.xml` file to expand');
    md.push('- `id` (string) *(required)* — instance id; internals are addressed as `"#<id>/<inner>"`');
    md.push('- plus the transform attributes (override the prefab root): ' + transformLine());
    md.push('');
    md.push('Children: `<Override target="#<inner-id>" …/>` patches an internal node/component;');
    md.push('a `<Components>` block adds components to the instance root. Example:');
    md.push('');
    md.push('```xml');
    md.push(prefabExample());
    md.push('```');
    md.push('');
  }

  md.push('## Example');
  md.push('');
  md.push('```xml');
  md.push(example());
  md.push('```');
  md.push('');
  return md.join('\n');
}

/** Group attachment defs by their cardinality group (geometry/material/fog/…). */
function attachmentsByGroup(): Map<string, AttachmentDef[]> {
  const groups = new Map<string, AttachmentDef[]>();
  for (const d of allAttachmentDefs()) {
    (groups.get(d.group) ?? groups.set(d.group, []).get(d.group)!).push(d);
  }
  return groups;
}

/** A short description of the node(s) a group of attachments attaches to. */
function targetSummary(defs: AttachmentDef[]): string {
  const t = defs[0]!.target;
  if (typeof t === 'string') return `\`<${t}>\``;
  const classes = Array.isArray(t) ? t : [t];
  return classes.map((c) => `\`<${c.name}>\``).join('/');
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function transformLine(): string {
  return Object.entries(TRANSFORM_ATTRS)
    .map(([name, meta]) => `\`${name}\` (${typeLabel(meta.type)})`)
    .join(', ');
}

function nodeAttrLines(attrs: Record<string, NodeAttr>, compact = false): string[] {
  return Object.entries(attrs).map(([name, meta]) => {
    const dflt = meta.default !== undefined ? ` = \`${codecs[meta.type].serialize(meta.default)}\`` : '';
    const desc = meta.description && !compact ? ` — ${meta.description}` : '';
    const req = meta.required ? ' *(required)*' : '';
    return `- \`${name}\` (${typeLabel(meta.type)})${dflt}${req}${desc}`;
  });
}

function propertyLine(meta: PropertyMeta, compact = false): string {
  const desc = meta.description && !compact ? ` — ${meta.description}` : '';
  const req = meta.required ? ' *(required)*' : '';
  if (typeof meta.type !== 'string') return `(reference → \`<${meta.type.name}>\`, as \`"#id"\`)${req}${desc}`;
  if (meta.type === 'node') return `(reference → node, as \`"#id"\`)${req}${desc}`;
  if (meta.type === 'prefab') return `(prefab file → \`"name.prefab.xml"\`, spawnable at runtime)${req}${desc}`;
  const dflt = meta.default !== undefined ? ` = \`${meta.default}\`` : '';
  return `(${typeLabel(meta.type)})${dflt}${req}${desc}`;
}

const typeLabel = (type: ScalarType) => (type === 'euler' ? 'degrees' : type);

function example(): string {
  return [
    '<Scene>',
    '  <AmbientLight intensity="0.3" />',
    '  <DirectionalLight intensity="2" position="3 5 2" />',
    '',
    '  <Mesh id="Hero" position="0 1 0" rotation="0 45 0">',
    '    <BoxGeometry width="1.5" />',
    '    <MeshStandardMaterial color="#4f8ef7" metalness="0.6" />',
    '    <Components>',
    '      <Rotator speed="2" />',
    '      <Oscillator id="bob" amplitude="0.5" />',
    '    </Components>',
    '  </Mesh>',
    '',
    '  <Mesh id="Chaser" position="3 1 0">',
    '    <SphereGeometry radius="0.3" />',
    '    <Components>',
    '      <Follow source="#bob" scale="2" />',
    '      <LookAt target="#Hero" />',
    '    </Components>',
    '  </Mesh>',
    '</Scene>',
  ].join('\n');
}

function prefabExample(): string {
  return [
    '<!-- turbine.prefab.xml -->',
    '<Prefab>',
    '  <Mesh id="body" position="0 1 0">',
    '    <CylinderGeometry height="2" />',
    '    <Components><Oscillator id="osc" amplitude="0.5" /></Components>',
    '  </Mesh>',
    '</Prefab>',
    '',
    '<!-- in a scene: two instances, one overridden -->',
    '<PrefabInstance src="turbine.prefab.xml" id="t1" position="0 0 0" />',
    '<PrefabInstance src="turbine.prefab.xml" id="t2" position="5 0 0">',
    '  <Override target="#osc" amplitude="1.5" />',
    '</PrefabInstance>',
    '<!-- reach an instance internal from elsewhere: target="#t2/osc" -->',
  ].join('\n');
}
