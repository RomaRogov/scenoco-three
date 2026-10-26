# @scenoco-three/observer

**A SceNoCo game, driven from a test.** Part of [SceNoCo](https://github.com/RomaRogov/scenoco-three).

In development `play()` installs `window.__scenoco` in the page: hold and step the game clock, press
keys, click, swipe, wait for a condition, read behaviours by class. Any browser tool can call it by
evaluating in the page — `__scenoco.help()` lists it. This package is the same calls for a Playwright
or Puppeteer test:

```ts
import { observe } from '@scenoco-three/observer';

const game = await observe(page);
await game.press('Space');
expect((await game.until("GameState.phase === 'playing'")).met).toBe(true);
expect(await game.eval('return findAll(Brick).length')).toBe(19);
```

`Player.lane` reads the first live `Player`'s field; `#paddle` is the node named "paddle".
`view({ cameraPos, lookAt })` draws from another viewpoint for the page's own screenshot.
