import { describe, expect, it } from 'vitest';
import { Component, Engine, ValueType, component, property } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { telemetryFor } from '../../packages/editor/app/session.js';

/**
 * `telemetryFor` is what `get_telemetry` (and the `telemetry` simulate step) return.
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
      transform: { position: number[] };
      components: Record<string, Record<string, unknown>>;
    };
    expect(t.type).toBe('Group');
    expect(t.transform.position).toEqual([0, 2, 0]);
    expect(t.components.Probe).toEqual({ id: 'probe', target: 5 });
  });

  // The reason this exists: a component carrying `id="probe"` used to be
  // unaddressable, so an agent reading state back had to know which node hosted it.
  it('resolves a component id, reporting it with its host node', () => {
    const t = telemetryFor(engineWith(SCENE), 'probe') as {
      kind: string;
      type: string;
      node: { id?: string; type: string };
      transform: { position: number[] };
      properties: Record<string, unknown>;
    };
    expect(t.kind).toBe('component');
    expect(t.type).toBe('Probe');
    // The host comes with it — a component's state means little without its place.
    expect(t.node).toEqual({ id: 'host', type: 'Group' });
    expect(t.transform.position).toEqual([0, 2, 0]);
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
});
