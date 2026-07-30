import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Lock, X } from 'lucide-react';
import type { EnumDef } from '@scenoco-three/core';
import { fmtNum } from './format.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

// React inspector field widgets (one per value shape). Each owns local editing
// state and commits through the caller's `commit` closure (which routes to the
// live SceneDocument). Ported from the old vanilla fields.ts, scrub logic intact.

type Commit = (value: number, opts?: { coalesce?: boolean }) => void;

/**
 * Every row accepts the registry `description` of the thing it edits and shows it
 * as the row's tooltip. Descriptions are mandatory on `@property`/`@node`/
 * `@attachment`, so this surfaces documentation the codebase already guarantees.
 */
type Described<T> = T & {
  description?: string;
  /** The value is not written in the source — render it as a placeholder, not a value. */
  unset?: boolean;
  /** Present only for a clearable (source-written) attribute; renders the × button. */
  onClear?: () => void;
};

/** Removes an attribute from the source. Only rendered when the value is actually written. */
function ClearBtn({ onClear }: { onClear: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.clearBtn}
      title="Clear — remove this attribute from the file"
      aria-label="Clear value"
      onClick={onClear}
    >
      <X />
    </button>
  );
}

/** A read-only label/value row (purely informational — no "disabled" affordance). */
export function ReadRow({ label, value, description, unset }: Described<{ label: string; value: string }>): React.JSX.Element {
  return (
    <div className={cx(styles.row, unset && styles.unsetRow)} title={description}>
      <span className={styles.k}>{label}</span>
      <span className={styles.v}>{value}</span>
    </div>
  );
}

/**
 * A read-only row for a value that *would* be editable but is disabled — decorated
 * with a lock and a `reason` tooltip so it reads as intentionally locked (prefab
 * content, a `src`-loaded asset, or a value type the inspector can't edit yet)
 * rather than a plain fact.
 */
export function LockRow({ label, value, reason, description, unset }: Described<{ label: string; value: string; reason: string }>): React.JSX.Element {
  return (
    <div className={cx(styles.row, styles.locked)} title={description ? `${description}\n\n${reason}` : reason}>
      <span className={styles.k}>{label}</span>
      <span className={styles.v}>
        <Lock className={styles.lockIcon} aria-label={reason} />
        <span className={styles.lockVal}>{value}</span>
      </span>
    </div>
  );
}

/** A standalone scalar (no scrub handle). */
export function NumberRow({
  label,
  value,
  commit,
  int,
  description,
  unset,
  onClear,
}: Described<{
  label: string;
  value: number;
  commit: (v: number) => void;
  int?: boolean;
}>): React.JSX.Element {
  const [text, setText] = useState(() => fmtNum(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtNum(value));
  }, [value]);
  const doCommit = (): void => {
    if (text === fmtNum(value)) return; // untouched — never write on a bare focus/blur
    const v = parseFloat(text);
    if (Number.isFinite(v)) commit(int ? Math.round(v) : v);
    else setText(fmtNum(value));
  };
  return (
    <div className={cx(styles.row, unset && styles.unsetRow)} title={description}>
      <span className={styles.k}>{label}</span>
      <div className={styles.v}>
        <input
          type="number"
          inputMode={int ? 'numeric' : 'decimal'}
          className={cx(styles.input, styles.num)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            doCommit();
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {onClear ? <ClearBtn onClear={onClear} /> : null}
      </div>
    </div>
  );
}

export function TextRow({
  label,
  value,
  commit,
  description,
  unset,
  onClear,
}: Described<{
  label: string;
  value: string;
  commit: (v: string) => void;
}>): React.JSX.Element {
  const [text, setText] = useState(() => value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <div className={cx(styles.row, unset && styles.unsetRow)} title={description}>
      <span className={styles.k}>{label}</span>
      <div className={styles.v}>
        <input
          type="text"
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            if (text !== value) commit(text); // untouched → no write
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {onClear ? <ClearBtn onClear={onClear} /> : null}
      </div>
    </div>
  );
}

export function BoolRow({
  label,
  value,
  commit,
  description,
  unset,
  onClear,
}: Described<{
  label: string;
  value: boolean;
  commit: (v: boolean) => void;
}>): React.JSX.Element {
  return (
    <div className={cx(styles.row, unset && styles.unsetRow)} title={description}>
      <span className={styles.k}>{label}</span>
      <div className={styles.v}>
        <input type="checkbox" className={styles.toggle} checked={value} onChange={(e) => commit(e.target.checked)} />
        {onClear ? <ClearBtn onClear={onClear} /> : null}
      </div>
    </div>
  );
}

/** A dropdown of enum member names; maps the live native value ↔ its name. */
export function EnumRow({
  label,
  def,
  value,
  commit,
  description,
  unset,
  onClear,
}: Described<{
  label: string;
  def: EnumDef;
  value: unknown;
  commit: (v: string | number) => void;
}>): React.JSX.Element {
  const current = def.byValue.get(value as string | number) ?? '';
  return (
    <div className={cx(styles.row, unset && styles.unsetRow)} title={description}>
      <span className={styles.k}>{label}</span>
      <div className={styles.v}>
        <select
          className={cx(styles.input, styles.select)}
          value={current}
          onChange={(e) => {
            const v = def.byName.get(e.target.value);
            if (v !== undefined) commit(v);
          }}
        >
          {def.names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {onClear ? <ClearBtn onClear={onClear} /> : null}
      </div>
    </div>
  );
}

export function ColorRow({
  label,
  value,
  commit,
  description,
  unset,
  onClear,
}: Described<{
  label: string;
  value: number;
  commit: (hex: number) => void;
}>): React.JSX.Element {
  // Defensive: the inspector has no error boundary, so a bad value here would
  // blank the entire panel rather than one row.
  const hex24 = Number.isFinite(value) ? (value as number) & 0xffffff : 0;
  const css = '#' + hex24.toString(16).padStart(6, '0');
  const [hex, setHex] = useState(css);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setHex(css);
  }, [css]);
  return (
    <div className={cx(styles.row, unset && styles.unsetRow)} title={description}>
      <span className={styles.k}>{label}</span>
      <div className={styles.v}>
        <div className={styles.color}>
          <input
            type="color"
            className={styles.swatch}
            value={css}
            onChange={(e) => {
              setHex(e.target.value);
              commit(parseInt(e.target.value.slice(1), 16));
            }}
          />
          <input
            type="text"
            className={cx(styles.input, styles.hex)}
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false;
              if (hex === css) return; // untouched → no write
              const v = parseInt(hex.replace(/^#/, ''), 16);
              if (Number.isFinite(v)) commit(v);
              else setHex(css);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
        {onClear ? <ClearBtn onClear={onClear} /> : null}
      </div>
    </div>
  );
}

/** A multi-axis vector editor (x/y/z), each axis a scrub handle + number input. */
export function VecRow({
  label,
  value,
  commit,
  labels = ['x', 'y', 'z'],
  description,
  unset,
  onClear,
}: Described<{
  label: string;
  value: number[];
  commit: (v: number[], opts?: { coalesce?: boolean }) => void;
  labels?: string[];
}>): React.JSX.Element {
  return (
    <div className={cx(styles.row, unset && styles.unsetRow)} title={description}>
      <span className={styles.k}>{label}</span>
      <div className={cx(styles.v, styles.axes)}>
        {labels.map((axis, i) => (
          <AxisField
            key={axis}
            label={axis}
            value={value[i] ?? 0}
            commit={(v, opts) => {
              const next = value.slice();
              next[i] = v;
              commit(next, opts);
            }}
          />
        ))}
        {onClear ? <ClearBtn onClear={onClear} /> : null}
      </div>
    </div>
  );
}

/**
 * Euler editor — **degrees in, degrees out**, matching the authored DSL and the
 * compiled model (`transform.eulerAngles`, `ValueType.Euler` props). Callers
 * holding a live `THREE.Euler` (radians) convert at their own boundary, e.g. via
 * `node.eulerAngles.toArray()` or `eulerDeg(...)`; this row never converts, so
 * there is exactly one place per call site where units change.
 */
export function EulerRow({
  label,
  value,
  commit,
  description,
  unset,
  onClear,
}: Described<{
  label: string;
  value: number[]; // degrees
  commit: (degrees: number[], opts?: { coalesce?: boolean }) => void;
}>): React.JSX.Element {
  return <VecRow label={label} value={value} commit={commit} description={description} />;
}

/** One axis: a draggable letter (scrub) + a number input. */
function AxisField({ label, value, commit }: { label: string; value: number; commit: Commit }): React.JSX.Element {
  const [text, setText] = useState(() => fmtNum(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtNum(value));
  }, [value]);
  const doCommit = (): void => {
    if (text === fmtNum(value)) return; // untouched → no write
    const v = parseFloat(text);
    if (Number.isFinite(v)) commit(v);
    else setText(fmtNum(value));
  };
  const scrub = useScrub(
    () => parseFloat(text) || 0,
    (v) => {
      setText(fmtNum(v));
      commit(v, { coalesce: true });
    },
  );
  return (
    <div className={styles.axis}>
      <span className={cx(styles.axisK, styles.scrub)} {...scrub}>
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        className={cx(styles.input, styles.num)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          doCommit();
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

/** Drag horizontally on an element to scrub a numeric value (pointer + touch). */
function useScrub(getValue: () => number, onScrub: (v: number) => void, step = 0.05) {
  const start = useRef({ x: 0, v: 0 });
  const active = useRef(false);
  const end = (e: ReactPointerEvent): void => {
    if (!active.current) return;
    active.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture already gone */
    }
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      active.current = true;
      start.current = { x: e.clientX, v: getValue() };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!active.current) return;
      onScrub(start.current.v + (e.clientX - start.current.x) * step);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}
