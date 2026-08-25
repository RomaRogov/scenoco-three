import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Workspace,
  scanComponents,
  type ComponentInfo,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * The scanner is what replaced `@component`. A component is a class extending `Component` and
 * nothing else marks it, so the only way to know what exists is to read the workspace — which
 * is also what makes the schema unable to drift from the code, since there is no second copy
 * of it anywhere.
 */
let fixture: Fixture;
let found: Map<string, ComponentInfo>;

beforeAll(() => {
  fixture = makeFixture('components');
  fixture.write(
    'game.ts',
    `import { Component, serialize, Event } from '@scenoco-three/core';
import { Mesh, Vector3 } from 'three';

/** Moves the paddle along the bottom of the field. */
export class PaddleController extends Component<Mesh> {
  /** Units per second the paddle travels. */
  speed = 10;
  /** Where it starts. */
  origin = new Vector3(0, 1, 0);
  /** Bricks to watch. */
  bricks: Mesh[] = [];
  /** How it blends. */
  mode: 'chase' | 'hold' = 'chase';
  /** The ball to serve. */
  ball!: Mesh;
  /** Optional target. */
  target?: Mesh;
  /** Texture painted on the paddle. */
  @serialize({ asset: 'texture' }) skin = '';
  @serialize private tuning = 0.5;
  readonly missed = new Event<[]>();
  private velocity = 0;
  #secret = 1;
  static shared = 0;
  override update(dt: number) { void dt; void this.velocity; void this.#secret; }
}

/** A paddle that also boosts. */
export class FastPaddle extends PaddleController {
  boost = 2;
}

export class GridLayout extends Component {
  spacing = 1;
}

/** Not a component at all. */
export class Helper {
  speed = 3;
}
`,
  );
  found = new Map(
    Workspace.with(fixture.tsconfig, (w) => scanComponents(w)).map((c) => [c.name, c]),
  );
});

afterAll(() => fixture.dispose());

describe('scanComponents', () => {
  it('finds classes extending Component, and only those', () => {
    // `CameraFit` is core's own — the one component the engine ships, and a fixture maps core
    // to its source, so the walk finds it exactly as it finds the project's.
    expect([...found.keys()].sort()).toEqual([
      'Animator',
      'AttachTo',
      'CameraFit',
      'FastPaddle',
      'GridLayout',
      'PaddleController',
    ]);
    expect(found.has('Helper')).toBe(false);
  });

  it('follows the chain, so a subclass of a component is a component', () => {
    // Resolved through the checker, not by matching the word "Component" in the
    // extends clause — `FastPaddle extends PaddleController` has to be followed.
    expect(found.get('FastPaddle')?.extends).toBe('PaddleController');
  });

  it('serializes public fields with no decorator at all', () => {
    const fields = found.get('PaddleController')!.fields;
    const names = fields.map((f) => f.name);
    expect(names).toContain('speed');
    expect(names).toContain('origin');
    expect(names).toContain('bricks');
    // Public, so serialized, and nothing in the source says so.
    expect(fields.find((f) => f.name === 'speed')?.explicit).toBe(false);
  });

  it('reads type, default and description straight from the source', () => {
    const fields = found.get('PaddleController')!.fields;
    const by = (n: string) => fields.find((f) => f.name === n)!;
    expect(by('speed').type).toBe('number');
    expect(by('speed').default).toBe('10');
    expect(by('speed').description).toBe('Units per second the paddle travels.');
    // A constructed default survives verbatim — v1's runtime probe could only
    // report the value it happened to build.
    expect(by('origin').type).toBe('Vector3');
    expect(by('origin').default).toBe('new Vector3(0, 1, 0)');
    expect(by('bricks').type).toBe('Mesh[]');
    expect(found.get('PaddleController')?.description).toBe('Moves the paddle along the bottom of the field.');
  });

  it('skips private, `#private` and static fields unless @serialize takes them', () => {
    const names = found.get('PaddleController')!.fields.map((f) => f.name);
    expect(names).not.toContain('velocity'); // private, undecorated
    expect(names).not.toContain('secret'); // #private — no decorator can reach it
    expect(names).not.toContain('shared'); // static
    expect(names).toContain('tuning'); // private, but @serialize took it
    expect(found.get('PaddleController')!.fields.find((f) => f.name === 'tuning')?.explicit).toBe(true);
  });

  it('carries @serialize options through', () => {
    const skin = found.get('PaddleController')!.fields.find((f) => f.name === 'skin')!;
    expect(skin.serializeOptions).toBe(`{ asset: 'texture' }`);
  });

  it('derives how each field is authored from its type, not from a decorator', () => {
    const fields = found.get('PaddleController')!.fields;
    const by = (n: string) => fields.find((f) => f.name === n)!;
    expect(by('speed').shape).toBe('number');
    expect(by('origin').shape).toBe('vector3');
    expect(by('bricks').shape).toBe('array');
    expect(by('bricks').elementShape).toBe('nodeRef');
    expect(by('ball').shape).toBe('nodeRef');
    expect(by('mode').shape).toBe('enum');
    expect(by('mode').options).toEqual(['"chase"', '"hold"']);
  });

  it('marks a field with no default as one the author must supply', () => {
    const fields = found.get('PaddleController')!.fields;
    const by = (n: string) => fields.find((f) => f.name === n)!;
    // `ball!: Mesh` — the `!` says "assigned elsewhere", and for a component that elsewhere is
    // the authored value, so the document has to provide one.
    expect(by('ball').required).toBe(true);
    expect(by('target').required).toBe(false);
    expect(by('speed').required).toBe(false);
  });

  it('records the node type a component insists on', () => {
    // `Component<Mesh>` — checked against the host tag, so a mis-hosted component is a
    // diagnostic at the XML line rather than a type error buried in generated code.
    expect(found.get('PaddleController')?.requiresNode).toBe('Mesh');
    expect(found.get('GridLayout')?.requiresNode).toBeUndefined();
  });

  it('leaves readonly fields out — they are state the component owns, not a knob', () => {
    // `readonly missed = new Event<[]>()` is the common case, and generated code assigning to
    // it would not compile.
    expect(found.get('PaddleController')!.fields.map((f) => f.name)).not.toContain('missed');
  });

  it('reports where each class lives', () => {
    expect(found.get('PaddleController')?.file).toMatch(/game\.ts$/);
    expect(found.get('PaddleController')?.line).toBeGreaterThan(0);
  });
});

/**
 * A doc comment's **first paragraph** is the description.
 *
 * A good comment on a component runs to twenty lines with a worked XML example in it. All of that
 * belongs in the source and none of it belongs in an inspector row — which is where the whole
 * thing turned up, example markup and all, the first time the editor rendered one.
 */
describe('descriptions', () => {
  it('stops at the blank line the author already wrote', () => {
    const fixture = makeFixture('doc-summary');
    fixture.write(
      'game.ts',
      `import { Component } from '@scenoco-three/core';

/**
 * Makes this node a 2D physics body.
 *
 * Pair it with a collider to give it shape:
 *
 * \`\`\`xml
 * <RigidBody2D kind="dynamic" />
 * \`\`\`
 */
export class Body extends Component {
  /**
   * How the body moves.
   *
   * Not this second paragraph.
   */
  kind = 'dynamic';
}
`,
    );
    const found = Workspace.with(fixture.tsconfig, (w) => scanComponents(w));
    const body = found.find((c) => c.name === 'Body')!;
    expect(body.description).toBe('Makes this node a 2D physics body.');
    expect(body.fields.find((f) => f.name === 'kind')?.description).toBe('How the body moves.');
    fixture.dispose();
  }, 60_000);
});
