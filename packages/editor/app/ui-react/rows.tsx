import { useReducer, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PropInfo } from '@scenoco-three/compiler';
import { shownValue, widgetFor, type Scalar } from '../values.js';
import { BoolRow, ColorRow, EnumRow, EulerRow, LockRow, NumberRow, TextRow, VecRow } from './fields.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/**
 * The two rows both sheets are built from: one attribute, and one foldable group of them.
 *
 * Shared because the question they answer is the same wherever it is asked. A `.particle.xml` is
 * not a scene and has no nodes, but `startLifetime` is a number there for exactly the reason
 * `intensity` is a number on a light — the compiler read the declared type — so the widget that
 * edits one edits the other, and there is no second dispatch to keep in step.
 */
export const PREFAB_REASON = 'From another document — open it to edit this.';
export const TYPE_REASON = 'No attribute can express this type.';

/** Sections the user has folded away, by title. Module state: one editor per page. */
const closedSections = new Set<string>();
/** Sections already shown once, so `startClosed` folds them the first time and never again. */
const seenSections = new Set<string>();

/**
 * One attribute, dispatched by its **shape** — the single question the whole DSL rests on, and
 * the one the compiler already answered by reading the field's type. A field is a colour because
 * it is declared `Color`.
 */
export function PropRow({
  prop,
  written,
  editable,
  commit,
  clear,
}: {
  prop: PropInfo;
  written: string | undefined;
  editable: boolean;
  commit: (value: Scalar, opts?: { coalesce?: boolean }) => void;
  clear: () => void;
}): React.JSX.Element | null {
  const shape = widgetFor(prop);
  const value = shownValue(prop, written);
  const unset = written === undefined;
  const description = `${prop.description ?? prop.type}${unset ? '\n\nDefault — not written in the file.' : ''}`;
  const onClear = !unset && editable ? clear : undefined;

  if (shape === null) return <LockRow label={prop.name} value={String(value)} reason={TYPE_REASON} description={prop.description} />;
  // A locked row shows what the document writes, and nothing when it writes nothing: the class
  // default would look like a fact about a file that says no such thing.
  if (!editable) {
    return <LockRow label={prop.name} value={written ?? ''} reason={PREFAB_REASON} description={prop.description} />;
  }

  const common = { label: prop.name, description, unset, ...(onClear ? { onClear } : {}) };
  switch (shape) {
    case 'number':
      return <NumberRow {...common} value={value as number} commit={(v, c) => commit(v, c)} />;
    case 'boolean':
      return <BoolRow {...common} value={value as boolean} commit={(v) => commit(v)} />;
    case 'color':
      return <ColorRow {...common} value={value as number} commit={(v) => commit(v)} />;
    case 'vector2':
      return <VecRow {...common} value={value as number[]} labels={['x', 'y']} commit={(v, c) => commit(v, c)} />;
    case 'vector3':
    case 'vector4':
      return <VecRow {...common} value={value as number[]} commit={(v, c) => commit(v, c)} />;
    case 'euler':
      return <EulerRow {...common} value={value as number[]} commit={(v, c) => commit(v, c)} />;
    case 'enum':
      return (
        <EnumRow
          {...common}
          value={String(value)}
          options={(prop.options ?? []).map((o) => o.replace(/^['"]|['"]$/g, ''))}
          commit={(v) => commit(v)}
        />
      );
    default:
      // `string`, and the two reference shapes — a `#id` and an asset path are both text a
      // person types, and the compiler is what checks them.
      return <TextRow {...common} value={String(value)} commit={(v) => commit(v)} />;
  }
}

export function Section({
  title,
  description,
  actions,
  startClosed,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Folded on first sight — for the "…more" groups nobody opened deliberately. */
  startClosed?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const [, force] = useReducer((x: number) => x + 1, 0);
  if (startClosed && !seenSections.has(title)) {
    seenSections.add(title);
    closedSections.add(title);
  }
  const closed = closedSections.has(title);
  const toggle = (): void => {
    if (closed) closedSections.delete(title);
    else closedSections.add(title);
    force();
  };
  return (
    <div className={styles.section}>
      <div className={styles.secHead} onClick={toggle}>
        <span className={styles.secCaret}>{closed ? <ChevronRight /> : <ChevronDown />}</span>
        {title}
        {actions ? <span className={styles.secActions}>{actions}</span> : null}
        {description ? <span className={styles.secDesc}>{description}</span> : null}
      </div>
      {!closed && <div className={styles.secBody}>{children}</div>}
    </div>
  );
}
