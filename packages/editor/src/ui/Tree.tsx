/** @jsxImportSource react */
/** The scene's nodes, as a list to pick from. */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Object3D } from 'three';
import type { Model } from '../model/Model.js';

export function Tree({ model, selected }: { model: Model; selected: Object3D | null }): React.JSX.Element {
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
    // A prefab copy shows what its tag added: the prefab's own behaviours are inside it, in prefab mode.
    const behaviours = made ? made.added.behaviours : host.behavioursOn(node);
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
