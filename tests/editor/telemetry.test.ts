import { describe, expect, it } from 'vitest';
import { Component, Engine, ValueType, component, property } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { telemetryFor } from '../../packages/editor/app/session.js';

/**
 * `telemetryFor` is what `inspect` (and the `telemetry` simulate step) return.
 * It is how an agent reads game state back while playtesting, so what it can and
 * cannot address is a contract worth pinning: nodes *and* components share one id
 * namespace, and only `@property` fields are on a component's public surface.
 */
@component({ name: 'Probe', description: 'Telemetry fixture' })
class Probe extends Component {
  @property({ type: ValueType.Int, description: 'An authored property' })
  target = 3;

  /** Runtime-only working state — deliberately not part of the declared surface. */
  score = 7;
}
void Probe;

const SCENE = `<Scene>
  <Group id="host" position="y: 2">
    <Components><Probe id="probe" target="5" /></Components>
  </Group>
</Scene>`;

function engineWith(xml: string): Engine {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(`fixture failed to compile: ${JSON.stringify(r.diagnostics)}`);
  const engine = new Engine({ editor: true });
  engine.loadScene(bundleScene(r.scene));
  return engine;
}

describe('telemetryFor', () => {
  it('reports a node with its transform and every component on it', () => {
    const t = telemetryFor(engineWith(SCENE), 'host') as {
      type: string;
      transform: { position: { x: number; y: number; z: number } };
      components: Record<string, Record<string, unknown>>;
    };
    expect(t.type).toBe('Group');
    expect(t.transform.position).toEqual({ x: 0, y: 2, z: 0 }); // axis-named, like the XML it was authored in
    expect(t.components.Probe).toEqual({ id: 'probe', target: 5 });
  });

  // The reason this exists: a component carrying `id="probe"` used to be
  // unaddressable, so an agent reading state back had to know which node hosted it.
  it('resolves a component id, reporting it with its host node', () => {
    const t = telemetryFor(engineWith(SCENE), 'probe') as {
      kind: string;
      type: string;
      node: { id?: string; type: string };
      transform: { position: { x: number; y: number; z: number } };
      properties: Record<string, unknown>;
    };
    expect(t.kind).toBe('component');
    expect(t.type).toBe('Probe');
    // The host comes with it — a component's state means little without its place.
    expect(t.node).toEqual({ id: 'host', type: 'Group' });
    expect(t.transform.position).toEqual({ x: 0, y: 2, z: 0 }); // axis-named, like the XML it was authored in
    expect(t.properties).toEqual({ target: 5 });
  });

  // A component's declared surface is its @property set — the same one the XML and
  // the inspector expose. Plain fields are private working memory.
  it('reports @property fields only, never plain runtime fields', () => {
    const t = telemetryFor(engineWith(SCENE), 'probe') as { properties: Record<string, unknown> };
    expect(t.properties).toHaveProperty('target');
    expect(t.properties).not.toHaveProperty('score');
  });

  // An id that stops resolving is how an agent proves something was destroyed, so
  // the miss must be a clean, readable result rather than a throw.
  it('returns a readable error naming both kinds when nothing resolves', () => {
    const t = telemetryFor(engineWith(SCENE), 'ghost') as { error: string };
    expect(t.error).toBe('no node or component with id "ghost"');
  });

  // A `simulate` batch returns its captures as one flat ordered list, so two
  // readings of the same id are indistinguishable without a stamp saying when each
  // was taken — and "moved 1.2 units over 30 frames" needs the frame count to mean
  // anything. The stamp is on a miss too: when an id stopped resolving is itself
  // the assertion that something was destroyed.
  it('stamps every reading — hit or miss — with the frame and simulated time it was taken at', () => {
    const engine = engineWith(SCENE);
    const at0 = telemetryFor(engine, 'host') as { frame: number; time: number };
    expect(at0).toMatchObject({ frame: 0, time: 0 });

    for (let i = 0; i < 30; i++) engine.tick(1 / 60);
    const at30 = telemetryFor(engine, 'host') as { frame: number; time: number };
    expect(at30.frame).toBe(30);
    expect(at30.time).toBeCloseTo(0.5, 2);

    // Same stamp on a component reading and on an unresolved id.
    expect(telemetryFor(engine, 'probe')).toMatchObject({ frame: 30 });
    expect(telemetryFor(engine, 'ghost')).toMatchObject({ frame: 30, error: expect.any(String) });
  });
});
