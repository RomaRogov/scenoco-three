import { describe, expect, it } from 'vitest';
import { parseSync } from 'vite';
import { withoutMarkers } from '../../packages/compiler/src/index.js';

/**
 * The build's markers never reach the page.
 *
 * `@serializeField` and `@nonSerialized` mean something only to the scan, and no browser parses
 * a decorator — Chrome reports the bare syntax as an invalid token — so the plugin takes them out.
 */
const parse = (file: string, code: string) => parseSync(file, code).program;

const SOURCE = `import { nonSerialized, serializeField } from '@scenoco-three/compiler/serialize';
import { Component } from '@scenoco-three/core';

const note = '@nonSerialized in a string stays';
export class Paddle extends Component {
  // @serializeField in a comment stays
  speed = 10;
  @nonSerialized hits = 0;
  @serializeField
  private tuning = 0.5;
  @track() moves = 0;
}
`;

describe('the build’s markers', () => {
  it('are blanked with their import, and nothing else moves', () => {
    const out = withoutMarkers(SOURCE, '/game/src/Paddle.ts', parse)!;
    expect(out).not.toMatch(/@nonSerialized hits|@serializeField\n|compiler\/serialize/);
    // Same length, same lines: every offset — and so the source map — is still right.
    expect(out).toHaveLength(SOURCE.length);
    expect(out.split('\n').map((l) => l.trim())).toContain('hits = 0;');
    expect(out).toContain("'@nonSerialized in a string stays'");
    expect(out).toContain('// @serializeField in a comment stays');
    // A decorator of the project's own is not a marker.
    expect(out).toContain('@track() moves = 0;');
    expect(parseSync('Paddle.ts', out).errors).toEqual([]);
  });

  it('leave everything else unparsed', () => {
    expect(withoutMarkers('export const a = 1;', '/game/src/a.ts', parse)).toBeNull();
    expect(withoutMarkers(SOURCE, '/game/node_modules/lib/Paddle.ts', parse)).toBeNull();
    expect(withoutMarkers(SOURCE, '/game/src/Paddle.js', parse)).toBeNull();
    expect(withoutMarkers(SOURCE, '/game/src/Paddle.ts?t=123', parse)).not.toBeNull();
  });
});
