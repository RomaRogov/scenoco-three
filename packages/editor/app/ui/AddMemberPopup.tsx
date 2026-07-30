import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Registry, attachmentsForNode, componentAcceptsNode, getAttachmentDef, getNodeDef } from '@scenoco-three/core';
import { getDeps, useUI } from './store.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/** One offerable tag with the registry description shown beside it. */
interface Candidate {
  tag: string;
  description: string;
}

/**
 * The "add component / add attachment" picker: a centred modal with a
 * case-insensitive filter over tag and description.
 *
 * The two entry points differ only in what they offer:
 *  - **attachments** — `attachmentsForNode` (the registry's subclass-aware target
 *    check, the same one the XSD uses), minus any family whose `unique` slot the
 *    node has already filled, so you can't add a second geometry.
 *  - **components** — every registered component, minus any that declares a
 *    `static target` this node does not satisfy. Almost none do: like a
 *    MonoBehaviour on a GameObject, a component works on any node, and the
 *    constraint exists only for the rare one that reads a host-specific member.
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

  const candidates = useMemo(() => (adding ? offerings(adding.kind, adding.node) : []), [adding]);
  if (!adding) return null;

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? candidates.filter((c) => c.tag.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle))
    : candidates;

  const { getDoc } = getDeps();
  const add = (tag: string): void => {
    const doc = getDoc();
    if (adding.kind === 'component') doc?.addComponent(adding.node, tag);
    else doc?.addAttachment(adding.node, tag);
    closeAdd();
    useUI.getState().bump(); // re-read the inspector against the new member
  };

  const label = adding.kind === 'component' ? 'Add component' : 'Add attachment';
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
                ? `This node accepts no further ${adding.kind === 'component' ? 'components' : 'attachments'}.`
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
function offerings(kind: 'component' | 'attachment', node: import('three').Object3D): Candidate[] {
  const def = getNodeDef(node.sceneTag ?? '');
  if (kind === 'component') {
    return Registry.componentNames()
      .map((name) => ({ name, meta: Registry.getComponent(name)?.meta }))
      // Almost every component is unconstrained and offered everywhere; one that
      // declares `static target` is hidden on nodes it cannot work on.
      .filter(({ meta }) => meta !== undefined && (def === undefined || componentAcceptsNode(meta.target, def)))
      .map(({ name, meta }) => ({ tag: name, description: meta!.description }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }
  if (!def) return [];
  // A `unique` family already present on the node is not offered again.
  const taken = new Set(
    (getDeps().getDoc()?.attachmentsOf(node) ?? [])
      .map((v) => getAttachmentDef(v.tag))
      .filter((d) => d?.unique)
      .map((d) => d!.group),
  );
  return attachmentsForNode(def)
    .filter((d) => !(d.unique && taken.has(d.group)))
    .map((d) => ({ tag: d.tag, description: d.description }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
