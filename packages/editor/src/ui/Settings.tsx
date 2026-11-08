/** @jsxImportSource react */
/** The editor's settings, in a window over it: what Reset runs, and where source links open. */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Reach } from '@scenoco-three/core';
import { type CodeEditor, type Model } from '../model/Model.js';
import { Code } from './Inspector.js';

const CODE_EDITORS: { how: CodeEditor; label: string; note: string }[] = [
  { how: 'auto', label: 'Automatic', note: 'the editor that is running, or $LAUNCH_EDITOR' },
  { how: 'system', label: 'Default app for .tsx', note: "the system's choice, without the line" },
  { how: 'vscode', label: 'VS Code', note: 'its vscode:// link' },
  { how: 'cursor', label: 'Cursor', note: 'its cursor:// link' },
  { how: 'custom', label: 'Project command', note: '' },
];

/** The lifecycle in order: each hook runs only after the ones before it, so a box needs the boxes above. */
const HOOKS: { reach: Exclude<Reach, 'none'>; label: string; note: string }[] = [
  { reach: 'awake', label: 'awake', note: 'every behaviour, as its node is built' },
  { reach: 'onEnable', label: 'onEnable', note: 'then each enabled one' },
  { reach: 'start', label: 'start', note: 'then before the first frame' },
  { reach: 'frame', label: 'One frame', note: 'fixedUpdate, update, lateUpdate' },
];

const ORDER: readonly Reach[] = ['none', ...HOOKS.map((h) => h.reach)];

/** The editor's settings, in a window of their own over it. */
export function SettingsPopup({ model, close }: { model: Model; close: () => void }): React.JSX.Element {
  const [custom, setCustom] = useState<string | null | undefined>(undefined);
  useEffect(() => void model.customCommand().then(setCustom), [model]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && (event.stopPropagation(), close());
    addEventListener('keydown', escape, true);
    return () => removeEventListener('keydown', escape, true);
  }, [close]);
  const reach = ORDER.indexOf(model.resetReach);
  const chosen = model.codeEditor;
  return (
    <div className="se-backdrop" onClick={(event) => event.target === event.currentTarget && close()}>
      <div className="se-popup" role="dialog" aria-modal="true" aria-label="Editor settings">
        <div className="se-popupHead">
          <span>Settings</span>
          <button className="se-button" title="Close settings" aria-label="Close settings" onClick={close}>
            <X />
          </button>
        </div>
        <section>
          <h3>Reset runs</h3>
          <p>What behaviours do before the scene is held. Nothing ticked: the scene just as the files build it.</p>
          {HOOKS.map((hook, i) => (
            <label key={hook.reach} className="se-choice">
              <input
                type="checkbox"
                checked={reach > i}
                onChange={(event) => (model.resetReach = ORDER[event.currentTarget.checked ? i + 1 : i]!)}
              />
              <span>
                <code>{hook.label}</code>
                <small>{hook.note}</small>
              </span>
            </label>
          ))}
        </section>
        <section>
          <h3>Source links open in</h3>
          {CODE_EDITORS.map(({ how, label, note }) => (
            <label key={how} className="se-choice">
              <input type="radio" name="se-code-editor" checked={chosen === how} onChange={() => (model.codeEditor = how)} />
              <span>
                {label}
                <small>
                  {how !== 'custom' ? note : custom ? <code>{custom}</code> : custom === null ? "set scenoco({ editor: 'zed {file}:{line}:{col}' }) in vite.config" : '…'}
                </small>
              </span>
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}
