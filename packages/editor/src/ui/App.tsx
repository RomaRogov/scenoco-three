/** @jsxImportSource react */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Crosshair, Focus, PanelsTopLeft, Pause, Play, Redo2, RotateCcw, Save, Settings, StepForward, Trash2, Undo2, X } from 'lucide-react';
import type { Object3D } from 'three';
import type { Reach } from '@scenoco-three/core';
import { codeOf, type Attr, type CodeEditor, type Model, type Tag, type TextLink, type View } from '../model.js';

/** Live values move while the game runs: the interface reads them again this often. */
const TICK_MS = 120;

export function App({ model }: { model: Model }): React.JSX.Element {
  const { host } = model;
  const [tick, setTick] = useState(0);
  const [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<Object3D | null>(host.selected);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    model.changed = bump;
    host.on('select', (node) => {
      setSelected(node);
      bump();
    });
    host.on('moved', (node, before) => void model.moved(node, before));
    const timer = setInterval(bump, TICK_MS);
    return () => clearInterval(timer);
  }, [model, host]);

  return (
    <div className="se-panel">
      <Toolbar model={model} settings={settings} toggleSettings={() => setSettings(!settings)} />
      <ScenePicker model={model} />
      {settings && <SettingsPopup model={model} close={() => setSettings(false)} />}
      {model.stage && <StageBar model={model} />}
      {model.status.text && <div className={model.status.error ? 'se-status se-error' : 'se-status'}>{model.status.text}</div>}
      <Failed again={selected} where="the list">
        <Tree model={model} selected={selected} />
      </Failed>
      <Failed again={selected} where="this node's code">
        <Code model={model} selected={selected} tick={tick} />
      </Failed>
    </div>
  );
}

function Toolbar({ model, settings, toggleSettings }: { model: Model; settings: boolean; toggleSettings: () => void }): React.JSX.Element {
  const { host } = model;
  // The page's own HTML — its HUD — starts hidden: the editor is for the 3D. The switch brings it back.
  const [html, setHtml] = useState(false);
  const toggleHtml = () => setHtml(!html);
  useEffect(() => {
    document.body.classList.toggle('scenoco-canvas-only', !html);
    return () => document.body.classList.remove('scenoco-canvas-only');
  }, [html]);
  return (
    <div className="se-bar">
      {host.paused ? (
        <Button title="Play" onClick={() => host.play()}>
          <Play />
        </Button>
      ) : (
        <Button title="Pause: look around with the editor's camera" onClick={() => host.pause()}>
          <Pause />
        </Button>
      )}
      <Button title="One frame" onClick={() => host.step()}>
        <StepForward />
      </Button>
      <Button title="Reset: load the page again and hold its first frame" onClick={() => leave(model) && host.reset(model.resetReach)}>
        <RotateCcw />
      </Button>
      <Button title={html ? "Hide the page's HTML: only the game's canvas" : "Show the page's HTML again"} pressed={!html} onClick={toggleHtml}>
        <PanelsTopLeft />
      </Button>
      <span className="se-gap" />
      <Button title="Undo (⌘Z)" disabled={!model.canUndo} onClick={() => model.undo()}>
        <Undo2 />
      </Button>
      <Button title="Redo (⇧⌘Z)" disabled={!model.canRedo} onClick={() => model.redo()}>
        <Redo2 />
      </Button>
      <span className="se-gap" />
      <Button
        title={model.unsavedCount ? `Save ${model.unsavedCount} unsaved ${model.unsavedCount === 1 ? 'change' : 'changes'} into the scene files (⌘S)` : 'Nothing to save'}
        disabled={!model.unsavedCount}
        onClick={() => void model.save()}
      >
        <Save />
        {model.unsavedCount > 0 && <span className="se-badge" />}
      </Button>
      <span className="se-fill" />
      <Button title="Settings" pressed={settings} onClick={toggleSettings}>
        <Settings />
      </Button>
      <Button title="Close the editor" onClick={() => leave(model) && host.close()}>
        <X />
      </Button>
    </div>
  );
}

/**
 * Which scene the page starts in — Unity's open scene. Picking one loads the page again in it, held
 * as a reset holds it; "as the game starts" goes back to the game's own first scene.
 */
function ScenePicker({ model }: { model: Model }): React.JSX.Element | null {
  const { host } = model;
  if (model.scenes.length === 0) return null;
  const key = (s: { file: string; name: string } | null) => (s ? `${s.file}#${s.name}` : '');
  const open = host.openedScene;
  return (
    <label className="se-scenes">
      <span>Scene</span>
      <select
        value={key(open)}
        onChange={(event) => {
          const picked = model.scenes.find((s) => key(s) === event.currentTarget.value) ?? null;
          if (leave(model)) host.openScene(picked, model.resetReach);
          else event.currentTarget.value = key(open);
        }}
      >
        <option value="">as the game starts</option>
        {model.scenes.map((s) => (
          <option key={key(s)} value={key(s)}>
            {s.name} — {s.file.replace(/^\//, '')}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Unsaved changes are lost by leaving: ask first. */
function leave(model: Model): boolean {
  const n = model.unsavedCount;
  if (n && !confirm(`${n} unsaved ${n === 1 ? 'change' : 'changes'} will be lost. Leave anyway?`)) return false;
  model.discard(); // asked once: the page's own leave prompt would ask again
  return true;
}

function Button({ title, disabled, pressed, onClick, children }: { title: string; disabled?: boolean; pressed?: boolean; onClick: () => void; children: ReactNode }): React.JSX.Element {
  return (
    <button className={pressed ? 'se-button se-pressed' : 'se-button'} title={title} aria-label={title} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

// --- the scene's nodes ----------------------------------------------------------------------------

function Tree({ model, selected }: { model: Model; selected: Object3D | null }): React.JSX.Element {
  const { host } = model;
  /** Nodes opened — or, at the top, where every scene starts open, closed — by hand. */
  const [toggled, setToggled] = useState(() => new Set<Object3D>());
  const list = useRef<HTMLDivElement>(null);
  /** The row picked in the list itself: it is in sight already, and the list stays where it is. */
  const picked = useRef<Object3D | null>(null);
  /** A pick in the view waits to be brought to the middle of the list, once its row is drawn. */
  const centre = useRef(false);
  // A node picked in the view opens the way to it, and comes to the middle of the list.
  useEffect(() => {
    const fromList = selected === picked.current;
    picked.current = null;
    if (!selected || fromList) return;
    centre.current = true;
    setToggled((was) => {
      const next = new Set(was);
      for (let up = selected.parent; up && up !== host.scene; up = up.parent) {
        if (up.parent === host.scene) next.delete(up);
        else next.add(up);
      }
      return next;
    });
  }, [selected]);
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector('.se-selected');
    if (!centre.current || !box || !row) return;
    centre.current = false;
    // The list's own scroll, not `scrollIntoView`: that scrolls the page too.
    const at = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: at - (box.clientHeight - row.clientHeight) / 2, behavior: 'smooth' });
  });

  // In prefab mode, everything but the prefab being edited steps back.
  const outside = (node: Object3D) => {
    const root = model.stage?.root;
    if (!root) return false;
    for (let n: Object3D | null = node; n; n = n.parent) if (n === root) return false;
    return true;
  };
  const rows: React.JSX.Element[] = [];
  const visit = (node: Object3D, depth: number) => {
    const made = host.madeBy(node);
    const isOpen = depth === 0 ? !toggled.has(node) : toggled.has(node);
    const behaviours = made ? [] : host.behavioursOn(node);
    rows.push(
      <div
        key={node.uuid}
        className={['se-row', node === selected && 'se-selected', host.spawned(node) && 'se-dim', outside(node) && 'se-outside'].filter(Boolean).join(' ')}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => {
          picked.current = node;
          host.select(node);
        }}
        onDoubleClick={() => host.frame(node)}
      >
        <span
          className="se-caret"
          onClick={(event) => {
            event.stopPropagation();
            setToggled((was) => {
              const next = new Set(was);
              if (next.has(node)) next.delete(node);
              else next.add(node);
              return next;
            });
          }}
        >
          {node.children.length > 0 && (isOpen ? <ChevronDown /> : <ChevronRight />)}
        </span>
        <span className={made ? 'se-made' : undefined}>{made ? `<${model.tagName(node)}>` : node.name || node.type}</span>
        {behaviours.length > 0 && <span className="se-chips">{behaviours.map((b) => b.constructor.name).join(' · ')}</span>}
      </div>,
    );
    if (isOpen) for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of host.scene.children) visit(child, 0);
  return (
    <div className="se-tree" ref={list}>
      {rows}
    </div>
  );
}

// --- the selection, as its TSX --------------------------------------------------------------------

/**
 * A part of the panel that threw while drawing says so in its place, and the rest goes on — without
 * it React takes the whole panel down, and the paused game is left with nothing to say why. Picking
 * another node draws the part again.
 */
class Failed extends Component<{ where: string; again: unknown; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  // Not a `key`: that would draw the part anew — the list's open nodes and scroll lost — on every pick.
  override componentDidUpdate(before: { again: unknown }) {
    if (this.state.error && before.again !== this.props.again) this.setState({ error: null });
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="se-code">
        <div className="se-note se-error">
          The editor failed to show {this.props.where}: {this.state.error.message}. The console has the stack; pick another node to try again.
        </div>
      </div>
    );
  }
}

function Code({ model, selected, tick }: { model: Model; selected: Object3D | null; tick: number }): React.JSX.Element {
  const [view, setView] = useState<View | null>(null);
  const asked = useRef(0);
  // Read again on every tick: the values are live.
  useEffect(() => {
    const ask = ++asked.current;
    if (!selected) return setView(null);
    void model.view(selected).then(
      (seen) => ask === asked.current && setView(seen),
      (error: unknown) => model.say(error instanceof Error ? error.message : String(error), true),
    );
  }, [model, selected, tick]);
  if (!selected || !view) return <div className="se-code se-empty">Select a node — in the list, or tap it while paused.</div>;
  const behaviours = view.behaviours;
  const inside = view.attached.length + behaviours.length;
  return (
    <div className="se-code">
      <div className="se-head">
        <Where model={model} tag={view.tag} />
        <button className="se-button" title="Look at it (F)" aria-label="Look at it" onClick={() => model.host.frame(selected)}>
          <Crosshair />
        </button>
        <button className="se-button" title="Duplicate (⌘D): a copy of its element, next to it in the file" aria-label="Duplicate" onClick={() => void model.restructure(selected, true)}>
          <Copy />
        </button>
        <button className="se-button" title="Delete (⌫): take its element out of the file" aria-label="Delete" onClick={() => void model.restructure(selected, false)}>
          <Trash2 />
        </button>
      </div>
      {view.note && (
        <div className="se-note">
          {view.enter ? `${view.note}: what it is made of is the prefab's own.` : model.stage && !view.prefab ? view.note : `${view.note}: changes here are live only.`}
          {view.enter && <EnterButton model={model} root={view.enter.root} name={view.enter.name} />}
        </div>
      )}
      {view.prefab && <div className="se-layer">this copy — its tag’s overrides</div>}
      <TagLines model={model} tag={view.tag} depth={0} close={inside ? '>' : '/>'} />
      {view.attached.map((a, i) => (
        <TagLines key={`a${i}`} model={model} tag={a} depth={1} close="/>" where />
      ))}
      {behaviours.map((b, i) => (
        <TagLines key={i} model={model} tag={b} depth={1} close="/>" where />
      ))}
      {inside > 0 && <div className="se-line">{`</${view.tag.name}>`}</div>}
      {view.prefab && <PrefabLayer model={model} prefab={view.prefab} />}
    </div>
  );
}

/**
 * Under a copy's tag, what its prefab says: the root element inside the prefab and the behaviours on
 * it — the prefab's own, which every copy shares — read-only, with the way into prefab mode.
 */
function PrefabLayer({ model, prefab }: { model: Model; prefab: NonNullable<View['prefab']> }): React.JSX.Element {
  const { own, behaviours } = prefab;
  return (
    <div className="se-prefab">
      <div className="se-layer">
        <span>
          the prefab’s own — <b>{prefab.name}</b>
          {prefab.where && (
            <>
              {' · '}
              <Where model={model} tag={{ name: prefab.name, attrs: [], where: prefab.where }} />
            </>
          )}
        </span>
        {model.stage?.root !== prefab.root && <EnterButton model={model} root={prefab.root} name={prefab.name} />}
      </div>
      <TagLines model={model} tag={own} depth={0} close={behaviours.length ? '>' : '/>'} />
      {behaviours.map((b, i) => (
        <TagLines key={i} model={model} tag={b} depth={1} close="/>" />
      ))}
      {behaviours.length > 0 && <div className="se-line">{`</${own.name}>`}</div>}
    </div>
  );
}

function EnterButton({ model, root, name }: { model: Model; root: Object3D; name: string }): React.JSX.Element {
  return (
    <button className="se-enter" title={`Edit what every <${name}> is made of`} onClick={() => model.enter(root)}>
      Edit prefab
    </button>
  );
}

/** Prefab mode: what is being edited, where it is written, and the way back. */
function StageBar({ model }: { model: Model }): React.JSX.Element {
  const stage = model.stage!;
  const file = stage.file.split('/').pop();
  return (
    <div className="se-stage">
      <button className="se-button" title="Back to the scene" aria-label="Back to the scene" onClick={() => model.leave()}>
        <ArrowLeft />
      </button>
      <span className="se-crumbs">
        Scene › <b>{`<${stage.name}>`}</b>
        <small>
          changes go to {file} and every {`<${stage.name}>`}
          {stage.count > 1 ? ` — ${stage.count} in this scene` : ''}
        </small>
      </span>
      <button className={model.isolated ? 'se-button se-pressed' : 'se-button'} title="Isolate: only this prefab" aria-pressed={model.isolated} onClick={() => model.isolate(!model.isolated)}>
        <Focus />
      </button>
    </div>
  );
}

/** A link to where the tag is written, opened the way the settings say. */
function Where({ model, tag }: { model: Model; tag: Tag }): React.JSX.Element | null {
  const at = tag.where;
  if (!at) return <span className="se-muted">made in code</span>;
  return (
    <a className="se-link" href="#" title="Open in your code editor" onClick={(event) => (event.preventDefault(), void model.open(at))}>
      {at.label} ↗
    </a>
  );
}

const CODE_EDITORS: { how: CodeEditor; label: string; note: string }[] = [
  { how: 'auto', label: 'Automatic', note: 'the editor that is running, or $LAUNCH_EDITOR' },
  { how: 'system', label: 'Default app for .tsx', note: "the system's choice, without the line" },
  { how: 'vscode', label: 'VS Code', note: 'its vscode:// link' },
  { how: 'cursor', label: 'Cursor', note: 'its cursor:// link' },
  { how: 'custom', label: 'Project command', note: '' },
];

/** The lifecycle in order: each hook runs only after the ones before it, so a box needs the boxes above. */
const HOOKS: { reach: Exclude<Reach, 'none'>; label: string; note: string }[] = [
  { reach: 'awake', label: 'awake', note: 'every behaviour, as its node is built' },
  { reach: 'onEnable', label: 'onEnable', note: 'then each enabled one' },
  { reach: 'start', label: 'start', note: 'then before the first frame' },
  { reach: 'frame', label: 'One frame', note: 'fixedUpdate, update, lateUpdate' },
];
const ORDER: readonly Reach[] = ['none', ...HOOKS.map((h) => h.reach)];

/** The editor's settings, in a window of their own over it. */
function SettingsPopup({ model, close }: { model: Model; close: () => void }): React.JSX.Element {
  const [custom, setCustom] = useState<string | null | undefined>(undefined);
  useEffect(() => void model.customCommand().then(setCustom), [model]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && (event.stopPropagation(), close());
    addEventListener('keydown', escape, true);
    return () => removeEventListener('keydown', escape, true);
  }, [close]);
  const reach = ORDER.indexOf(model.resetReach);
  const chosen = model.codeEditor;
  return (
    <div className="se-backdrop" onClick={(event) => event.target === event.currentTarget && close()}>
      <div className="se-popup" role="dialog" aria-modal="true" aria-label="Editor settings">
        <div className="se-popupHead">
          <span>Settings</span>
          <button className="se-button" title="Close settings" aria-label="Close settings" onClick={close}>
            <X />
          </button>
        </div>
        <section>
          <h3>Reset runs</h3>
          <p>What behaviours do before the scene is held. Nothing ticked: the scene just as the files build it.</p>
          {HOOKS.map((hook, i) => (
            <label key={hook.reach} className="se-choice">
              <input
                type="checkbox"
                checked={reach > i}
                onChange={(event) => (model.resetReach = ORDER[event.currentTarget.checked ? i + 1 : i]!)}
              />
              <span>
                <code>{hook.label}</code>
                <small>{hook.note}</small>
              </span>
            </label>
          ))}
        </section>
        <section>
          <h3>Source links open in</h3>
          {CODE_EDITORS.map(({ how, label, note }) => (
            <label key={how} className="se-choice">
              <input type="radio" name="se-code-editor" checked={chosen === how} onChange={() => (model.codeEditor = how)} />
              <span>
                {label}
                <small>
                  {how !== 'custom' ? note : custom ? <code>{custom}</code> : custom === null ? "set scenoco({ editor: 'zed {file}:{line}:{col}' }) in vite.config" : '…'}
                </small>
              </span>
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}

function TagLines({ model, tag, depth, close, where }: { model: Model; tag: Tag; depth: number; close: string; where?: boolean }): React.JSX.Element {
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

function Value({ model, attr, live, commit }: { model: Model; attr: Attr; live: (v: unknown) => void; commit: (v: unknown) => void }): React.JSX.Element {
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

/** A value shown, not edited, as written: each name in it a link to where it is declared. */
function Shown({ model, attr }: { model: Model; attr: Attr }): React.JSX.Element {
  const text = shownText(attr);
  // The links are places in the file's text: only that text has them.
  const links = attr.written && attr.text === text ? [...(attr.links ?? [])].sort((a, b) => a.from - b.from) : [];
  if (!links.length) return <span className="se-text">{text}</span>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  links.forEach((link: TextLink, i) => {
    if (link.from < at) return;
    parts.push(text.slice(at, link.from));
    parts.push(
      <a key={i} className="se-ref" href="#" title={`${link.where.label} — open in your code editor`} onClick={(event) => (event.preventDefault(), void model.open(link.where))}>
        {text.slice(link.from, link.to)}
      </a>,
    );
    at = link.to;
  });
  parts.push(text.slice(at));
  return <span className="se-text">{parts}</span>;
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
 */
function NumberField({ value, step, live, commit }: { value: number; step: number; live: (n: number) => void; commit: (n: number) => void }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  /** The value when focused: typing sets it live, so the end compares against where it began. */
  const began = useRef(value);
  const drag = useRef<{ x: number; from: number; on: boolean; last: number } | null>(null);
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
        drag.current = { x: event.clientX, from: value, on: false, last: value };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        const dx = event.clientX - d.x;
        if (!d.on && Math.abs(dx) < 4) return;
        if (!d.on) {
          d.on = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.blur();
        }
        const per = step || Math.max(0.01, Math.abs(d.from) * 0.01);
        d.last = Math.round((d.from + dx * per) * 1000) / 1000;
        live(d.last);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.on) commit(d.last);
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

/** An attribute's text without the braces around an expression: `{[0, 1, 0]}` reads `[0, 1, 0]`. */
function unbrace(text: string): string {
  return text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1) : text;
}

/** A value shown, not edited: its text in the file when written, else the live value. */
function shownText(attr: Attr): string {
  if (attr.written && attr.text !== null) return attr.text;
  const value = codeOf(attr.value);
  return typeof attr.value === 'string' ? value : `{${value}}`;
}
