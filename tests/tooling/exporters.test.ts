import { describe, expect, it } from 'vitest';
import { ValueType } from '@scenoco-three/core';
import { generateApi, generateApiJson, generateMaterialXsd, generatePrefabXsd, generateXsd, parseScene, whichIndexText, whichText } from '@scenoco-three/compiler';
import '../fixtures/components/RequiredProbe.js';

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

describe('`scenoco which` — symbol lookup (a view over the API model)', () => {
  const api = generateApi();

  it('renders a component with its properties, defaults, required flags and references', () => {
    const text = whichText(api, 'Follow').text;
    expect(text).toContain('<Follow> — component');
    expect(text).toContain('#ref → <Oscillator>'); // typed reference, in the form XML writes it
    // A required property reports "required" instead of a default, so an author
    // can see at a glance what may not be omitted.
    const probe = whichText(api, 'RequiredProbe').text;
    expect(probe).toMatch(/size\s+vec2\s+required/);
  });

  it('renders a node tag with its required attachment groups, and reports what holds it', () => {
    const text = whichText(api, 'Mesh').text;
    expect(text).toContain('<Mesh> — node tag');
    expect(text).toMatch(/Requires[\s\S]*<BoxGeometry>/); // the geometry group is mandatory
    expect(text).toContain('<Components>'); // where behaviour goes
  });

  // An enum-typed attribute used to print only the enum's *name* ("CameraFit"),
  // and looking that name up answered "not registered" — a dead end that reads as
  // "this type does not exist". The members are what an author writes, so they
  // belong on the line, and the name has to resolve like any other symbol.
  it('lists an enum attribute’s members, and resolves the enum name itself', () => {
    expect(whichText(api, 'PerspectiveCamera').text).toMatch(/fit\s+CameraFit.*none \| width \| height \| contain \| cover/);

    const enumText = whichText(api, 'CameraFit');
    expect(enumText.ok).toBe(true);
    expect(enumText.text).toContain('CameraFit — enum');
    expect(enumText.text).toContain('<PerspectiveCamera> fit'); // and where it may be written
  });

  // `<PrefabInstance>` is expanded away before the tree is built, so nothing
  // registers a NodeDef for it — but it is a tag authors write, and the XSD has
  // always emitted it. Looking it up used to answer "not registered", the same
  // dead end `CameraFit` had: a real tag that reads as nonexistent.
  it('resolves a tag with no NodeDef of its own', () => {
    const text = whichText(api, 'PrefabInstance');
    expect(text.ok).toBe(true);
    expect(text.text).toContain('<PrefabInstance> — node tag');
    expect(text.text).toMatch(/src\s+string\s+required/);
    // `id` is required on *every* instance (prefab.ts fails before it even
    // resolves src), and the lookup used to list only `src` — so the tool itself
    // was the reason a batch of placements came back one error per instance.
    expect(text.text).toMatch(/id\s+string\s+required/);
    // How you change one placement's values is a child element no attribute row
    // mentions, and guessing wrong is silent — so the shape is shown, not implied.
    expect(text.text).toContain('<Override target="#hp" points="20" />');
    expect(whichIndexText(api)).toContain('<PrefabInstance>');
  });

  it('suggests a near miss and lists the vocabulary when asked for nothing', () => {
    const miss = whichText(api, 'Msh');
    expect(miss.ok).toBe(false);
    expect(miss.text).toContain('did you mean "Mesh"');
    expect(whichIndexText(api)).toContain('<Mesh>');
  });

  it('disambiguates by kind when a name is registered as more than one thing', () => {
    // `kind` narrows the search; an unrelated kind simply does not resolve.
    expect(whichText(api, 'Mesh', 'node').ok).toBe(true);
    expect(whichText(api, 'Mesh', 'component').ok).toBe(false);
  });
});
