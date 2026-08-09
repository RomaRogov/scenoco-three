import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { pendingFonts } from '../../packages/editor/app/session.js';

/**
 * The readiness signal a capture waits on. uikit resolves an MSDF font through a
 * dynamic `import()` and leaves `Text.fontSignal` undefined until it lands — and
 * an unmeasured Text sits *still*, at zero size, so watching the layout stop
 * moving is not enough on its own to tell "laid out" from "not yet measured".
 * That false steady state is what made early HUD screenshots collapse.
 */
describe('capture readiness — pending MSDF fonts', () => {
  it('counts a Text whose font has not arrived, and stops counting it once it has', () => {
    const engine = new Engine({ editor: true });
    const text = Object.assign(new Object3D(), { fontSignal: { value: undefined as unknown } });
    engine.scene.add(text);
    expect(pendingFonts(engine)).toBe(1);

    text.fontSignal.value = { face: 'inter' }; // the import landed
    expect(pendingFonts(engine)).toBe(0);

    // Nothing else in a scene looks like a font holder — a plain node must not
    // hold a capture open forever.
    engine.scene.add(new Object3D());
    expect(pendingFonts(engine)).toBe(0);
  });
});
