import { describe, expect, it } from 'vitest';
import { compileSceneXml } from '@scenoco-three/compiler';

function compile(xml: string) {
  const result = compileSceneXml(xml);
  if (!result.ok) throw new Error(`unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  return result.scene;
}

describe('compile → CompiledScene', () => {
  it('returns diagnostics instead of a scene on invalid input', () => {
    const result = compileSceneXml(`<Scene><Mesh id="A" /></Scene>`);
    expect(result.ok).toBe(false);
  });

  it('produces a flat, indexed node array with parent/child links', () => {
    const scene = compile(`<Scene>
      <Group id="G"><Mesh id="M"><BoxGeometry /></Mesh></Group>
    </Scene>`);
    expect(scene.root).toBe(0);
    expect(scene.nodes[0]!.tag).toBe('Scene');
    expect(scene.nodes[0]!.parent).toBe(-1);

    const group = scene.nodes.find((n) => n.id === 'G')!;
    const mesh = scene.nodes.find((n) => n.id === 'M')!;
    const groupIndex = scene.nodes.indexOf(group);
    const meshIndex = scene.nodes.indexOf(mesh);
    expect(group.children).toContain(meshIndex);
    expect(mesh.parent).toBe(groupIndex);
  });

  it('indexes a mesh’s attachments into the shared pool', () => {
    const scene = compile(`<Scene>
      <Mesh id="M"><BoxGeometry width="2" /><MeshStandardMaterial color="#ff0000" /></Mesh>
    </Scene>`);
    const mesh = scene.nodes.find((n) => n.id === 'M')!;
    const atts = mesh.attachments.map((i) => scene.attachments[i]!);
    const geom = atts.find((a) => a.tag === 'BoxGeometry')!;
    const mat = atts.find((a) => a.tag === 'MeshStandardMaterial')!;
    expect(geom.attrs.width).toBe(2);
    expect(mat.attrs.color).toBe(0xff0000);
  });

  it('stores transforms with rotation converted to radians', () => {
    const scene = compile(`<Scene>
      <Mesh id="M" position="1 2 3" rotation="0 90 0" scale="2 2 2"><BoxGeometry /></Mesh>
    </Scene>`);
    const mesh = scene.nodes.find((n) => n.id === 'M')!;
    expect(mesh.transform.position).toEqual([1, 2, 3]);
    expect(mesh.transform.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(mesh.transform.scale).toEqual([2, 2, 2]);
  });

  it('only stores explicitly-set component props (defaults stay on the instance)', () => {
    const scene = compile(`<Scene>
      <Mesh id="M"><BoxGeometry /><Components><Rotator speed="3" /></Components></Mesh>
    </Scene>`);
    expect(scene.components[0]!.type).toBe('Rotator');
    expect(scene.components[0]!.props).toEqual({ speed: 3 });
  });

  it('resolves a #id component reference to a component index', () => {
    const scene = compile(`<Scene>
      <Mesh id="A"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh>
      <Mesh id="B"><BoxGeometry /><Components><Follow source="#osc" /></Components></Mesh>
    </Scene>`);
    const oscIndex = scene.components.findIndex((c) => c.type === 'Oscillator');
    const follow = scene.components.find((c) => c.type === 'Follow')!;
    expect(follow.props.source).toEqual({ component: oscIndex });
  });

  it('resolves a #id node reference to a node index', () => {
    const scene = compile(`<Scene>
      <Mesh id="Target"><BoxGeometry /></Mesh>
      <Mesh id="B"><BoxGeometry /><Components><LookAt target="#Target" /></Components></Mesh>
    </Scene>`);
    const targetIndex = scene.nodes.findIndex((n) => n.id === 'Target');
    const lookAt = scene.components.find((c) => c.type === 'LookAt')!;
    expect(lookAt.props.target).toEqual({ node: targetIndex });
  });

  it('is JSON-serializable', () => {
    const scene = compile(`<Scene><Mesh id="M"><BoxGeometry /></Mesh></Scene>`);
    expect(() => JSON.stringify(scene)).not.toThrow();
    expect(JSON.parse(JSON.stringify(scene)).nodes.length).toBe(scene.nodes.length);
  });
});
