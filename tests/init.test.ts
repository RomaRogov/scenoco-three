import { describe, expect, it } from 'vitest';
import { Component, component, property } from '@scenoco-three/core';
import { compileSceneXml, generateApi, scaffoldFiles } from '@scenoco-three/compiler';

// The scaffolded `Spin` component, mirrored here so the scene template can be
// validated hermetically — same shape `scenoco init` writes to src/components.
@component({ name: 'Spin', description: 'Spins the host node around its Y axis over time' })
class Spin extends Component {
  @property({ type: 'float', default: 1, description: 'Rotation speed in radians per second' })
  speed = 1;
}
void Spin;

describe('scenoco init scaffold', () => {
  const files = scaffoldFiles('my-app');

  it('writes a runnable project skeleton', () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'index.html',
        'src/main.ts',
        'src/components/Spin.ts',
        'src/scenes/hello.scene.xml',
        '.gitignore',
      ]),
    );
  });

  it('emits no markdown files', () => {
    expect(Object.keys(files).some((f) => f.endsWith('.md'))).toBe(false);
  });

  it('package.json is valid JSON and wires --components into the scripts', () => {
    const pkg = JSON.parse(files['package.json']!) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('my-app');
    expect(pkg.scripts.validate).toContain('--components src/components');
    expect(pkg.scripts.export).toContain('--components src/components');
    expect(pkg.dependencies['@scenoco-three/core']).toBeDefined();
  });

  it('the starter component declares @component and @property', () => {
    const spin = files['src/components/Spin.ts']!;
    expect(spin).toContain("@component({ name: 'Spin'");
    expect(spin).toContain("@property({ type: 'float'");
  });

  it('the starter scene validates against the starter component', () => {
    const result = compileSceneXml(files['src/scenes/hello.scene.xml']!);
    expect(result.ok).toBe(true);
  });

  it('the starter component is described by the exporter with no wiring', () => {
    const spin = generateApi().components.find((c) => c.name === 'Spin');
    expect(spin).toBeDefined();
    expect(spin!.properties.map((p) => p.name)).toContain('speed');
  });
});
