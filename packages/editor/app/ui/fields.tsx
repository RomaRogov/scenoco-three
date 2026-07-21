import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EnumDef } from '@scenoco-three/core';
import { toDeg, toRad } from '../meta.js';
import { fmtNum } from './format.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

// React inspector field widgets (one per value shape). Each owns local editing
// state and commits through the caller's `commit` closure (which routes to the
// live SceneDocument). Ported from the old vanilla fields.ts, scrub logic intact.

type Commit = (value: number, opts?: { coalesce?: boolean }) => void;

/** A read-only label/value row. */
export function ReadRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.k}>{label}</span>
      <span className={styles.v}>{value}</span>
    </div>
  );
}

/** A standalone scalar (no scrub handle). */
export function NumberRow({
  label,
  value,
  commit,
  int,
}: {
  label: string;
  value: number;
  commit: (v: number) => void;
  int?: boolean;
}): React.JSX.Element {
  const [text, setText] = useState(() => fmtNum(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtNum(value));
  }, [value]);
  const doCommit = (): void => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) commit(int ? Math.round(v) : v);
    else setText(fmtNum(value));
  };
  return (
    <div className={styles.row}>
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
      </div>
    </div>
  );
}

export function TextRow({
  label,
  value,
  commit,
}: {
  label: string;
  value: string;
  commit: (v: string) => void;
}): React.JSX.Element {
  const [text, setText] = useState(() => value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <div className={styles.row}>
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
            commit(text);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
    </div>
  );
}

export function BoolRow({
  label,
  value,
  commit,
}: {
  label: string;
  value: boolean;
  commit: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.k}>{label}</span>
      <div className={styles.v}>
        <input type="checkbox" className={styles.toggle} checked={value} onChange={(e) => commit(e.target.checked)} />
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
}: {
  label: string;
  def: EnumDef;
  value: unknown;
  commit: (v: string | number) => void;
}): React.JSX.Element {
  const current = def.byValue.get(value as string | number) ?? '';
  return (
    <div className={styles.row}>
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
      </div>
    </div>
  );
}

export function ColorRow({
  label,
  value,
  commit,
}: {
  label: string;
  value: number;
  commit: (hex: number) => void;
}): React.JSX.Element {
  const css = '#' + value.toString(16).padStart(6, '0');
  const [hex, setHex] = useState(css);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setHex(css);
  }, [css]);
  return (
    <div className={styles.row}>
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
              const v = parseInt(hex.replace(/^#/, ''), 16);
              if (Number.isFinite(v)) commit(v);
              else setHex(css);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
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
}: {
  label: string;
  value: number[];
  commit: (v: number[], opts?: { coalesce?: boolean }) => void;
  labels?: string[];
}): React.JSX.Element {
  return (
    <div className={styles.row}>
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
      </div>
    </div>
  );
}

/** Euler editor: UI in degrees, commits radians (the compiled/runtime unit). */
export function EulerRow({
  label,
  value,
  commit,
}: {
  label: string;
  value: number[]; // radians
  commit: (radians: number[], opts?: { coalesce?: boolean }) => void;
}): React.JSX.Element {
  return (
    <VecRow
      label={label}
      value={value.map(toDeg)}
      commit={(degs, opts) => commit(degs.map(toRad), opts)}
    />
  );
}

/** One axis: a draggable letter (scrub) + a number input. */
function AxisField({ label, value, commit }: { label: string; value: number; commit: Commit }): React.JSX.Element {
  const [text, setText] = useState(() => fmtNum(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtNum(value));
  }, [value]);
  const doCommit = (): void => {
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
