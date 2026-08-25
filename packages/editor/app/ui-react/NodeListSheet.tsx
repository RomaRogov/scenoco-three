import { ClipboardPaste, Copy, Focus, Scissors, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { getDeps, useUI } from './store.js';
import { HeadBtn } from './HeadBtn.js';
import { Tree } from './Tree.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/**
 * The node list: a bottom sheet with the scene tree and an actions row —
 * **Focus** / **Open inspector** on the selection, the tree-edit actions
 * **Copy / Cut / Paste / Delete**, and close. Paste keys off the clipboard (read
 * on each refresh via `rev`); the rest need a selection.
 */
export function NodeListSheet(): React.JSX.Element | null {
  const open = useUI((s) => s.nodesOpen);
  const selected = useUI((s) => s.selected);
  useUI((s) => s.rev); // re-read clipboard state (Paste enablement) on refresh
  const openInspector = useUI((s) => s.openInspector);
  const closeNodes = useUI((s) => s.closeNodes);
  const { focusSelected, copy, cut, paste, remove, hasClipboard } = getDeps();
  if (!open) return null;

  return (
    <div className={cx(styles.sheet, styles.sheetNodes)}>
      <div className={styles.head}>
        <span className={styles.title}>Nodes</span>
        <div className={styles.actions}>
          <HeadBtn label="Focus selected" disabled={!selected} onClick={() => selected && focusSelected(selected)}>
            <Focus />
          </HeadBtn>
          <HeadBtn label="Open inspector" disabled={!selected} onClick={openInspector}>
            <SlidersHorizontal />
          </HeadBtn>
          <HeadBtn label="Copy" disabled={!selected} onClick={() => selected && copy(selected)}>
            <Copy />
          </HeadBtn>
          <HeadBtn label="Cut" disabled={!selected} onClick={() => selected && cut(selected)}>
            <Scissors />
          </HeadBtn>
          <HeadBtn label="Paste" disabled={!hasClipboard()} onClick={() => paste(selected)}>
            <ClipboardPaste />
          </HeadBtn>
          <HeadBtn label="Delete" disabled={!selected} onClick={() => selected && remove(selected)}>
            <Trash2 />
          </HeadBtn>
          <HeadBtn label="Close" onClick={closeNodes}>
            <X />
          </HeadBtn>
        </div>
      </div>
      <div className={styles.body}>
        <Tree />
      </div>
    </div>
  );
}
