import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getDeps, useUI, type AddTarget } from './store.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/** One offerable tag with the registry description shown beside it. */
interface Candidate {
  tag: string;
  description: string;
}

/**
 * The picker: a centred modal with a case-insensitive filter over name and description, for
 * adding a component to a node or filling one of the slots it is built from.
 *
 * What it offers comes from `ProjectModel`, which is read from the source — so a class is its own
 * registration.
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

  const candidates = useMemo(() => (adding ? offerings(adding) : []), [adding]);
  if (!adding) return null;

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? candidates.filter((c) => c.tag.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle))
    : candidates;

  const { getDoc } = getDeps();
  const add = (tag: string): void => {
    const doc = getDoc();
    // Building an attachment is asynchronous, so the inspector is told again once it is there.
    if (adding.kind === 'slot') void doc?.addAttachment(adding.node, tag).then(() => useUI.getState().bump());
    else doc?.addComponent(adding.node, tag);
    closeAdd();
    useUI.getState().bump(); // re-read the inspector against the new member
  };

  const label = adding.kind === 'slot' ? `Add ${adding.slot}` : 'Add component';
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

/**
 * What this node may still receive, read from the model: every component class the project
 * declares, or every tag of the family the slot accepts.
 *
 * The family test is the one the compiler makes when it decides which slot a written element
 * fills, so the picker cannot offer something the build would refuse.
 */
function offerings(target: AddTarget): Candidate[] {
  const model = getDeps().getModel();
  const found =
    target.kind === 'slot'
      ? (model?.tags ?? []).filter((t) => t.family === target.family)
      : (model?.components ?? []);
  return found
    .map((c) => ({ tag: c.name, description: c.description ?? '' }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
