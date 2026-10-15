/** @jsxImportSource react */
/**
 * One widget per value shape. Each keeps its own text while it is being typed in and commits on
 * blur or Enter — never on a bare focus — so looking at a field writes nothing. Inputs are 16px:
 * smaller, and iOS zooms the page on every tap.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Lock, X } from 'lucide-react';
import { cx } from './parts.js';

/** `preview`: the live object follows a drag; the file is written once, when it ends. */
type Commit<T> = (value: T, preview?: boolean) => void;

interface Common {
  label: string;
  /** Not written in the file: the default, dimmed until it is touched. */
  unset?: boolean;
  /** Take the attribute out of the file. */
  onClear?: () => void;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;
const show = (n: number): string => String(round(n));

function Line({ label, unset, onClear, locked, wide, children }: Common & { locked?: string; wide?: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <div className={cx('se-row', unset && 'se-unset', locked && 'se-locked', wide && 'se-wide')} title={locked ?? (unset ? 'Not written in the file — the default.' : undefined)}>
      <span className="se-k">{label}</span>
      <div className="se-v">
        {children}
        {onClear ? (
          <button type="button" className="se-clear" title="Remove this attribute from the file" aria-label={`Remove ${label}`} onClick={onClear}>
            <X />
          </button>
        ) : (
          <span className="se-clearSlot" />
        )}
      </div>
    </div>
  );
}

/** A value shown, not edited, with why. */
export function LockRow({ value, reason, ...common }: Common & { value: string; reason: string }): React.JSX.Element {
  return (
    <Line {...common} locked={reason}>
      <Lock className="se-lockIcon" aria-label={reason} />
      <span className="se-lockVal">{value}</span>
    </Line>
  );
}

/** Text held while it is typed, put back when the value changes underneath. */
function useDraft(value: string): [string, (s: string) => void, { onFocus: () => void; onBlur: () => void }] {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return [text, setText, { onFocus: () => void (focused.current = true), onBlur: () => void (focused.current = false) }];
}

const enter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur();

export function NumberRow({ value, commit, ...common }: Common & { value: number; commit: Commit<number> }): React.JSX.Element {
  return (
    <Line {...common}>
      <NumberInput value={value} commit={commit} />
    </Line>
  );
}

function NumberInput({ value, commit }: { value: number; commit: Commit<number> }): React.JSX.Element {
  const [text, setText, focus] = useDraft(show(value));
  return (
    // Text with a decimal keypad, not type=number: that one shows the locale's comma and steals the wheel.
    <input
      type="text"
      inputMode="decimal"
      className="se-input se-num"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={focus.onFocus}
      onBlur={() => {
        focus.onBlur();
        if (text === show(value)) return;
        const next = Number(text.trim().replace(',', '.'));
        if (text.trim() !== '' && Number.isFinite(next)) commit(next);
        else setText(show(value));
      }}
      onKeyDown={enter}
    />
  );
}

export function TextRow({ value, commit, ...common }: Common & { value: string; commit: Commit<string> }): React.JSX.Element {
  const [text, setText, focus] = useDraft(value);
  return (
    <Line {...common}>
      <input
        type="text"
        className="se-input se-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={focus.onFocus}
        onBlur={() => {
          focus.onBlur();
          if (text !== value) commit(text);
        }}
        onKeyDown={enter}
      />
    </Line>
  );
}

export function BoolRow({ value, commit, ...common }: Common & { value: boolean; commit: Commit<boolean> }): React.JSX.Element {
  return (
    <Line {...common}>
      <input type="checkbox" className="se-toggle" checked={value} onChange={(e) => commit(e.target.checked)} />
    </Line>
  );
}

/** A colour, as the file writes it: `#rrggbb`. */
export function ColorRow({ value, commit, ...common }: Common & { value: string; commit: Commit<string> }): React.JSX.Element {
  const [hex, setHex, focus] = useDraft(value);
  return (
    <Line {...common}>
      <div className="se-color">
        <input type="color" className="se-swatch" value={value} onInput={(e) => commit(e.currentTarget.value, true)} onChange={(e) => commit(e.target.value)} />
        <input
          type="text"
          className="se-input se-hex"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onFocus={focus.onFocus}
          onBlur={() => {
            focus.onBlur();
            if (hex === value) return;
            const next = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
            if (next) commit(`#${next[1]!.toLowerCase()}`);
            else setHex(value);
          }}
          onKeyDown={enter}
        />
      </div>
    </Line>
  );
}

/** Two to four numbers, each with a letter to drag sideways — a mouse or a finger. */
export function VecRow({ value, commit, ...common }: Common & { value: number[]; commit: Commit<number[]> }): React.JSX.Element {
  const axes = ['x', 'y', 'z', 'w'].slice(0, value.length);
  return (
    <Line {...common} wide>
      <div className="se-axes">
        {axes.map((axis, i) => (
          <AxisField
            key={axis}
            label={axis}
            value={value[i] ?? 0}
            commit={(v, preview) => {
              const next = value.slice();
              next[i] = v;
              commit(next, preview);
            }}
          />
        ))}
      </div>
    </Line>
  );
}

function AxisField({ label, value, commit }: { label: string; value: number; commit: Commit<number> }): React.JSX.Element {
  const scrub = useScrub(value, commit);
  return (
    <div className="se-axis">
      <span className="se-axisK se-scrub" {...scrub}>
        {label}
      </span>
      <NumberInput value={scrub.current} commit={commit} />
    </div>
  );
}

/**
 * Drag on the letter to change the number: the live object follows every step, and the file is
 * written once, when the finger lifts — one save and one undo step for the whole drag.
 */
function useScrub(value: number, commit: Commit<number>, step = 0.05) {
  const start = useRef({ x: 0, v: 0 });
  const [dragged, setDragged] = useState<number | null>(null);
  const end = (e: ReactPointerEvent) => {
    if (dragged === null) return;
    commit(dragged);
    setDragged(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // capture already gone
    }
  };
  return {
    current: dragged ?? value,
    onPointerDown: (e: ReactPointerEvent) => {
      start.current = { x: e.clientX, v: value };
      setDragged(value);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (dragged === null) return;
      const next = round(start.current.v + (e.clientX - start.current.x) * step);
      setDragged(next);
      commit(next, true);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}
