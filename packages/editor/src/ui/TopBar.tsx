/** @jsxImportSource react */
import type { ReactNode } from 'react';
import { Axis3d, Focus, Globe, Move, Redo2, Rotate3d, Scaling, Undo2 } from 'lucide-react';
import { useController, useUI } from './store.js';
import { cx } from './parts.js';

/**
 * Gizmo mode, handle space, frame, undo and redo. It caps at the screen's width and scrolls
 * sideways rather than overflowing. There is no Save: every change is written as it is made.
 */
export function TopBar(): React.JSX.Element {
  useUI((s) => s.rev);
  const selected = useUI((s) => s.selected);
  const editor = useController();
  return (
    <div className="se-topbar">
      {/* The mode belongs to the editor, not the selection: choosing Rotate before picking what to
          rotate is the ordinary way round. */}
      <Btn label="Move (W)" onClick={() => editor.setMode('translate')} active={editor.mode === 'translate'}>
        <Move />
      </Btn>
      <Btn label="Rotate (E)" onClick={() => editor.setMode('rotate')} active={editor.mode === 'rotate'}>
        <Rotate3d />
      </Btn>
      <Btn label="Scale (R)" onClick={() => editor.setMode('scale')} active={editor.mode === 'scale'}>
        <Scaling />
      </Btn>
      <div className="se-sep" />
      <Btn
        label={editor.space === 'world' ? 'Handles: Global — switch to Local' : 'Handles: Local — switch to Global'}
        onClick={() => editor.setSpace(editor.space === 'world' ? 'local' : 'world')}
      >
        {editor.space === 'world' ? <Globe /> : <Axis3d />}
      </Btn>
      <Btn label="Frame the selection (F)" onClick={() => selected && editor.host.frame(selected)} disabled={!selected}>
        <Focus />
      </Btn>
      <div className="se-sep" />
      <Btn label="Undo (⌘Z / Ctrl+Z)" onClick={() => void editor.step(true)} disabled={!editor.canUndo}>
        <Undo2 />
      </Btn>
      <Btn label="Redo (⇧⌘Z / Ctrl+Y)" onClick={() => void editor.step(false)} disabled={!editor.canRedo}>
        <Redo2 />
      </Btn>
    </div>
  );
}

function Btn({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <button className={cx('se-tbtn', active && 'se-active')} title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
