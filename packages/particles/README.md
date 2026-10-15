# @scenoco-three/particles

Particle effects on [three.quarks](https://github.com/Alchemist0823/three.quarks), in Unity's
Shuriken shape. Part of [SceNoCo](https://github.com/RomaRogov/scenoco-three).

```ts
// vfx.ts — an effect is data
export const fire: ParticleEffect = {
  duration: 3, startLifetime: 1.6, startSpeed: 4.5, startColor: new Color('#ffdd66'),
  emission: { rateOverTime: 90, bursts: [{ time: 0, count: 10 }] },
  shape: { type: 'Cone', radius: 0.35, angle: 14 },
  colorOverLifetime: { colors: [new Color('#ffee88'), new Color('#661100')] },
};
```

```tsx
<Group position={[0, 1.2, 0]}>
  <ParticleSystem effect={vfx.fire} />
</Group>
```

`ParticleEffect` is Unity's modules as one typed object — main settings, `emission`, `shape`,
`renderer`, `noise`, `colorOverLifetime`, `sizeOverLifetime`, `rotationOverLifetime` — every field
optional; angles in degrees. `ParticleSystem` plays it: `play()`, `pause()`, `stop()`, `isPlaying`,
`playOnAwake`; disabling it pauses. Every emitter in a scene is drawn through one batch.
