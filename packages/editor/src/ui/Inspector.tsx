/** @jsxImportSource react */
/**
 * The selected node as its TSX: its tag, what it holds, its behaviours, and under a prefab's copy
 * the prefab's own.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Crosshair, Trash2 } from 'lucide-react';
import type { Object3D } from 'three';
import { type Model, type View } from '../model/Model.js';
import { TagLines, Where } from './Lines.js';

/**
 * A part of the panel that threw while drawing says so in its place, and the rest goes on — without
 * it React takes the whole panel down, and the paused game is left with nothing to say why. Picking
 * another node draws the part again.
 */
export class Failed extends Component<{ where: string; again: unknown; children: ReactNode }, { error: Error | null }> {
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

export function Code({ model, selected, tick }: { model: Model; selected: Object3D | null; tick: number }): React.JSX.Element {
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
          {view.advice && <div>{view.advice}</div>}
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
