/** @jsxImportSource react */
import { useMemo } from 'react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import type { Object3D } from 'three';
import { ChevronDown, ChevronRight, Focus, SlidersHorizontal, X } from 'lucide-react';
import { useController, useUI } from './store.js';
import { cx, HeadBtn, Sheet, useSize } from './parts.js';

/** One scene node as react-arborist reads it. */
interface TreeNode {
  id: string;
  name: string;
  type: string;
  object: Object3D;
  /** Made by code rather than written as an element: shown, dimmed. */
  made: boolean;
  children: TreeNode[];
}

/** The node list: the scene's tree, with Frame and Inspector for the selection. */
export function NodesSheet(): React.JSX.Element | null {
  const { nodesOpen, selected, openInspector, closeNodes } = useUI();
  const editor = useController();
  if (!nodesOpen) return null;
  return (
    <Sheet
      side="left"
      title="Nodes"
      actions={
        <>
          <HeadBtn label="Frame the selection" disabled={!selected} onClick={() => selected && editor.host.frame(selected)}>
            <Focus />
          </HeadBtn>
          <HeadBtn label="Open the inspector" disabled={!selected} onClick={openInspector}>
            <SlidersHorizontal />
          </HeadBtn>
          <HeadBtn label="Close" onClick={closeNodes}>
            <X />
          </HeadBtn>
        </>
      }
    >
      <SceneTree />
    </Sheet>
  );
}

function SceneTree(): React.JSX.Element {
  const rev = useUI((s) => s.rev);
  const selected = useUI((s) => s.selected);
  const editor = useController();
  const data = useMemo(() => {
    const build = (object: Object3D): TreeNode => ({
      id: object.uuid,
      name: object.name,
      type: object.type,
      object,
      made: !editor.authored(object),
      children: object.children.map(build),
    });
    return editor.host.root.children.map(build);
  }, [rev, editor]);
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className="se-tree">
      <Tree<TreeNode>
        data={data}
        openByDefault
        disableDrag
        disableDrop
        width={width}
        height={height}
        indent={16}
        rowHeight={34}
        {...(selected ? { selection: selected.uuid } : {})}
        onSelect={(nodes) => {
          const node = nodes[0]?.data.object;
          if (node && node !== editor.host.selected) editor.host.select(node);
        }}
      >
        {Row}
      </Tree>
    </div>
  );
}

function Row({ node, style }: NodeRendererProps<TreeNode>): React.JSX.Element {
  const selected = useUI((s) => s.selected);
  const d = node.data;
  return (
    <div style={style} className={cx('se-node', selected === d.object && 'se-sel', d.made && 'se-made')} onClick={() => node.select()}>
      <span
        className="se-caret"
        onClick={(event) => {
          event.stopPropagation();
          node.toggle();
        }}
      >
        {d.children.length ? node.isOpen ? <ChevronDown /> : <ChevronRight /> : null}
      </span>
      <span className="se-nodeName">{d.name || d.type}</span>
      {d.name ? <span className="se-nodeType">{d.type}</span> : null}
    </div>
  );
}
