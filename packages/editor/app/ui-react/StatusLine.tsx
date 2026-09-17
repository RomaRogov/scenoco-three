import { getDeps, useUI } from './store.js';
import styles from './ui.module.css';

/**
 * The one line the editor says things on: a save, or why one was refused, or why a preview is not
 * there.
 *
 * It exists because the messages did not. `report()` has always set a status the toolbar's state
 * carried, and nothing ever rendered it — so a refused save and a preview that failed to rebuild
 * were both silent, and the only evidence was something missing from the screen.
 *
 * Under the toolbar rather than in it: the toolbar is a strip of icons that scrolls sideways on a
 * phone, and a sentence does not belong in it.
 */
export function StatusLine(): React.JSX.Element | null {
  useUI((s) => s.rev);
  const status = getDeps().handlers.state().status;
  if (!status) return null;
  return (
    <div className={styles.status} role="status">
      {status}
    </div>
  );
}
