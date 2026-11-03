# @scenoco-three/postprocessing

Post effects, spelled the way URP spells them, on three.js's `EffectComposer`. Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```tsx
<Group name="Look">
  <Volume />
  <Bloom intensity={0.55} threshold={1} scatter={0.4} />
  <Tonemapping mode="ACES" />
  <ColorAdjustments postExposure={0.14} saturation={10} />
  <Vignette intensity={0.3} />
</Group>
```

- `Volume` holds the effects on its node. `priority` decides between Volumes: per effect, the highest
  active Volume that has it wins. Put one in a scene kept with `dontDestroyOnLoad`, or one in each level.
- `Bloom`, `Tonemapping`, `ColorAdjustments`, `Vignette`, `DepthOfField`, `ChromaticAberration`, `FilmGrain`:
  fields as in URP, read every frame, so they can be tweened. `enabled = false` drops one, which is how
  a game gives up its costliest looks on a slow device.
- Replaces `game.render` while a Volume is active. Under `simulate` there is no renderer and it does nothing.
