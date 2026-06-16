import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deserializeBundle, type CompiledScene } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, type ResourceResolver } from '@scenoco-three/compiler';

const fsResolver: ResourceResolver = (request, referrer) => {
  const path = resolve(referrer ? dirname(referrer) : '.', request);
  return existsSync(path) ? { path, contents: readFileSync(path, 'utf8') } : null;
};

function compile(xml: string, path?: string): CompiledScene {
  const result = compileSceneXml(xml, path ? { path, resolve: fsResolver } : {});
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.diagnostics)}`);
  return result.scene;
}

const turbineScenePath = fileURLToPath(new URL('../playground/scenes/turbine.scene.xml', import.meta.url));
const turbineXml = readFileSync(turbineScenePath, 'utf8');

describe('bundle encode/decode', () => {
  it('round-trips the (prefab-based) turbine scene exactly', () => {
    const compiled = compile(turbineXml, turbineScenePath);
    const restored = deserializeBundle(bundleScene(compiled));
    expect(restored).toEqual(compiled);
  });

  it('round-trips a scene covering every value type and reference kind', () => {
    const compiled = compile(`<Scene>
      <PointLight id="lamp" color="#ffcc66" intensity="20" position="2 3 1" />
      <Group id="rig" rotation="0 90 0" scale="2 2 2">
        <Mesh id="hero" position="0 1 0">
          <TorusGeometry radius="2" tube="0.3" />
          <MeshStandardMaterial color="#4f8ef7" metalness="0.6" transparent="true" />
          <Components>
            <Oscillator id="bob" axis="1 0 0" amplitude="0.5" />
            <Rotator speed="3.14" />
          </Components>
        </Mesh>
        <Mesh id="chaser"><BoxGeometry />
          <Components>
            <Follow source="#bob" scale="2" />
            <LookAt target="#hero" />
          </Components>
        </Mesh>
      </Group>
    </Scene>`);
    const restored = deserializeBundle(bundleScene(compiled));
    expect(restored).toEqual(compiled);
  });

  it('interns repeated strings into a frequency-sorted pool', () => {
    const bundle = bundleScene(
      compile(`<Scene>
        <Mesh id="a"><BoxGeometry /></Mesh>
        <Mesh id="b"><BoxGeometry /></Mesh>
        <Mesh id="c"><BoxGeometry /></Mesh>
      </Scene>`),
    );
    const strings = bundle[1];
    // "Mesh" appears 3×, "BoxGeometry" 3×, "Scene" 1×, ids 1× each → tags lead the pool.
    expect(strings).toContain('Mesh');
    expect(strings).toContain('BoxGeometry');
    expect(strings.indexOf('Mesh')).toBeLessThan(strings.indexOf('a'));
  });

  it('elides default attributes and identity transforms', () => {
    // A default Box mesh at the origin: the node record carries almost nothing.
    const bundle = bundleScene(compile(`<Scene><Mesh><BoxGeometry /></Mesh></Scene>`));
    const [, , asset] = bundle;
    const nodes = asset[0];
    const mesh = nodes[1]!; // [0] is Scene
    // [tagIndex, flags, attrMask(0), attachmentIndices] — no transform, no id, no attr values.
    expect(mesh).toEqual([expect.any(Number), expect.any(Number), 0, [0]]);
    const attachment = asset[1][0]!; // BoxGeometry all-default → [tagIndex, mask 0]
    expect(attachment).toEqual([expect.any(Number), 0]);
  });

  it('encodes references with bitwise-NOT (component i, node ~i)', () => {
    const compiled = compile(`<Scene>
      <Mesh id="A"><BoxGeometry /><Components><Oscillator id="osc" /></Components></Mesh>
      <Mesh id="B"><BoxGeometry /><Components>
        <Follow source="#osc" /><LookAt target="#A" />
      </Components></Mesh>
    </Scene>`);
    const restored = deserializeBundle(bundleScene(compiled));
    const follow = restored.components.find((c) => c.type === 'Follow')!;
    const lookAt = restored.components.find((c) => c.type === 'LookAt')!;
    expect(follow.props.source).toHaveProperty('component'); // forward (>=0)
    expect(lookAt.props.target).toHaveProperty('node'); // bitwise-NOT (<0)
  });

  it('is JSON-serializable', () => {
    const bundle = bundleScene(compile(turbineXml, turbineScenePath));
    expect(() => JSON.stringify(bundle)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    expect(deserializeBundle(roundTripped)).toEqual(compile(turbineXml, turbineScenePath));
  });
});
