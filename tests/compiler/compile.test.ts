import { describe, expect, it } from 'vitest';
import { compileSceneXml } from '@scenoco-three/compiler';
import { EnumProbe } from '../fixtures/components/EnumProbe.js';

function compile(xml: string) {
  const result = compileSceneXml(xml);
  if (!result.ok) throw new Error(`unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  return result.scene;
}

describe('compile → CompiledScene', () => {
  it('returns diagnostics instead of a scene on invalid input', () => {
    expect(compileSceneXml(`<Scene><Mesh id="A" /></Scene>`).ok).toBe(false);
  });

  it('produces a flat, indexed node array with parent/child links', () => {
    const scene = compile(`<Scene><Group id="G"><Mesh id="M"><BoxGeometry /></Mesh></Group></Scene>`);
    expect(scene.root).toBe(0);
    expect(scene.nodes[0]!.tag).toBe('Scene');
    expect(scene.nodes[0]!.parent).toBe(-1);

    const groupIndex = scene.nodes.findIndex((n) => n.id === 'G');
    const meshIndex = scene.nodes.findIndex((n) => n.id === 'M');
    expect(scene.nodes[groupIndex]!.children).toContain(meshIndex);
    expect(scene.nodes[meshIndex]!.parent).toBe(groupIndex);
  });

  it('indexes attachments into the shared pool, converts rotation to radians, and stores only explicit props', () => {
    const scene = compile(`<Scene>
      <Mesh id="M" position="1 2 3" rotation="0 90 0" scale="2 2 2">
        <BoxGeometry width="2" /><MeshStandardMaterial color="#ff0000" />
        <Components><Rotator speed="3" /></Components>
      </Mesh>
    </Scene>`);
    const mesh = scene.nodes.find((n) => n.id === 'M')!;
    const atts = mesh.attachments.map((i) => scene.attachments[i]!);
    expect(atts.find((a) => a.tag === 'BoxGeometry')!.attrs.width).toBe(2);
    expect(atts.find((a) => a.tag === 'MeshStandardMaterial')!.attrs.color).toBe(0xff0000);
    expect(mesh.transform.position).toEqual([1, 2, 3]);
    expect(mesh.transform.rotation[1]).toBeCloseTo(Math.PI / 2); // degrees → radians
    expect(scene.components[0]).toMatchObject({ type: 'Rotator', props: { speed: 3 } }); // defaults not stored
  });

  it('resolves #id component and node references to pool indices', () => {
    const scene = compile(`<Scene>
      <Mesh id="Target"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh>
      <Mesh id="B"><BoxGeometry /><Components><Follow source="#osc" /><LookAt target="#Target" /></Components></Mesh>
    </Scene>`);
    const oscIndex = scene.components.findIndex((c) => c.type === 'Oscillator');
    const targetIndex = scene.nodes.findIndex((n) => n.id === 'Target');
    expect(scene.components.find((c) => c.type === 'Follow')!.props.source).toEqual({ component: oscIndex });
    expect(scene.components.find((c) => c.type === 'LookAt')!.props.target).toEqual({ node: targetIndex });
  });

  it('compiles array props: float, vec3, node-ref and typed component-ref', () => {
    const scene = compile(`<Scene>
      <Mesh id="a"><BoxGeometry /><Components><Oscillator id="o1" /></Components></Mesh>
      <Mesh id="b"><BoxGeometry /><Components><Oscillator id="o2" /></Components></Mesh>
      <Mesh id="M"><BoxGeometry />
        <Components><ArrayProbe points="[1,2,3]" waypoints="[0 1 0,1 0 0]" targets="[#a,#b]" oscillators="[#o1,#o2]" /></Components>
      </Mesh>
    </Scene>`);
    const aIndex = scene.nodes.findIndex((n) => n.id === 'a');
    const bIndex = scene.nodes.findIndex((n) => n.id === 'b');
    const o1 = scene.components.findIndex((c) => c.id === 'o1');
    const o2 = scene.components.findIndex((c) => c.id === 'o2');
    const probe = scene.components.find((c) => c.type === 'ArrayProbe')!;
    expect(probe.props.points).toEqual([1, 2, 3]);
    expect(probe.props.waypoints).toEqual([[0, 1, 0], [1, 0, 0]]);
    expect(probe.props.targets).toEqual([{ node: aIndex }, { node: bIndex }]);
    expect(probe.props.oscillators).toEqual([{ component: o1 }, { component: o2 }]);
  });
});

describe('compile → enum properties', () => {
  const scene = (inner: string) => `<Scene><Group id="g"><Components>${inner}</Components></Group></Scene>`;

  it('parses member names to native values (numeric + string kinds) and rejects unknown members', () => {
    void EnumProbe;
    const c = compile(scene(`<EnumProbe side="Double" kind="Static" />`)).components.find((x) => x.type === 'EnumProbe')!;
    expect(c.props.side).toBe(2); // Side.Double (numeric)
    expect(c.props.kind).toBe('static'); // BodyKind.Static (string)

    const bad = compileSceneXml(scene(`<EnumProbe side="Sideways" />`));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.diagnostics[0]!.code).toBe('bad-value');
      expect(bad.diagnostics[0]!.message).toContain('enum Side');
    }
  });
});
