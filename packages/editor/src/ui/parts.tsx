/** @jsxImportSource react */
import { useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Join the class names that apply. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** An icon button in a sheet's header. */
export function HeadBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <button className="se-headBtn" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** A sheet: the node list or the inspector — bottom-docked upright, a side column sideways. */
export function Sheet({ side, title, actions, children }: { side: 'left' | 'right'; title: string; actions: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className={cx('se-sheet', side === 'left' ? 'se-sheetLeft' : 'se-sheetRight')}>
      <div className="se-head">
        <span className="se-title">{title}</span>
        <div className="se-actions">{actions}</div>
      </div>
      <div className="se-body">{children}</div>
    </div>
  );
}

/** Groups a person folded away, by title: they stay folded from one selection to the next. */
const folded = new Set<string>();

export function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const closed = folded.has(title);
  const toggle = () => {
    if (closed) folded.delete(title);
    else folded.add(title);
    redraw();
  };
  return (
    <div className="se-section">
      <div className="se-secHead" onClick={toggle}>
        <span className="se-secCaret">{closed ? <ChevronRight /> : <ChevronDown />}</span>
        {title}
      </div>
      {!closed && <div className="se-secBody">{children}</div>}
    </div>
  );
}

/** An element's content size: react-arborist needs pixels, and its container is a flex child. */
export function useSize<T extends HTMLElement>(): readonly [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
