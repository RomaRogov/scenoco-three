import { describe, expect, it } from 'vitest';
import { Component, component, property } from '@scenoco-three/core';
import { generateApi, generateApiJson, generateXsd, parseScene } from '@scenoco-three/compiler';

describe('XSD exporter', () => {
  const xsd = generateXsd();

  it('produces well-formed XML', () => {
    const parsed = parseScene(xsd);
    expect(parsed.ok).toBe(true);
  });

  it('declares every built-in node, geometry, material, and component element', () => {
    for (const tag of [
      'Scene',
      'Mesh',
      'PointLight',
      'BoxGeometry',
      'MeshStandardMaterial',
      'Rotator',
      'Follow',
    ]) {
      expect(xsd).toContain(`<xs:element name="${tag}">`);
    }
  });

  it('emits pattern-restricted simple types for math values', () => {
    expect(xsd).toContain('<xs:simpleType name="vec3">');
    expect(xsd).toContain('<xs:simpleType name="color">');
    expect(xsd).toContain('<xs:simpleType name="ref">');
  });

  it('types a component reference attribute as a #id ref', () => {
    // <Follow source="..."/> → the source attribute uses the "ref" simple type.
    // It carries a description, so it's the annotated (non-self-closing) form.
    expect(xsd).toContain('<xs:attribute name="source" type="ref">');
    expect(xsd).toContain('<xs:documentation>The Oscillator this follows</xs:documentation>');
  });

  it('shares transform attributes through an attribute group', () => {
    expect(xsd).toContain('<xs:attributeGroup name="transform">');
    expect(xsd).toContain('<xs:attribute name="position" type="vec3">');
  });

  it('surfaces mandatory descriptions as xs:documentation (IDE hover)', () => {
    expect(xsd).toContain('<xs:annotation>');
    expect(xsd).toContain('<xs:documentation>Local position x y z</xs:documentation>');
  });

  it('declares no duplicate attribute within any element (valid XSD 1.0)', () => {
    // Guards the class of bug where an attachment's own `src` collided with the
    // auto-added resource `src` — a "Duplicate attribute use" schema-compile error.
    for (const block of xsd.split('<xs:element name=').slice(1)) {
      const element = block.split('</xs:element>')[0]!;
      const names = [...element.matchAll(/<xs:attribute name="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(names).size, `duplicate attribute in element: ${block.slice(0, 40)}`).toBe(names.length);
    }
  });

  it('declares the expanded Object3D set, settings, and PrefabInstance', () => {
    for (const tag of ['SpotLight', 'OrthographicCamera', 'Points', 'Sprite', 'Fog', 'Background']) {
      expect(xsd).toContain(`<xs:element name="${tag}">`);
    }
    expect(xsd).toContain('<xs:element name="PrefabInstance">');
  });
});

describe('API exporter', () => {
  const api = generateApi();

  it('is valid, pretty-printed JSON carrying a schema version', () => {
    const json = generateApiJson();
    expect(json).toContain('\n'); // pretty-printed
    const parsed = JSON.parse(json) as typeof api;
    expect(parsed.schemaVersion).toBe(api.schemaVersion);
    expect(parsed.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it('lists nodes with their kind, transform flag, and typed attributes', () => {
    const mesh = api.nodes.find((n) => n.tag === 'Mesh');
    expect(mesh?.kind).toBe('object3d');
    expect(mesh?.hasTransform).toBe(true);
    const scene = api.nodes.find((n) => n.tag === 'Scene');
    expect(scene?.kind).toBe('scene');
    // value-type formats are emitted as raw structured data
    expect(api.valueTypes.vec3.example).toBeDefined();
    expect(api.transform.map((a) => a.name)).toContain('position');
  });

  it('describes a node↔attachment compatibility with cardinality', () => {
    const mesh = api.nodes.find((n) => n.tag === 'Mesh')!;
    const geometry = mesh.accepts.find((g) => g.group === 'geometry');
    expect(geometry?.required).toBe(true);
    expect(geometry?.unique).toBe(true);
    expect(geometry?.tags).toContain('BoxGeometry');

    const box = api.attachments.find((a) => a.tag === 'BoxGeometry')!;
    expect(box.group).toBe('geometry');
    expect(box.targets).toContain('Mesh');
    expect(box.attributes.map((a) => a.type)).toContain('float');
  });

  it('types component properties as scalars or typed references', () => {
    const rotator = api.components.find((c) => c.name === 'Rotator')!;
    const speed = rotator.properties.find((p) => p.name === 'speed')!;
    expect(speed.kind).toBe('scalar');
    expect(speed).toMatchObject({ kind: 'scalar', type: 'float', default: 1 });

    const follow = api.components.find((c) => c.name === 'Follow')!;
    const source = follow.properties.find((p) => p.name === 'source')!;
    expect(source).toMatchObject({ kind: 'reference', references: { entity: 'component', name: 'Oscillator' } });

    const lookAt = api.components.find((c) => c.name === 'LookAt')!;
    const target = lookAt.properties.find((p) => p.name === 'target')!;
    expect(target).toMatchObject({ kind: 'reference', references: { entity: 'node' } });
  });

  it('flattens component references into a graph-ready edge list', () => {
    expect(api.relations).toContainEqual({
      kind: 'references',
      from: { entity: 'component', name: 'Follow' },
      via: 'source',
      to: { entity: 'component', name: 'Oscillator' },
    });
    // Node↔attachment compatibility is not exploded into edges — it lives on entities.
    expect(api.relations.some((r) => r.kind !== 'references' && r.kind !== 'processes')).toBe(false);
  });

  it('emits no prose, examples, or agent guidance', () => {
    const json = generateApiJson();
    expect(json).not.toMatch(/```xml/);
    expect(json).not.toMatch(/Always read|load into context|agent/i);
  });
});

describe('user components are first-class in both exporters', () => {
  @component({ name: 'ExporterProbe', description: 'a user component for testing' })
  class ExporterProbe extends Component {
    @property({ type: 'float', default: 7, description: 'a knob' })
    knob = 7;
  }
  void ExporterProbe;

  it('appears in the XSD with its attribute and documented description', () => {
    const xsd = generateXsd();
    expect(xsd).toContain('<xs:element name="ExporterProbe">');
    expect(xsd).toContain('<xs:attribute name="knob" type="xs:float">');
    expect(xsd).toContain('<xs:documentation>a knob</xs:documentation>');
  });

  it('appears in the API with its description and typed default', () => {
    const probe = generateApi().components.find((c) => c.name === 'ExporterProbe');
    expect(probe?.description).toBe('a user component for testing');
    expect(probe?.properties).toContainEqual({ kind: 'scalar', name: 'knob', type: 'float', default: 7, required: false, description: 'a knob' });
  });
});

describe('API exporter — array properties', () => {
  it('marks scalar array props with array: true and correct element type', () => {
    const api = generateApi();
    const probe = api.components.find((c) => c.name === 'ArrayProbe')!;
    const points = probe.properties.find((p) => p.name === 'points')!;
    expect(points).toMatchObject({ kind: 'scalar', type: 'float', array: true });

    const waypoints = probe.properties.find((p) => p.name === 'waypoints')!;
    expect(waypoints).toMatchObject({ kind: 'scalar', type: 'vec3', array: true });
  });

  it('marks reference array props with array: true', () => {
    const api = generateApi();
    const probe = api.components.find((c) => c.name === 'ArrayProbe')!;

    const targets = probe.properties.find((p) => p.name === 'targets')!;
    expect(targets).toMatchObject({ kind: 'reference', references: { entity: 'node' }, array: true });

    const oscillators = probe.properties.find((p) => p.name === 'oscillators')!;
    expect(oscillators).toMatchObject({ kind: 'reference', references: { entity: 'component', name: 'Oscillator' }, array: true });
  });

  it('emits array: true on reference edges in relations[]', () => {
    const api = generateApi();
    const edge = api.relations.find(
      (r) => r.kind === 'references' && r.from.name === 'ArrayProbe' && r.via === 'targets',
    );
    expect(edge).toBeDefined();
    expect(edge).toMatchObject({ array: true });
  });

  it('types array attributes as xs:string in the XSD', () => {
    const xsd = generateXsd();
    // ArrayProbe's "points" is a float array — should be xs:string (bracketed list).
    // It has a description, so it's the annotated (non-self-closing) form.
    expect(xsd).toContain('<xs:attribute name="points" type="xs:string">');
  });
});
