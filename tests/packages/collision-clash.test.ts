import { describe, expect, it } from 'vitest';

// The collision colliders share their tag names with rapier's on purpose: a
// project must pick one engine. Importing both registers the same component name
// twice, which the registry rejects — enforcing the choice at load time. This
// lives in its own file so `@scenoco-three/collision` isn't already imported.
describe('collision ⇄ rapier mutual exclusion', () => {
  it('importing both packages throws a duplicate-registration error', async () => {
    await import('@scenoco-three/rapier'); // registers BoxCollider, SphereCollider, …
    await expect(import('@scenoco-three/collision')).rejects.toThrow(/already registered/i);
  });
});
