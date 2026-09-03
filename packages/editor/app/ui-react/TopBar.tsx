import type { ReactNode } from 'react';
import { Axis3d, Globe, Move, PanelTop, Redo2, Rotate3d, Save, Scaling, Undo2 } from 'lucide-react';
import { getDeps, useUI } from './store.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/**
 * One responsive toolbar: gizmo mode (move/rotate/scale), the two view switches, undo/redo, and
 * save. Fits any width — it caps at the viewport and scrolls horizontally rather than
 * overflowing (see `.topbar`).
 *
 * There is no transport. This editor edits documents; nothing in it runs, because behaviour is
 * a project's TypeScript and this page has none.
 */
export function TopBar(): React.JSX.Element {
  useUI((s) => s.rev); // re-read handler state on every refresh
  const { handlers } = getDeps();
  const s = handlers.state();
  const mode = handlers.getMode();
  const space = handlers.getSpace();
  const showUi = handlers.getShowUi();

  return (
    <div className={styles.topbar}>
        {/* Always live. The mode is a property of the editor, not of the selection: choosing
            Rotate before picking what to rotate is the ordinary way round, and a mode you can
            only set once something is selected makes the first click of every session fail. */}
        <TBtn label="Move (G)" onClick={() => handlers.setMode('translate')} active={mode === 'translate'}>
          <Move />
        </TBtn>
        <TBtn label="Rotate (R)" onClick={() => handlers.setMode('rotate')} active={mode === 'rotate'}>
          <Rotate3d />
        </TBtn>
        <TBtn label="Scale (Y)" onClick={() => handlers.setMode('scale')} active={mode === 'scale'}>
          <Scaling />
        </TBtn>
        <div className={styles.sep} />
        <TBtn
          label={space === 'world' ? 'Handles: World — switch to Local' : 'Handles: Local — switch to World'}
          onClick={() => handlers.setSpace(space === 'world' ? 'local' : 'world')}
        >
          {space === 'world' ? <Globe /> : <Axis3d />}
        </TBtn>
        <TBtn
          label={showUi ? 'Hide the scene’s UI' : 'Show the scene’s UI'}
          onClick={() => handlers.setShowUi(!showUi)}
          active={showUi}
        >
          <PanelTop />
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
