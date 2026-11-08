/** @jsxImportSource react */
/** A tag as lines of TSX: each attribute on its own, and where the tag is written. */
import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { codeOf, type Attr, type Model, type Tag } from '../model/Model.js';
import { Value } from './fields.js';
import { Shown } from './Shown.js';

export function TagLines({ model, tag, depth, close, where }: { model: Model; tag: Tag; depth: number; close: string; where?: boolean }): React.JSX.Element {
  const pad = (d: number) => ({ paddingLeft: `${d * 2}ch` });
  return (
    <>
      <div className="se-line" style={pad(depth)}>
        <span className="se-tag">{`<${tag.name}`}</span>
        {tag.attrs.length === 0 && <span className="se-tag">{close === '/>' ? ' />' : '>'}</span>}
        {where && tag.where && (
          <span className="se-where">
            <Where model={model} tag={tag} />
          </span>
        )}
      </div>
      {tag.attrs.map((attr) => {
        const arg = attr.arg;
        if (!arg) return <AttrLine key={attr.name} model={model} attr={attr} depth={depth + 1} />;
        // `args={[` … `]}` around the arguments, one a line, each named for its parameter.
        const last = arg.index === arg.now.list.length - 1;
        return (
          <div key={`args${arg.index}`}>
            {arg.index === 0 && (
              <div className="se-line" style={pad(depth + 1)}>
                <span className="se-name">args</span>
                {'={['}
              </div>
            )}
            <AttrLine model={model} attr={attr} depth={depth + 2} />
            {last && (
              <div className="se-line" style={pad(depth + 1)}>
                {']}'}
              </div>
            )}
          </div>
        );
      })}
      {tag.attrs.length > 0 && (
        <div className="se-line" style={pad(depth)}>
          <span className="se-tag">{close}</span>
        </div>
      )}
    </>
  );
}

/** One attribute: its value live and editable, and — while it has focus — what the file says, to put back. */
function AttrLine({ model, attr, depth }: { model: Model; attr: Attr; depth: number }): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  /** The value when the line took focus: what undo puts back, though typing has changed it live since. */
  const began = useRef(attr.value);
  const live = (value: unknown) => void model.set(attr, value, false);
  const commit = (value: unknown) => void model.set(attr, value, true, began.current);
  const onFocus = () => {
    if (!focused) began.current = attr.value;
    setFocused(true);
    const mode = ({ position: 'translate', rotation: 'rotate', scale: 'scale' } as const)[attr.name as 'position'];
    if (mode) model.setMode(mode);
  };
  return (
    <div
      className={['se-attr', !attr.written && !attr.unsaved && 'se-unwritten', attr.unsaved && 'se-unsaved'].filter(Boolean).join(' ')}
      style={{ paddingLeft: `${depth * 2}ch` }}
      onFocus={onFocus}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocused(false)}
    >
      <div className="se-line">
        {attr.arg ? (
          <>
            {attr.locked ? <span className="se-text">{attr.text}</span> : <Value model={model} attr={attr} live={live} commit={commit} />}
            {attr.arg.index < attr.arg.now.list.length - 1 && ','}
            <span className="se-muted">{` // ${attr.name}`}</span>
          </>
        ) : (
          <>
            <span className="se-name">{attr.name}</span>={attr.locked ? <Shown model={model} attr={attr} /> : <Value model={model} attr={attr} live={live} commit={commit} />}
          </>
        )}
        {attr.source !== undefined && !attr.locked && (
          <button className="se-revert" title={`Reset to ${codeOf(attr.source)}`} aria-label="Reset" onPointerDown={(event) => event.preventDefault()} onClick={() => model.reset(attr)}>
            <RotateCcw />
          </button>
        )}
      </div>
      {focused && !attr.locked && (
        <div className="se-tip">
          {attr.liveOnly ? (
            <span>{attr.liveOnly} — live only</span>
          ) : attr.wide && model.stage ? (
            <span>
              every {`<${model.stage.name}>`} takes it{attr.written && attr.text !== null ? <> — file: <code>{unbrace(attr.text)}</code></> : ''}
              {attr.unsaved ? ', not saved' : ''}
            </span>
          ) : attr.written ? (
            <span>
              file: <code>{attr.text === null ? 'true' : unbrace(attr.text)}</code>
              {attr.unsaved ? ' — changed, not saved' : attr.source === undefined && ' — as now'}
            </span>
          ) : (
            <span>{attr.unsaved ? 'not in the file yet: Save writes it' : 'not written in the file'}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** A link to where the tag is written, opened the way the settings say. */
export function Where({ model, tag }: { model: Model; tag: Tag }): React.JSX.Element | null {
  const at = tag.where;
  if (!at) return <span className="se-muted">made in code</span>;
  return (
    <a className="se-link" href="#" title="Open in your code editor" onClick={(event) => (event.preventDefault(), void model.open(at))}>
      {at.label} ↗
    </a>
  );
}

/** An attribute's text without the braces around an expression: `{[0, 1, 0]}` reads `[0, 1, 0]`. */
function unbrace(text: string): string {
  return text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1) : text;
}
