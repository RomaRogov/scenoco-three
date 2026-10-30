import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { AXES } from '@scenoco-three/core';
import { convertPage } from '../../packages/unity/src/page.js';
import { inputActions } from '../../packages/unity/src/input.js';
import { moduleStub, outsideClasses } from '../../packages/unity/src/stub.js';

const breakout = fileURLToPath(new URL('../../examples/breakout', import.meta.url));

describe('what a Unity port is handed', () => {
  it("breakout's page as UXML and USS, as UI Toolkit spells them", async () => {
    const page = await convertPage(breakout, ['ui'], { fonts: false });
    const uxml = page.files.get('Assets/UI/ui.uxml')!;
    const uss = page.files.get('Assets/UI/Page.uss')!;
    // The banner takes taps; the HUD over it does not: pointer-events, as picking-mode.
    expect(uxml).toMatch(/name="banner"(?![^>]*picking-mode)/);
    expect(uxml).toMatch(/name="hud"[^>]*picking-mode="Ignore"/);
    // An element code fills with text is a Label; each template is a document of its own.
    expect(uxml).toMatch(/<ui:Label name="combo"/);
    expect(page.files.has('Assets/UI/chip.uxml')).toBe(true);
    // USS's own spellings, and rules for classes code puts on kept; the loading screen around the game left out.
    expect(uss).toContain('ease-out-back');
    expect(uss).not.toContain('cubic-bezier');
    expect(uss).toContain('-unity-slice-left');
    expect(uss).toMatch(/\.chip\.laser > \.shade/);
    expect(uss).not.toContain('#loading');
    expect(page.copies.size).toBeGreaterThan(10);
  });

  it("core's named axes as the project-wide input actions", () => {
    const asset = JSON.parse(inputActions(AXES as never));
    const map = asset.maps[0];
    expect(map.actions.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(['Horizontal', 'Jump', 'Submit', 'Mouse X']));
    const paths = (action: string) => map.bindings.filter((b: { action: string }) => b.action === action).map((b: { path: string }) => b.path);
    expect(paths('Horizontal')).toEqual(expect.arrayContaining(['1DAxis', '<Keyboard>/a', '<Keyboard>/leftArrow', '<Gamepad>/dpad/left', '<Gamepad>/leftStick/x']));
    expect(paths('Jump')).toEqual(['<Keyboard>/space', '<Gamepad>/buttonNorth']);
    expect(paths('Fire1')).toContain('<Mouse>/leftButton');
  });

  it('code outside behaviours, as its TypeScript in C# comments', () => {
    const paddle = readFileSync(`${breakout}/src/Paddle.ts`, 'utf8');
    const outside = outsideClasses(paddle, '/src/Paddle.ts', ['Paddle']).join('\n');
    expect(outside).toContain('export interface Effect');
    expect(outside).not.toContain('class Paddle');
    expect(outside).not.toContain('import ');
    const stub = moduleStub('/src/bonus.ts', readFileSync(`${breakout}/src/bonus.ts`, 'utf8'));
    expect(stub.split('\n').every((l) => l === '' || l.startsWith('//'))).toBe(true);
    expect(stub).toContain("// export const BONUSES = ['laser', 'multi', 'wide', 'slim'] as const;");
  });
});
