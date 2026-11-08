/** @jsxImportSource react */
/**
 * The bar along the top — play, step, reset, undo, save, settings — the scene picker, and prefab
 * mode's bar.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Focus, PanelsTopLeft, Pause, Play, Redo2, RotateCcw, Save, Settings, StepForward, Undo2, X } from 'lucide-react';
import type { Model } from '../model/Model.js';

export function Toolbar({ model, settings, toggleSettings }: { model: Model; settings: boolean; toggleSettings: () => void }): React.JSX.Element {
  const { host } = model;
  // The page's own HTML — its HUD — starts hidden: the editor is for the 3D. The switch brings it back.
  const [html, setHtml] = useState(false);
  const toggleHtml = () => setHtml(!html);
  useEffect(() => {
    document.body.classList.toggle('scenoco-canvas-only', !html);
    return () => document.body.classList.remove('scenoco-canvas-only');
  }, [html]);
  return (
    <div className="se-bar">
      {host.paused ? (
        <Button title="Play" onClick={() => host.play()}>
          <Play />
        </Button>
      ) : (
        <Button title="Pause: look around with the editor's camera" onClick={() => host.pause()}>
          <Pause />
        </Button>
      )}
      <Button title="One frame" onClick={() => host.step()}>
        <StepForward />
      </Button>
      <Button title="Reset: load the page again and hold its first frame" onClick={() => leave(model) && host.reset(model.resetReach)}>
        <RotateCcw />
      </Button>
      <Button title={html ? "Hide the page's HTML: only the game's canvas" : "Show the page's HTML again"} pressed={!html} onClick={toggleHtml}>
        <PanelsTopLeft />
      </Button>
      <span className="se-gap" />
      <Button title="Undo (⌘Z)" disabled={!model.canUndo} onClick={() => model.undo()}>
        <Undo2 />
      </Button>
      <Button title="Redo (⇧⌘Z)" disabled={!model.canRedo} onClick={() => model.redo()}>
        <Redo2 />
      </Button>
      <span className="se-gap" />
      <Button
        title={model.unsavedCount ? `Save ${model.unsavedCount} unsaved ${model.unsavedCount === 1 ? 'change' : 'changes'} into the scene files (⌘S)` : 'Nothing to save'}
        disabled={!model.unsavedCount}
        onClick={() => void model.save()}
      >
        <Save />
        {model.unsavedCount > 0 && <span className="se-badge" />}
      </Button>
      <span className="se-fill" />
      <Button title="Settings" pressed={settings} onClick={toggleSettings}>
        <Settings />
      </Button>
      <Button title="Close the editor" onClick={() => leave(model) && host.close()}>
        <X />
      </Button>
    </div>
  );
}

/**
 * Which scene the page starts in — Unity's open scene. Picking one loads the page again in it, held
 * as a reset holds it; "as the game starts" goes back to the game's own first scene.
 */
export function ScenePicker({ model }: { model: Model }): React.JSX.Element | null {
  const { host } = model;
  if (model.scenes.length === 0) return null;
  const key = (s: { file: string; name: string } | null) => (s ? `${s.file}#${s.name}` : '');
  const open = host.openedScene;
  return (
    <label className="se-scenes">
      <span>Scene</span>
      <select
        value={key(open)}
        onChange={(event) => {
          const picked = model.scenes.find((s) => key(s) === event.currentTarget.value) ?? null;
          if (leave(model)) host.openScene(picked, model.resetReach);
          else event.currentTarget.value = key(open);
        }}
      >
        <option value="">as the game starts</option>
        {model.scenes.map((s) => (
          <option key={key(s)} value={key(s)}>
            {s.name} — {s.file.replace(/^\//, '')}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Prefab mode: what is being edited, where it is written, and the way back. */
export function StageBar({ model }: { model: Model }): React.JSX.Element {
  const stage = model.stage!;
  const file = stage.file.split('/').pop();
  return (
    <div className="se-stage">
      <button className="se-button" title="Back to the scene" aria-label="Back to the scene" onClick={() => model.leave()}>
        <ArrowLeft />
      </button>
      <span className="se-crumbs">
        Scene › <b>{`<${stage.name}>`}</b>
        <small>
          changes go to {file} and every {`<${stage.name}>`}
          {stage.count > 1 ? ` — ${stage.count} in this scene` : ''}
        </small>
      </span>
      <button className={model.isolated ? 'se-button se-pressed' : 'se-button'} title="Isolate: only this prefab" aria-pressed={model.isolated} onClick={() => model.isolate(!model.isolated)}>
        <Focus />
      </button>
    </div>
  );
}

/** Unsaved changes are lost by leaving: ask first. */
function leave(model: Model): boolean {
  const n = model.unsavedCount;
  if (n && !confirm(`${n} unsaved ${n === 1 ? 'change' : 'changes'} will be lost. Leave anyway?`)) return false;
  model.discard(); // asked once: the page's own leave prompt would ask again
  return true;
}

function Button({ title, disabled, pressed, onClick, children }: { title: string; disabled?: boolean; pressed?: boolean; onClick: () => void; children: ReactNode }): React.JSX.Element {
  return (
    <button className={pressed ? 'se-button se-pressed' : 'se-button'} title={title} aria-label={title} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
