import { playInWorklet } from './sound/worklet.js';
import { songProgram } from './song.js';

// The music, played on the audio thread: Music posts it where the game is.
playInWorklet('song', songProgram);
