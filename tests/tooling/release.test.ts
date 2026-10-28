import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

const root = new URL('./.tmp/release/', import.meta.url).pathname;
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('a release build', () => {
  it('carries none of the editor or the dev bridge', async () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(`${root}main.js`, `import { play } from '@scenoco-three/core';\nimport { Scene } from 'three';\nplay(() => new Scene());\n`);
    // Vite builds for development unless NODE_ENV says production — and vitest sets it to 'test'.
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const out = (await build({ root, mode: 'production', logLevel: 'silent', build: { write: false, rollupOptions: { input: `${root}main.js` } } }).finally(() => {
      process.env.NODE_ENV = was;
    })) as Rollup.RollupOutput[] | Rollup.RollupOutput;
    const code = [out]
      .flat()
      .flatMap((o) => o.output)
      .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
      .join('\n');
    expect(code).toContain('setAnimationLoop');
    for (const dev of ['__scenoco', 'scenoco-editor', 'TransformControls', 'OrbitControls']) expect(code).not.toContain(dev);
  }, 60_000);
});
