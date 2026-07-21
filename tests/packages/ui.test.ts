import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { Container, Fullscreen, Text, UIRenderSystem } from '@scenoco-three/ui';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

describe('@scenoco-three/ui: scene tags', () => {
  it('compiles UI tags to uikit instances, auto-runs UIRenderSystem, and ticks headless', () => {
    const scene = compile(`
      <Scene>
        <PerspectiveCamera id="cam" position="0 0 5">
          <Fullscreen id="hud" flexDirection="row" justifyContent="space-between" padding="20">
            <Container id="pill" backgroundColor="#0a0e16" borderRadius="10">
              <Text id="score" text="SCORE 0" fontSize="26" color="#4af0e0" />
            </Container>
          </Fullscreen>
        </PerspectiveCamera>
      </Scene>`);
    const engine = new Engine();
    engine.loadScene(bundleScene(scene));

    const hud = engine.findObject('hud');
    expect(hud).toBeInstanceOf(Fullscreen);
    expect(engine.findObject('pill')).toBeInstanceOf(Container);
    const score = engine.findObject('score');
    expect(score).toBeInstanceOf(Text);

    // The node-query system auto-started and tracks every uikit element.
    const sys = engine.getSystem(UIRenderSystem);
    expect(sys).toBeDefined();
    expect(sys!.nodes.length).toBe(3);

    // Authored attributes arrived as uikit properties, verbatim.
    expect((score as Text).properties.value.fontSize).toBe(26);
    expect((hud as Fullscreen).properties.value.justifyContent).toBe('space-between');

    // Headless tick: no renderer, so Fullscreen layout is skipped — must not throw.
    engine.tick(1 / 60);

    // Runtime updates use the plain uikit API.
    (score as Text).setProperties({ text: 'SCORE 10' });
    expect((score as Text).properties.value.text).toBe('SCORE 10');
    engine.dispose();
  });

  it('a world-space <Container> root outside any UI parent lays out on tick', () => {
    const scene = compile(`
      <Scene>
        <Container id="panel" position="0 1 0" flexDirection="column" gap="8">
          <Text text="hello" />
        </Container>
      </Scene>`);
    const engine = new Engine();
    engine.loadScene(bundleScene(scene));
    const panel = engine.findObject('panel')!;
    expect(panel).toBeInstanceOf(Container);
    expect(panel.position.y).toBe(1); // a root keeps its authored transform
    engine.tick(1 / 60); // update(delta) runs on the root — must not throw
    engine.dispose();
  });
});
