import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { getNodeDef } from '@scenoco-three/core/internal';
import { Container, Fullscreen, INTER_MSDF_CHARSET, Text, UIRenderSystem } from '@scenoco-three/ui';

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

describe('@scenoco-three/ui: scene tags', () => {
  it('compiles UI tags to uikit instances, auto-runs UIRenderSystem, and ticks headless', () => {
    const scene = compile(`
      <Scene>
        <PerspectiveCamera id="cam" position="0 0 5" fit="none">
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

/**
 * MSDF text can only draw glyphs baked into the atlas, and the bundled Inter
 * subset is small enough that ordinary typography falls outside it. Unsupported
 * characters used to surface only as a runtime `console.warn`, so a title screen
 * shipped with empty boxes in it and nothing in the build said so.
 */
describe('@scenoco-three/ui: <Text> charset', () => {
  it('rejects characters the font cannot draw, naming each one', () => {
    const r = compileSceneXml(`<Scene><Text text="Level 1 — Ready… 100% × 2" /></Scene>`);
    const d = r.ok ? undefined : r.diagnostics.find((x) => x.code === 'unsupported-glyph');
    expect(d?.message).toContain('U+2014'); // em-dash
    expect(d?.message).toContain('U+2026'); // ellipsis
    expect(d?.message).toContain('U+00D7'); // multiplication sign
    // The ASCII spelling of the same line is fine — the fix is in the message.
    expect(compileSceneXml(`<Scene><Text text="Level 1 - Ready... 100% x 2" /></Scene>`).ok).toBe(true);
  });

  // The charset is transcribed into a constant (a decorator can't await a font),
  // so it is only trustworthy if something compares it to the real thing.
  it('matches the charset actually baked into the bundled font', async () => {
    type FontInfo = { info: { charset: string[] } };
    type Weight = FontInfo | (() => FontInfo | Promise<FontInfo>);
    // The package exports each weight either directly or behind a lazy thunk,
    // depending on the resolved condition — take it whichever way it comes.
    const { inter } = (await import('@pmndrs/msdfonts/inter')) as { inter: Record<string, Weight> };
    for (const weight of ['light', 'medium', 'semi-bold', 'bold']) {
      const entry = inter[weight]!;
      const font = await (typeof entry === 'function' ? entry() : entry);
      expect(font.info.charset.join(''), weight).toBe(INTER_MSDF_CHARSET);
    }
  });
});

/**
 * This package's whole promise is that an attribute name here *is* the uikit
 * property name, so the uikit docs apply verbatim and `setProperties` in a
 * component reads the same as the XML. Nothing enforced it, and one name had
 * already drifted: `backgroundOpacity` (a uikit v0 property) survived the 1.x
 * upgrade in our schema but not in uikit's.
 *
 * uikit validates by parsing a zod schema and **ignores** keys it doesn't know —
 * no throw, no warning — so the attribute compiled, validated, shipped, and did
 * nothing. Both example games authored translucent HUD panels that rendered
 * fully opaque, and the only way to notice was to look.
 */
describe('@scenoco-three/ui: attribute names are uikit property names', () => {
  it('declares nothing uikit would silently ignore', async () => {
    // Each tag against **its own** schema, not Container's: the classes differ by
    // more than a few properties (`objectFit` is real, but only on Image).
    const tags: [tag: string, module: string][] = [
      ['Container', 'container'],
      ['Fullscreen', 'fullscreen'],
      ['Text', 'text'],
      ['Image', 'image'],
    ];
    for (const [tag, module] of tags) {
      const m = (await import(`@pmndrs/uikit/dist/components/${module}.js`)) as Record<string, unknown>;
      const schema = m[`${tag}PropertiesSchema`] as { unwrap(): { shape: Record<string, unknown> } };
      const uikitProperties = new Set(Object.keys(schema.unwrap().shape));
      expect(uikitProperties.size, tag).toBeGreaterThan(100); // the schema really was read

      const def = getNodeDef(tag)!;
      // `text`/`src` are our own tag-shaped spellings of uikit constructor input,
      // not layout properties; everything else must be a real uikit property.
      const ours = Object.keys(def.attrs).filter((a) => !['text', 'src'].includes(a));
      expect(ours.filter((a) => !uikitProperties.has(a)), tag).toEqual([]);
    }
  });
});

/**
 * The pattern that replaced `backgroundOpacity`, pinned because it is now what
 * both example games and the package README tell people to write. The risk it
 * carries is that an absolutely-positioned background is easy to get subtly
 * wrong — sized to its own content instead of the parent, or in front of the
 * text rather than behind it — and either failure is invisible except on screen.
 */
describe('@scenoco-three/ui: translucent panel behind opaque text', () => {
  it('an inset background fills its parent and stays behind the content', () => {
    const scene = compile(`
      <Scene>
        <Container id="pill" flexDirection="row" gap="8"
                   paddingTop="10" paddingBottom="10" paddingLeft="16" paddingRight="16">
          <Container id="bg" positionType="absolute"
                     positionTop="0" positionRight="0" positionBottom="0" positionLeft="0"
                     backgroundColor="#0a0e16" opacity="0.7" borderRadius="10" />
          <Text id="label" text="SCORE 1234" fontSize="26" />
        </Container>
      </Scene>`);
    const engine = new Engine();
    engine.loadScene(bundleScene(scene));
    for (let i = 0; i < 4; i++) engine.tick(1 / 60); // let yoga settle

    const size = (id: string) => (engine.findObject(id) as unknown as Container).size.value;
    const pill = size('pill');
    expect(pill?.[0]).toBeGreaterThan(0); // laid out at all
    // Inset on all four sides means "the whole parent", padding included — a
    // background that shrank to its own (empty) content would be 0×0.
    expect(size('bg')).toEqual(pill);

    // Declared first, so it draws under its siblings rather than over the text.
    const children = engine.findObject('pill')!.children.map((c) => c.sceneId);
    expect(children.indexOf('bg')).toBeLessThan(children.indexOf('label'));

    // And the opacity is the background's alone — the text never inherits it,
    // which is the entire reason for the extra element.
    expect((engine.findObject('label') as unknown as Text).properties.value.opacity).toBe(1);
    engine.dispose();
  });
});
