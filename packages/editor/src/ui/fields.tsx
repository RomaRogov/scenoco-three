/** @jsxImportSource react */
/**
 * A value on its line: edited as its kind is — a number scrubbed, a list an item a line — or shown
 * as written, its names linked.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { listItem, type Attr, type Kind, type Model } from '../model/Model.js';
import { Shown } from './Shown.js';

export function Value({ model, attr, live, commit }: { model: Model; attr: Attr; live: (v: unknown) => void; commit: (v: unknown) => void }): React.JSX.Element {
  const { kind, value } = attr;
  // An argument is an item of `args={[…]}`: no braces of its own.
  const Braces = attr.arg ? Bare : Braced;
  if (kind === 'number') return <Braces>{<NumberField value={value as number} step={0} live={live} commit={commit} />}</Braces>;
  if (kind === 'vector' || kind === 'angles') {
    const list = value as number[];
    const at = (i: number) => (n: number) => list.map((x, j) => (j === i ? n : x));
    return (
      <Braces>
        [
        {list.map((x, i) => (
          <span key={i}>
            {i > 0 && ', '}
            <NumberField value={x} step={kind === 'angles' ? 0.5 : 0} live={(n) => live(at(i)(n))} commit={(n) => commit(at(i)(n))} />
          </span>
        ))}
        ]
      </Braces>
    );
  }
  // An item added or removed is a change of its own: undo puts back the list as it is now.
  if (kind === 'list') return <Braces>{<List list={value as unknown[]} item={listItem(value)!} live={live} commit={commit} change={(v) => void model.set(attr, v, true, attr.value)} />}</Braces>;
  if (kind === 'boolean') {
    return (
      <Braces>
        <button className="se-token se-bool" onClick={() => commit(!(value as boolean))}>
          {String(value)}
        </button>
      </Braces>
    );
  }
  if (kind === 'color') {
    return (
      <span className="se-string">
        "<input className="se-swatch" type="color" value={value as string} onInput={(e) => live(e.currentTarget.value)} onChange={(e) => commit(e.currentTarget.value)} />
        {value as string}"
      </span>
    );
  }
  if (kind === 'string') return <TextField value={value as string} commit={commit} />;
  if (kind === 'option' && attr.options) {
    // As the file names them: `{DoubleSide}` stands in braces, `"world"` in quotes.
    const option = attr.options.find((o) => o.value === value);
    const named = !option || option.text.startsWith('{');
    const select = (
      <select className="se-token se-option" value={String(value)} onChange={(event) => commit(attr.options!.find((o) => String(o.value) === event.currentTarget.value)!.value)}>
        {attr.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    );
    return named ? <Braces>{select}</Braces> : <span className="se-string">"{select}"</span>;
  }
  return <Shown model={model} attr={attr} />;
}

/**
 * A list — a spline's knots, waypoints, a palette, names — an item a line, each edited as its kind
 * is; one added after an item (halfway to the next for numbers and points, else a copy) or removed.
 * A change is the whole list again.
 */
function List({ list, item, live, commit, change }: { list: unknown[]; item: Kind; live: (v: unknown) => void; commit: (v: unknown) => void; change: (v: unknown) => void }): React.JSX.Element {
  const put = (i: number, value: unknown) => list.map((x, j) => (j === i ? value : x));
  const after = (i: number) => {
    const at = list[i];
    const next = list[i + 1] ?? (item === 'number' || item === 'vector' ? beyond(at, list[i - 1]) : at);
    return [...list.slice(0, i + 1), halfway(at, next), ...list.slice(i + 1)];
  };
  return (
    <>
      [
      <span className="se-points">
        {list.map((value, i) => (
          <span key={i} className="se-point">
            <Item value={value} item={item} live={(v) => live(put(i, v))} commit={(v) => commit(put(i, v))} />
            {i < list.length - 1 && ','}
            <button className="se-revert se-pointbtn" title="Add an item after this one" aria-label="Add an item" onPointerDown={(event) => event.preventDefault()} onClick={() => change(after(i))}>
              <Plus />
            </button>
            {list.length > 1 && (
              <button className="se-revert se-pointbtn" title="Remove this item" aria-label="Remove the item" onPointerDown={(event) => event.preventDefault()} onClick={() => change(list.filter((_, j) => j !== i))}>
                <X />
              </button>
            )}
          </span>
        ))}
      </span>
      ]
    </>
  );
}

/** One item of a list, edited as its kind is. */
function Item({ value, item, live, commit }: { value: unknown; item: Kind; live: (v: unknown) => void; commit: (v: unknown) => void }): React.JSX.Element {
  if (item === 'number') return <NumberField value={value as number} step={0} live={live} commit={commit} />;
  if (item === 'vector') {
    const point = value as number[];
    const at = (k: number) => (n: number) => point.map((y, j) => (j === k ? n : y));
    return (
      <>
        [
        {point.map((x, k) => (
          <span key={k}>
            {k > 0 && ', '}
            <NumberField value={x} step={0} live={(n) => live(at(k)(n))} commit={(n) => commit(at(k)(n))} />
          </span>
        ))}
        ]
      </>
    );
  }
  if (item === 'boolean') {
    return (
      <button className="se-token se-bool" onClick={() => commit(!(value as boolean))}>
        {String(value)}
      </button>
    );
  }
  if (item === 'color') {
    return (
      <span className="se-string">
        "<input className="se-swatch" type="color" value={value as string} onInput={(e) => live(e.currentTarget.value)} onChange={(e) => commit(e.currentTarget.value)} />
        {value as string}"
      </span>
    );
  }
  return <TextField value={String(value)} commit={commit} />;
}

/** Halfway between two numbers or two points; anything else, a copy of the first. */
function halfway(a: unknown, b: unknown): unknown {
  const mid = (x: number, y: number) => Math.round(((x + y) / 2) * 1000) / 1000;
  if (typeof a === 'number' && typeof b === 'number') return mid(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, k) => mid(x as number, (b[k] as number) ?? (x as number)));
  return a;
}

/** One step on past the last number or point, as far as from the one before it — or 1 on, when it is alone. */
function beyond(last: unknown, before: unknown): unknown {
  if (typeof last === 'number') return 2 * last - (typeof before === 'number' ? before : last - 1);
  return (last as number[]).map((x, k) => 2 * x - ((before as number[] | undefined)?.[k] ?? x - 1));
}

function Bare({ children }: { children: ReactNode }): React.JSX.Element {
  return <span>{children}</span>;
}

function Braced({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span>
      {'{'}
      {children}
      {'}'}
    </span>
  );
}

/**
 * A number: typed, or dragged sideways to scrub it — the scene follows the drag and the file is
 * written once, when it ends. Sideways only, so a finger can still scroll the panel up and down.
 * A press does nothing yet: a drag scrubs, and a release that did not move focuses it to type — a
 * press that focused at once would start selecting text under a drag. Once typing, a press is a
 * text field's own: it places the caret.
 */
function NumberField({ value, step, live, commit }: { value: number; step: number; live: (n: number) => void; commit: (n: number) => void }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  /** The value when focused: typing sets it live, so the end compares against where it began. */
  const began = useRef(value);
  const drag = useRef<{ x: number; from: number; on: boolean; last: number; typing: boolean } | null>(null);
  /** A touch selecting the text brings up the system's copy-and-paste menu: only a mouse or keys select it. */
  const touched = useRef(false);
  const shown = text ?? String(value);
  const parse = (t: string) => {
    const n = Number(t);
    return t.trim() !== '' && Number.isFinite(n) ? n : null;
  };
  return (
    <input
      className="se-token se-number"
      inputMode="decimal"
      size={Math.max(1, shown.length)}
      value={shown}
      onPointerDown={(event) => {
        touched.current = event.pointerType === 'touch';
        const typing = document.activeElement === event.currentTarget;
        // Captured from the press: a field is a few pixels wide, and the pointer leaves it before a drag begins.
        if (!typing) {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        drag.current = { x: event.clientX, from: value, on: false, last: value, typing };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d || d.typing) return;
        const dx = event.clientX - d.x;
        if (!d.on && Math.abs(dx) < 4) return;
        d.on = true;
        const per = step || Math.max(0.01, Math.abs(d.from) * 0.01);
        d.last = Math.round((d.from + dx * per) * 1000) / 1000;
        live(d.last);
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        drag.current = null;
        if (d?.on) commit(d.last);
        else if (d && !d.typing) event.currentTarget.focus();
      }}
      onFocus={(event) => {
        began.current = value;
        setText(String(value));
        if (!touched.current) event.currentTarget.select();
      }}
      onChange={(event) => {
        setText(event.currentTarget.value);
        const n = parse(event.currentTarget.value);
        if (n !== null) live(n);
      }}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      onBlur={() => {
        const n = text === null ? null : parse(text);
        setText(null);
        if (n !== null && n !== began.current) commit(n);
      }}
    />
  );
}

function TextField({ value, commit }: { value: string; commit: (s: string) => void }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value;
  return (
    <span className="se-string">
      "
      <input
        className="se-token"
        size={Math.max(1, shown.length)}
        value={shown}
        onFocus={() => setText(value)}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        onBlur={() => {
          if (text !== null && text !== value) commit(text);
          setText(null);
        }}
      />
      "
    </span>
  );
}
