import type { Camera, Scene, WebGLRenderer } from 'three';
import type { Reach, Runtime } from '../kernel/runtime.js';
import { setHeld } from '../observe.js';
import { devBar } from './page.js';
import { drawEditor, startEditor, type Editor } from './editor.js';
import { read, write, writeOpened } from './session.js';

/**
 * Development only: the editor over the running game. `play()` installs it when Vite serves the
 * page: a bar along the top with the frame rate and Edit, which opens the editor — pause, step,
 * reset, select, move, edit what the scene files wrote. Its interface is `@scenoco-three/editor`,
 * served by the project's `scenoco()` Vite plugin; it reaches the game through `EditHost`.
 */

export type { EditHost, OpenedScene, Transform } from './EditHost.js';
export { markSpawned, setField } from './editor.js';
export { sizeCanvas } from './page.js';
export { startOpenedScene } from './session.js';

/** @internal what `play()` calls each frame while the page is served in development. */
export interface EditHooks {
  /** Before a frame of the game runs. */
  beforeFrame(): void;
  /** After a frame of the game ran. */
  afterFrame(): void;
  /** After the game drew: the editor's own things, over it. */
  draw(camera: Camera): void;
}

/** @internal */
export function installEditor(scene: Scene, runtime: Runtime, renderer: WebGLRenderer, gameCamera: () => Camera | null, frame: (dt: number) => void): EditHooks {
  const state = read();
  let holdAfterFirst = state !== 'open' && state !== null;
  // A reset holds behaviours short of where it was asked to: from the very first wake, before the scene is built.
  if (holdAfterFirst) runtime.reach = state as Reach;
  let open: Promise<Editor> | null = null;

  const bar = devBar(() => start());
  const start = () => {
    bar.show(false);
    open ??= startEditor(scene, runtime, renderer, gameCamera, frame, () => {
      open = null;
      bar.show(true);
      write(null);
      // Closed, the page starts its own way again; the scene it is in plays on.
      writeOpened(null);
    }).catch((error: unknown) => {
      open = null;
      bar.show(true);
      console.error(error);
      throw error;
    });
    write('open');
  };
  if (state) start();
  else bar.show(true);

  return {
    beforeFrame() {
      // The reset's own frame is the held one; the next — played or stepped — goes on from there.
      if (!holdAfterFirst) runtime.reach = 'frame';
    },
    afterFrame() {
      if (!holdAfterFirst) return;
      holdAfterFirst = false;
      write('open');
      setHeld(runtime, true);
      void open?.then((editor) => editor.held());
    },
    draw: drawEditor,
  };
}
