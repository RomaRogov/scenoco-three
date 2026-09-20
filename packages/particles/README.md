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
<ParticleEffect duration="3" startLifetime="1.6" startSpeed="4.5" startColor="#ffdd66">
  <Emission rateOverTime="90"><Burst time="0" count="10" /></Emission>
  <Shape type="Cone" radius="0.35" angle="14" />
  <ColorOverLifetime colors="[#ffee88, #ff6622, #661100]" />
  <SizeOverLifetime curve="[0.4, 1, 0.2]" />
</ParticleEffect>
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
| `ParticleSystem` | The component that plays one effect — named by `effect="…"` or written inside it, and controlled from code like any component. |
| `ParticleRenderer` | The scene system that batches and steps them all. Registers itself. |

Modules mirror Unity's, and this is all of them: `<Emission>`, `<Burst>`, `<Shape>`,
`<Renderer>`, `<Noise>`, `<ColorOverLifetime>`, `<SizeOverLifetime>`, `<RotationOverLifetime>`.

An effect has the two forms every shared thing in the DSL has. A **path** names a `.particle.xml`
that every emitter pointing at it shares; an **element** written inside the component gives that one
emitter its own:

```xml
<ParticleSystem>
  <ParticleEffect duration="3" startSize="0.4">
    <Emission rateOverTime="20" />
  </ParticleEffect>
</ParticleSystem>
```

The text is identical either way, so the two are cut-and-paste in either direction. Write the file
when more than one emitter wants the effect.

**And there is no parser, no schema file, and nothing about particles anywhere in the toolchain.**
This package's own `package.json` says a `.particle.xml` is a `ParticleEffect`; the compiler reads
that type's declaration and the document follows from it — an attribute exists because a field does,
and an element exists because a field holds a named type (`emission?: Emission` is `<Emission>`,
`bursts?: Burst[]` is `<Burst>` written as often as you like). See [MODULES.md](../../MODULES.md).

## License

[MIT](./LICENSE) · [Repository](https://github.com/RomaRogov/scenoco-three)
