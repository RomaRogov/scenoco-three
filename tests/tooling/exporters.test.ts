import { describe, expect, it } from 'vitest';
import { ValueType } from '@scenoco-three/core';
import { generateApi, generateApiJson, generateMaterialXsd, generatePrefabXsd, generateXsd, parseScene } from '@scenoco-three/compiler';

describe('XSD exporter', () => {
  const xsd = generateXsd();

  it('is well-formed XML declaring built-in elements and pattern-restricted math types', () => {
    expect(parseScene(xsd).ok).toBe(true);
    for (const tag of ['Scene', 'Mesh', 'PointLight', 'BoxGeometry', 'MeshStandardMaterial', 'Rotator', 'Follow', 'PrefabInstance']) {
      expect(xsd).toContain(`<xs:element name="${tag}">`);
    }
    expect(xsd).toContain('<xs:simpleType name="vec3">');
    expect(xsd).toContain('<xs:simpleType name="color">');
    expect(xsd).toContain('<xs:attributeGroup name="transform">'); // shared transform attrs
    expect(xsd).toContain('<xs:documentation>Local position, e.g. y: 1.5; z: -3 (omitted axes are 0)</xs:documentation>'); // descriptions → IDE hover
  });

  it('declares no duplicate attribute within any element (valid XSD 1.0)', () => {
    // Guards the bug class where an attachment's own `src` collided with the
    // auto-added resource `src` — a "Duplicate attribute use" schema-compile error.
    for (const block of xsd.split('<xs:element name=').slice(1)) {
      const element = block.split('</xs:element>')[0]!;
      const names = [...element.matchAll(/<xs:attribute name="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(names).size, `duplicate attribute in element: ${block.slice(0, 40)}`).toBe(names.length);
    }
  });
});

describe('material XSD exporter', () => {
  // A .material.xml document is a single material element — the schema offers
  // only materials as roots, not scene/geometry noise.
  it('declares material elements and nothing else', () => {
    const xsd = generateMaterialXsd();
    expect(parseScene(xsd).ok).toBe(true);
    expect(xsd).toContain('<xs:element name="MeshStandardMaterial">');
    expect(xsd).toContain('<xs:element name="ShaderMaterial">');
    expect(xsd).not.toContain('<xs:element name="Mesh">');
    expect(xsd).not.toContain('<xs:element name="BoxGeometry">');
  });
});

describe('prefab XSD exporter', () => {
  // A .prefab.xml document roots at <Prefab> but reuses the whole node library.
  it('roots at <Prefab>, shares the node library, and omits <Scene>', () => {
    const xsd = generatePrefabXsd();
    expect(parseScene(xsd).ok).toBe(true);
    expect(xsd).toContain('<xs:element name="Prefab">');
    expect(xsd).toContain('<xs:element name="Mesh">');
    expect(xsd).toContain('<xs:element name="MeshStandardMaterial">');
    expect(xsd).not.toContain('<xs:element name="Scene">');
  });
});

describe('API exporter', () => {
  const api = generateApi();

  it('is valid, pretty-printed, versioned JSON with no prose/agent guidance', () => {
    const json = generateApiJson();
    expect(json).toContain('\n'); // pretty-printed
    expect((JSON.parse(json) as typeof api).schemaVersion).toBeGreaterThanOrEqual(1);
    expect(json).not.toMatch(/```xml/);
    expect(json).not.toMatch(/Always read|load into context|agent/i);
  });

  it('describes nodes, node↔attachment cardinality, and typed component properties', () => {
    const mesh = api.nodes.find((n) => n.tag === 'Mesh')!;
    expect(mesh.kind).toBe('object3d');
    expect(mesh.hasTransform).toBe(true);
    const geometry = mesh.accepts.find((g) => g.group === 'geometry')!;
    expect(geometry.required).toBe(true);
    expect(geometry.unique).toBe(true);
    expect(geometry.tags).toContain('BoxGeometry');

    expect(api.components.find((c) => c.name === 'Rotator')!.properties.find((p) => p.name === 'speed')).toMatchObject({
      kind: 'scalar',
      type: ValueType.Float,
      default: 1,
    });
    expect(api.components.find((c) => c.name === 'Follow')!.properties.find((p) => p.name === 'source')).toMatchObject({
      kind: 'reference',
      references: { entity: 'component', name: 'Oscillator' },
    });
    // …and the same reference is flattened into a graph-ready edge list.
    expect(api.relations).toContainEqual({
      kind: 'references',
      from: { entity: 'component', name: 'Follow' },
      via: 'source',
      to: { entity: 'component', name: 'Oscillator' },
    });
  });

  it('links every tag to its declaring source: repo-relative for the project, specifier for a package', () => {
    // Built-ins resolve from the node manifest, so they are located even with no
    // scan; a project component has no origin to report until one is supplied.
    expect(api.nodes.find((n) => n.tag === 'Mesh')!.source).toMatchObject({ symbol: 'Mesh' });
    expect(api.components.find((c) => c.name === 'Rotator')).not.toHaveProperty('source');

    const linked = generateApi({
      cwd: '/repo',
      sources: {
        byName: new Map([['Rotator', '/repo/assets/components/Rotator.ts']]),
        byTag: new Map([['MyWidget', '@acme/widgets']]),
      },
    });
    // A project file becomes a repo-relative path; a package keeps its specifier.
    expect(linked.components.find((c) => c.name === 'Rotator')!.source).toEqual({
      file: 'assets/components/Rotator.ts',
      symbol: 'Rotator',
    });
    // Built-ins are never in a scan, but stay locatable via the node manifest.
    expect(linked.nodes.find((n) => n.tag === 'Mesh')!.source).toMatchObject({
      package: expect.stringContaining('@scenoco-three/core/nodes'),
      symbol: 'Mesh',
    });
  });
});
