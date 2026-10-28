# @scenoco-three/tools

What works on SceNoCo scene files rather than in the game.

```bash
npm install -D @scenoco-three/tools
scenoco check src        # every .tsx file is a scene, and a scene only declares
```

A scene may import, define constants of plain data, and export functions that make refs and return
TSX. Inside the TSX a value is a literal, a list or object of them, arithmetic on them
(`-Math.PI / 2`), or a name. Anything that runs — a loop, a branch, a handler, a call, a hook — is a
behaviour's job, in a `.ts` file, and each refusal says where and what to write instead. Types are
`tsc`'s job; a project's `check` script runs both: `tsc --noEmit && scenoco check src`.

The rule exists so a tool can edit a scene. `readScene`, `setAttribute`, `insertChild`,
`removeElement` and friends read a scene file without running it and write by splicing exactly the
text that changed — everything else, comments and layout included, stays byte for byte. Elements are
found by the line and column the runtime's `sourceOf` reports, so a picked object leads to its tag.

`@scenoco-three/tools/vite` is the project's Vite plugin, `scenoco()`: TSX through core's runtime and,
while serving, [the editor](../editor) with the endpoints it reads and writes scene files through.
