import { ListTree } from 'lucide-react';
import { useUI } from './store.js';
import styles from './ui.module.css';

/** The small bottom-right button that opens the node list. Hidden while it's open. */
export function BottomLauncher(): React.JSX.Element | null {
  const nodesOpen = useUI((s) => s.nodesOpen);
  const openNodes = useUI((s) => s.openNodes);
  if (nodesOpen) return null;
  return (
    <button className={styles.launcher} title="Node list" aria-label="Node list" onClick={openNodes}>
      <ListTree />
    </button>
  );
}
