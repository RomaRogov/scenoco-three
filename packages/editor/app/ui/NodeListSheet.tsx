import { Focus, SlidersHorizontal, X } from 'lucide-react';
import { getDeps, useUI } from './store.js';
import { HeadBtn } from './HeadBtn.js';
import { Tree } from './Tree.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/**
 * The node list: a bottom sheet with the scene tree and an actions row. The
 * actions are the requested extension point — for now **Focus selected** (reframe
 * the camera) and **Open inspector**, both enabled once a node is selected.
 */
export function NodeListSheet(): React.JSX.Element | null {
  const open = useUI((s) => s.nodesOpen);
  const selected = useUI((s) => s.selected);
  const openInspector = useUI((s) => s.openInspector);
  const closeNodes = useUI((s) => s.closeNodes);
  const { focusSelected } = getDeps();
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
