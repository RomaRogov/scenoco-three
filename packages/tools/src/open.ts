/**
 * Open a project file in the developer's code editor, at a line — what the editor's source links
 * ask the dev server for. Three ways, as Unity and Godot offer them:
 *
 * - `auto` — the editor that is running, or `LAUNCH_EDITOR` / `VISUAL` / `EDITOR`: what Vite's own
 *   `/__open-in-editor` does (`launch-editor`), but saying why when it cannot.
 * - `system` — the operating system's app for the file's type, as Unity's "Open by file extension":
 *   no line, but nothing to set up.
 * - `custom` — a command with `{file}`, `{line}`, `{col}` and `{project}` in it, as Godot's exec
 *   flags: `zed {file}:{line}:{col}`. Set in the project's `vite.config` — `scenoco({ editor })` —
 *   or `SCENOCO_EDITOR`, never by the page: a page that could name the command could run anything.
 *
 * Editors with a URL scheme (`vscode://file/…`) are opened by the page itself, with no server.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import launchEditor from 'launch-editor';

export type OpenHow = 'auto' | 'system' | 'custom';

/** The custom command the project set, if it set one. */
export function customEditor(configured: string | undefined): string | null {
  return configured ?? process.env.SCENOCO_EDITOR ?? null;
}

/** Opens `file` at `line`:`col`; rejects with what went wrong, said so a person can fix it. */
export function openFile(root: string, file: string, line: number, col: number, how: OpenHow, custom: string | null): Promise<void> {
  const inside = relative(root, file);
  if (!isAbsolute(file) || inside.startsWith('..') || isAbsolute(inside)) return Promise.reject(new Error(`${file} is not a file of this project`));
  if (!existsSync(file)) return Promise.reject(new Error(`${inside} does not exist`));
  if (how === 'system') return settle(spawn(...systemOpener(file)), 'the system opener');
  if (how === 'custom') {
    if (!custom) return Promise.reject(new Error("no custom command: set scenoco({ editor: 'zed {file}:{line}:{col}' }) in vite.config, or SCENOCO_EDITOR"));
    const [command, ...args] = words(custom).map((w) => w.replace(/\{file\}/g, file).replace(/\{line\}/g, String(line)).replace(/\{col\}/g, String(col)).replace(/\{project\}/g, root));
    if (!command) return Promise.reject(new Error('the custom command is empty'));
    return settle(spawn(command, args, { stdio: 'ignore' }), command);
  }
  return new Promise((done, fail) => {
    // It says nothing when the editor starts, only when it cannot: no news for a moment is good news.
    const quiet = setTimeout(done, 700);
    launchEditor(`${file}:${line}:${col}`, (_name: string, message: string | null) => {
      clearTimeout(quiet);
      fail(
        new Error(
          message
            ? `${message.replace(/\.$/, '')} — open the editor settings (⚙) to pick another way`
            : 'no code editor found: none of the known ones is running, and LAUNCH_EDITOR is not set — open the editor settings (⚙) to pick another way',
        ),
      );
    });
  });
}

function systemOpener(file: string): [string, string[]] {
  if (process.platform === 'darwin') return ['open', [file]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '""', file]];
  return ['xdg-open', [file]];
}

/** A command that started, and either finished well or is still running a moment later. */
function settle(child: ChildProcess, name: string): Promise<void> {
  return new Promise((done, fail) => {
    const quiet = setTimeout(done, 1500);
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(quiet);
      fail(new Error(error.code === 'ENOENT' ? `'${name}' is not a command on the dev server's PATH` : error.message));
    });
    child.on('exit', (code) => {
      clearTimeout(quiet);
      if (code) fail(new Error(`${name} exited with code ${code}`));
      else done();
    });
  });
}

/** A command line in words: spaces split it, quotes keep a path with spaces whole. */
function words(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}
