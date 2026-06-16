import { describe, expect, it } from 'vitest';
import { Component, component, property } from '@scenoco-three/core';
import { generateDocs, generateXsd, parseScene } from '@scenoco-three/compiler';

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
    expect(xsd).toMatch(/<xs:attribute name="source" type="ref"\/>/);
  });

  it('shares transform attributes through an attribute group', () => {
    expect(xsd).toContain('<xs:attributeGroup name="transform">');
    expect(xsd).toContain('<xs:attribute name="position" type="vec3"/>');
  });

  it('declares the expanded Object3D set, settings, and PrefabInstance', () => {
    for (const tag of ['SpotLight', 'OrthographicCamera', 'Points', 'Sprite', 'Fog', 'Background']) {
      expect(xsd).toContain(`<xs:element name="${tag}">`);
    }
    expect(xsd).toContain('<xs:element name="PrefabInstance">');
  });
});

describe('docs exporter', () => {
  const docs = generateDocs();

  it('covers value formats, nodes, attachments, and components', () => {
    for (const heading of [
      '## Value formats',
      '## Nodes',
      '## Geometry',
      '## Material',
      '## Components',
    ]) {
      expect(docs).toContain(heading);
    }
  });

  it('documents component properties with defaults and references', () => {
    expect(docs).toContain('### `<Rotator>`');
    expect(docs).toContain('`speed` (float) = `1`');
    expect(docs).toContain('reference → `<Oscillator>`');
  });

  it('states the core authoring rules an agent needs', () => {
    expect(docs).toContain('degrees');
    expect(docs).toContain('"#id"');
  });

  it('documents scene-setting attachments and the PrefabInstance tag', () => {
    expect(docs).toContain('## Fog'); // group heading "## Fog (attaches to <Scene>)"
    expect(docs).toContain('### `<Fog>`');
    expect(docs).toContain('<PrefabInstance>');
  });

  it('compact mode is smaller but keeps every tag, attribute, type and default', () => {
    const compact = generateDocs({ compact: true });
    // Substantially shorter — fits a small-context (e.g. 2048-token) window.
    expect(compact.length).toBeLessThan(docs.length * 0.7);
    // Still names every section and the data a model needs to author scenes.
    for (const heading of ['## Nodes', '## Geometry', '## Material', '## Components']) {
      expect(compact).toContain(heading);
    }
    expect(compact).toContain('### `<Rotator>`');
    expect(compact).toContain('`speed` (float) = `1`');
    expect(compact).toContain('reference → `<Oscillator>`');
    // Prose descriptions and the prefab section are what gets dropped.
    expect(compact).not.toContain('## Prefabs');
  });
});

describe('user components are first-class in both exporters', () => {
  @component({ name: 'ExporterProbe', description: 'a user component for testing' })
  class ExporterProbe extends Component {
    @property({ type: 'float', default: 7, description: 'a knob' })
    knob = 7;
  }
  void ExporterProbe;

  it('appears in the XSD with its attribute', () => {
    const xsd = generateXsd();
    expect(xsd).toContain('<xs:element name="ExporterProbe">');
    expect(xsd).toMatch(/<xs:attribute name="knob" type="xs:float"\/>/);
  });

  it('appears in the docs with its description and default', () => {
    const docs = generateDocs();
    expect(docs).toContain('### `<ExporterProbe>` — a user component for testing');
    expect(docs).toContain('`knob` (float) = `7`');
  });
});
