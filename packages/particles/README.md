# @scenoco-three/particles

Particle systems for [SceNoCo](https://github.com/RomaRogov/scenoco-three), on
[three.quarks](https://github.com/Alchemist0823/three.quarks), in Unity Shuriken's module shape.

```bash
npm i @scenoco-three/particles
```

An effect is an **asset**, like a geometry or a material: one file, referenced by however many
emitters want it.

```xml
<!-- assets/vfx/fire.particle.xml -->
<ParticleSystem duration="3" startLifetime="1.6" startSpeed="4.5" startColor="#ffdd66">
  <Emission rateOverTime="90"><Burst time="0" count="10" /></Emission>
  <Shape type="Cone" radius="0.35" angle="14" />
  <ColorOverLifetime colors="[#ffee88, #ff6622, #661100]" />
  <SizeOverLifetime curve="[0.4, 1, 0.2]" />
</ParticleSystem>
```

```xml
<!-- and in a scene -->
<Group position="y: 1.2">
  <Components>
    <ParticleSystem effect="../vfx/fire.particle.xml" />
  </Components>
</Group>
```

## What's in it

| | |
| --- | --- |
| `ParticleSystem` | The component that plays one effect. Referenced by `effect="…"`, controlled from code like any component. |
| `ParticleRenderer` | The scene system that batches and steps them all. Registers itself. |

Modules mirror Unity's, and this is all of them: `<Emission>`, `<Burst>`, `<Shape>`,
`<Renderer>`, `<Noise>`, `<ColorOverLifetime>`, `<SizeOverLifetime>`, `<RotationOverLifetime>`.

**There is no second way to spell an effect.** No inline form on the component, no separate parser,
no schema file: the compiler reads `ParticleConfig`'s own TypeScript declaration to decide what a
document may say, so an attribute exists because a field does.

## License

[MIT](./LICENSE) · [Repository](https://github.com/RomaRogov/scenoco-three)
