import { ListTree } from 'lucide-react';
import { getDeps, useUI } from './store.js';
import styles from './ui.module.css';

/**
 * The small bottom-right button that opens the node list. Hidden while it's open — and while a
 * config document is, because that kind of document has no nodes to list.
 */
export function BottomLauncher(): React.JSX.Element | null {
  const nodesOpen = useUI((s) => s.nodesOpen);
  useUI((s) => s.rev);
  const openNodes = useUI((s) => s.openNodes);
  if (nodesOpen || getDeps().getConfig()) return null;
  return (
    <button className={styles.launcher} title="Node list" aria-label="Node list" onClick={openNodes}>
      <ListTree />
    </button>
  );
}
