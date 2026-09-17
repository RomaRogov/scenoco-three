import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Workspace,
  emitGraph,
  parseDocument,
  scanComponents,
  scanEffects,
  scanSystems,
  scanTags,
  type ComponentInfo,
  type ProjectModel,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A tag package contributes its components and systems to the DSL through one dependency.
 *
 * The scan reaches them the same way it reaches `three`'s classes — through the module's
 * exports — and describes them with exactly the same code as a project's own classes, so a
 * `<RigidBody2D>` and a `<PaddleController>` are indistinguishable to everything downstream.
 */
let fixture: Fixture;
let model: ProjectModel;
const PACKAGE = '@scenoco-three/box2d';

beforeAll(() => {
  fixture = makeFixture('package-tags', { box2d: true });
  fixture.write(
    'game.ts',
    `import { RigidBody2D } from '@scenoco-three/box2d';
import { Component } from '@scenoco-three/core';
import { Mesh } from 'three';

export class Ball extends Component<Mesh> {
  launchSpeed = 12;
  /** Built in \`awake\`. */
  seen!: WeakMap<object, number>;
}

export const used = RigidBody2D;
`,
  );
  model = Workspace.with(fixture.tsconfig, (w) => ({
    components: scanComponents(w, [PACKAGE]),
    systems: scanSystems(w, [PACKAGE]),
    effects: scanEffects(w, [PACKAGE]),
    tags: scanTags(w),
  }));
});

afterAll(() => fixture.dispose());

const byName = (list: ComponentInfo[], name: string) => list.find((c) => c.name === name);

describe('scanning a tag package', () => {
  it('finds its components alongside the project’s own', () => {
    expect(model.components.map((c) => c.name).sort()).toEqual([
      'Animator',
      'AttachTo',
      'Ball',
      'BoxCollider2D',
      'CameraFit',
      'CapsuleCollider2D',
      'ChainCollider2D',
      'CircleCollider2D',
      'EdgeCollider2D',
      'PolygonCollider2D',
      'RigidBody2D',
    ]);
  });

  it('finds its systems', () => {
    // `Tweens` is core's own — the clock a tween library runs on.
    expect(model.systems.map((s) => s.name).sort()).toEqual(['Physics2D', 'Tweens']);
  });

  it('leaves out the abstract base the shapes share', () => {
    // `Collider2D` is machinery, not a tag a document can write.
    expect(byName(model.components, 'Collider2D')).toBeUndefined();
  });

  it('reads defaults and doc comments from the package’s own source', () => {
    const radius = byName(model.components, 'CircleCollider2D')!.fields.find((f) => f.name === 'radius')!;
    expect(radius.default).toBe('0.5');
    expect(radius.description).toContain('Match it to the visible geometry');
    // Not required, because it has a default — which is only knowable from the initializer.
    expect(radius.required).toBe(false);
  });

  it('derives each field’s authoring shape from its declared type', () => {
    const rigidBody = byName(model.components, 'RigidBody2D')!;
    const field = (name: string) => rigidBody.fields.find((f) => f.name === name)!;
    expect(field('kind').shape).toBe('enum');
    // The checker normalises a literal union, so the order is its own, not the source's.
    expect(field('kind').options).toEqual(['"dynamic"', '"kinematic"', '"static"']);
    expect(field('bullet').shape).toBe('boolean');
    expect(field('gravityScale').shape).toBe('number');
    // The live planck body is a getter: state the component owns, which no document writes.
    expect(rigidBody.fields.some((f) => f.name === 'body')).toBe(false);

    const physics = byName(model.systems, 'Physics2D')!;
    expect(physics.fields.find((f) => f.name === 'gravity')!.shape).toBe('vector2');
  });

  it('inherits the shared material fields from the abstract base', () => {
    // A package puts what every shape has on a base and only the shape itself on each tag. A
    // scan that read own members alone would drop `friction` and the rest from every collider.
    const box = byName(model.components, 'BoxCollider2D')!;
    expect(box.extends).toBe('Collider2D');
    expect(box.fields.map((f) => f.name)).toEqual([
      'density',
      'friction',
      'restitution',
      'isSensor',
      'halfExtents',
    ]);
    expect(box.fields.find((f) => f.name === 'friction')!.default).toBe('0.3');
  });

  it('does not ask a document to supply what only the runtime can build', () => {
    // `seen!: WeakMap<…>` uses `!` because `awake` builds it, not because a document must. The
    // distinction is the type: an attribute cannot express a WeakMap, so requiring one would be
    // asking for something unwritable.
    const seen = byName(model.components, 'Ball')!.fields.find((f) => f.name === 'seen')!;
    expect(seen.shape).toBe('unsupported');
    expect(seen.required).toBe(false);

    // A node reference is the opposite case: `!` there does mean the document supplies it.
    const ball = byName(model.components, 'Ball');
    expect(ball).toBeTruthy();
  });
});

describe('a document that uses the package', () => {
  it('compiles a physics scene to real calls', () => {
    const xml = `<Scene>
  <Systems>
    <Physics2D gravity="x: 0; y: 0" velocityIterations="6" />
  </Systems>
  <Mesh id="ball" position="y: 1.1">
    <Components>
      <RigidBody2D kind="dynamic" bullet="true" gravityScale="0" />
      <CircleCollider2D radius="0.3" restitution="1" friction="0" />
    </Components>
  </Mesh>
</Scene>`;
    const parsed = parseDocument(xml, 'breakout.scene.xml');
    if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join('\n'));
    const { code, diagnostics } = emitGraph(parsed.root, {
      kind: 'scene',
      name: 'Breakout',
      source: 'breakout.scene.xml',
      model,
      resolveAsset: () => undefined,
    });

    expect(diagnostics).toEqual([]);
    expect(code).toContain(`from '@scenoco-three/box2d'`);
    expect(code).toContain('this.addSystem(Physics2D, { gravity: new Vector2(0, 0), velocityIterations: 6 });');
    expect(code).toContain(`this.ball.addComponent(RigidBody2D, { kind: 'dynamic', bullet: true, gravityScale: 0 });`);
    expect(code).toContain('this.ball.addComponent(CircleCollider2D, { radius: 0.3, restitution: 1, friction: 0 });');
  });

  it('rejects a body kind the type does not allow', () => {
    const parsed = parseDocument(
      `<Scene><Mesh id="m"><Components><RigidBody2D kind="floaty" /></Components></Mesh></Scene>`,
      'x.xml',
    );
    if (!parsed.ok) throw new Error('parse');
    const { diagnostics } = emitGraph(parsed.root, {
      kind: 'scene',
      name: 'X',
      source: 'x.xml',
      model,
      resolveAsset: () => undefined,
    });
    expect(diagnostics[0]?.code).toBe('bad-enum');
    expect(diagnostics[0]?.message).toContain('dynamic, kinematic, static');
  });
});

describe('two back-ends that share tag names', () => {
  it('is a build error naming both classes', () => {
    // `@scenoco-three/collision` is a drop-in for `@scenoco-three/rapier`: same tags, same
    // hooks, no dynamics. That is only safe because a project picks one — depending on both
    // would leave `<BoxCollider>` meaning two different things.
    const both = makeFixture('two-backends', { rapier: true, collision: true });
    try {
      both.write(
        'game.ts',
        `import { RigidBody } from '@scenoco-three/rapier';
import { Collision } from '@scenoco-three/collision';
export const used = [RigidBody, Collision];
`,
      );
      expect(() =>
        Workspace.with(both.tsconfig, (w) =>
          scanComponents(w, ['@scenoco-three/rapier', '@scenoco-three/collision']),
        ),
      ).toThrow(/is declared twice:.*rapier.*and.*collision/s);
    } finally {
      both.dispose();
    }
  }, 60_000);

  it('is fine on its own, either way round', () => {
    const only = makeFixture('one-backend', { rapier: true });
    try {
      only.write(
        'game.ts',
        `import { RigidBody } from '@scenoco-three/rapier';\nexport const used = RigidBody;\n`,
      );
      const found = Workspace.with(only.tsconfig, (w) =>
        scanComponents(w, ['@scenoco-three/rapier']),
      );
      expect(found.map((c) => c.name).sort()).toEqual([
        'Animator',
        'AttachTo',
        'BoxCollider',
        'CameraFit',
        'CapsuleCollider',
        'CylinderCollider',
        'PlaneCollider',
        'RigidBody',
        'SphereCollider',
      ]);
    } finally {
      only.dispose();
    }
  }, 60_000);
});
