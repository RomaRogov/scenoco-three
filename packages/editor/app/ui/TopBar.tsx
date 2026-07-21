import type { ReactNode } from 'react';
import { Move, Pause, Play, Redo2, Rotate3d, Save, Scaling, Square, StepForward, Undo2 } from 'lucide-react';
import { getDeps, useUI } from './store.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/**
 * One responsive toolbar: transport (play/pause/step/stop), gizmo mode
 * (move/rotate/scale), undo/redo, and save. Fits any width — it caps at the
 * viewport and scrolls horizontally rather than overflowing (see `.topbar`). The
 * edit controls are hidden during play, as there's no editing while the sim runs.
 */
export function TopBar(): React.JSX.Element {
  useUI((s) => s.rev); // re-read handler state on every refresh
  const { handlers } = getDeps();
  const s = handlers.state();
  const editing = s.mode === 'edit';
  const paused = s.mode === 'play' && !s.playing;
  const mode = handlers.getMode();

  return (
    <div className={styles.topbar}>
      <TBtn label="Play" onClick={() => handlers.play()} disabled={s.playing} active={s.playing}>
        <Play />
      </TBtn>
      <TBtn label="Pause" onClick={() => handlers.pause()} disabled={!s.playing}>
        <Pause />
      </TBtn>
      <TBtn label="Step one frame" onClick={() => handlers.step()} disabled={!paused}>
        <StepForward />
      </TBtn>
      <TBtn label="Stop" onClick={() => handlers.stop()} disabled={editing}>
        <Square />
      </TBtn>

      {editing && (
        <>
          <div className={styles.sep} />
          <TBtn label="Move (G)" onClick={() => handlers.setMode('translate')} active={mode === 'translate'} disabled={!s.enabled}>
            <Move />
          </TBtn>
          <TBtn label="Rotate (R)" onClick={() => handlers.setMode('rotate')} active={mode === 'rotate'} disabled={!s.enabled}>
            <Rotate3d />
          </TBtn>
          <TBtn label="Scale (Y)" onClick={() => handlers.setMode('scale')} active={mode === 'scale'} disabled={!s.enabled}>
            <Scaling />
          </TBtn>
          <div className={styles.sep} />
          <TBtn label="Undo" onClick={() => handlers.undo()} disabled={!s.canUndo}>
            <Undo2 />
          </TBtn>
          <TBtn label="Redo" onClick={() => handlers.redo()} disabled={!s.canRedo}>
            <Redo2 />
          </TBtn>
          <div className={styles.sep} />
          <TBtn
            label="Save"
            onClick={() => handlers.save()}
            disabled={!s.dirty || s.saving}
            className={cx(styles.save, s.dirty && styles.dirty, s.saving && styles.saving)}
          >
            <Save />
          </TBtn>
        </>
      )}
    </div>
  );
}

function TBtn({
  label,
  onClick,
  disabled,
  active,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      className={cx(styles.tbtn, active && styles.active, className)}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
