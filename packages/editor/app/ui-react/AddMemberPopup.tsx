import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getDeps, useUI } from './store.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/** One offerable tag with the registry description shown beside it. */
interface Candidate {
  tag: string;
  description: string;
}

/**
 * The "add component" picker: a centred modal with a case-insensitive filter over name and
 * description.
 *
 * What it offers is every component class the project declares, read from `ProjectModel` — which
 * is read from the source, so a class is its own registration.
 */
export function AddMemberPopup(): React.JSX.Element | null {
  const adding = useUI((s) => s.adding);
  const closeAdd = useUI((s) => s.closeAdd);
  useUI((s) => s.rev);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // Reopening for a different target starts from an empty filter.
  useEffect(() => {
    if (adding) {
      setQuery('');
      input.current?.focus();
    }
  }, [adding]);

  const candidates = useMemo(() => (adding ? offerings() : []), [adding]);
  if (!adding) return null;

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? candidates.filter((c) => c.tag.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle))
    : candidates;

  const { getDoc } = getDeps();
  const add = (tag: string): void => {
    getDoc()?.addComponent(adding, tag);
    closeAdd();
    useUI.getState().bump(); // re-read the inspector against the new member
  };

  const label = 'Add component';
  return (
    // Clicking the backdrop dismisses; clicks inside must not bubble to it.
    <div className={styles.modalBackdrop} onClick={closeAdd}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <span className={styles.title}>{label}</span>
          <button type="button" className={styles.clearBtn} title="Close" aria-label="Close" onClick={closeAdd}>
            <X />
          </button>
        </div>
        <input
          ref={input}
          type="text"
          className={cx(styles.input, styles.modalFilter)}
          placeholder="Filter…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeAdd();
            // Enter commits the only remaining match — the fast path once you've typed.
            if (e.key === 'Enter' && matches.length === 1) add(matches[0]!.tag);
          }}
        />
        <div className={styles.modalList}>
          {matches.length === 0 ? (
            <div className={styles.empty}>
              {candidates.length === 0
                ? 'This project declares no components yet.'
                : 'Nothing matches that filter.'}
            </div>
          ) : (
            matches.map((c) => (
              <button key={c.tag} type="button" className={styles.modalItem} onClick={() => add(c.tag)}>
                <span className={styles.modalItemTag}>{c.tag}</span>
                <span className={styles.modalItemDesc}>{c.description}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** What this node may still receive, straight from the registry. */
/**
 * Every component the project declares.
 *
 * A component with a `requiresNode` — `class Flicker extends Component<PointLight>` — is only
 * offered on a node it can actually work on. Almost none declare one: like a MonoBehaviour on a
 * GameObject, a component goes on anything, and the constraint exists for the rare one that
 * reads a host-specific member.
 */
function offerings(): Candidate[] {
  const model = getDeps().getModel();
  return (model?.components ?? [])
    .map((c) => ({ tag: c.name, description: c.description ?? '' }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
