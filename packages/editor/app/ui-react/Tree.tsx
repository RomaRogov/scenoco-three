import { useMemo } from 'react';
import { Tree as Arborist } from 'react-arborist';
import type { NodeRendererProps } from 'react-arborist';
import type { Object3D } from 'three';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getDeps, useUI } from './store.js';
import { isEditorOnly } from '../meta.js';
import { useSize } from './useSize.js';
import { cx } from './cx.js';
import styles from './ui.module.css';

/** One scene node projected into the tree (react-arborist reads `id`/`children`). */
interface TNode {
  id: string;
  name: string;
  type: string;
  obj: Object3D;
  children: TNode[];
}

/**
 * The element name the document wrote, not three.js's class.
 *
 * Every `@scenoco-three/ui` element is a `Mesh` subclass whose `.type` reads "Mesh", so a whole
 * HUD would otherwise be an indistinguishable stack of them.
 */
function typeName(node: Object3D): string {
  return getDeps().getDoc()?.tagNameOf(node) ?? node.type ?? node.constructor.name;
}

function build(obj: Object3D): TNode {
  const children = obj.children.filter((c) => !isEditorOnly(c)).map(build);
  const id = getDeps().getDoc()?.nodeAttr(obj, 'id');
  return { id: obj.uuid, name: id ? `#${id}` : `(${typeName(obj)})`, type: typeName(obj), obj, children };
}

/**
 * The scene hierarchy as a react-arborist tree — touch-friendly rows, virtualized,
 * with drag scaffolding ready for reparenting (wired to `onMove`, a no-op until the
 * document gains structural edits). Selecting a row selects the node everywhere.
 */
export function Tree(): React.JSX.Element {
  const rev = useUI((s) => s.rev);
  const selected = useUI((s) => s.selected);
  const select = useUI((s) => s.select);
  const { getScene, reparent } = getDeps();
  // Re-derive whenever the scene changes (rev bumps on open/edit/reload).
  const data = useMemo(() => {
    const scene = getScene();
    return scene ? [build(scene)] : [];
  }, [rev, getScene]);
  const [ref, { width, height }] = useSize<HTMLDivElement>();

  return (
    <div ref={ref} className={styles.tree} style={{ height: '100%' }}>
      <Arborist<TNode>
        data={data}
        openByDefault
        width={width}
        height={height}
        indent={16}
        rowHeight={30}
        selection={selected?.uuid}
        onSelect={(nodes) => {
          const n = nodes[0];
          if (n) select(n.data.obj);
        }}
        onMove={({ dragNodes, parentNode, index }) => {
          // Reparent under the drop target (the scene root when dropped at top level),
          // recorded as an undoable move + persisted comment-preservingly on save.
          const obj = dragNodes[0]?.data.obj;
          const root = parentNode?.data.obj ?? getScene();
          if (obj && root) reparent(obj, root, index);
        }}
      >
        {Node}
      </Arborist>
    </div>
  );
}

function Node({ node, style, dragHandle }: NodeRendererProps<TNode>): React.JSX.Element {
  const selectedUuid = useUI((s) => s.selected)?.uuid;
  const d = node.data;
  const hasKids = d.children.length > 0;
  return (
    <div
      style={style}
      ref={dragHandle}
      className={cx(styles.node, selectedUuid === node.id && styles.sel, node.willReceiveDrop && styles.drop)}
      onClick={() => node.select()}
    >
      <span
        className={styles.caret}
        onClick={(e) => {
          e.stopPropagation();
          node.toggle();
        }}
      >
        {hasKids ? node.isOpen ? <ChevronDown /> : <ChevronRight /> : null}
      </span>
      <span className={styles.nodeName}>{d.name}</span>
      {d.name.startsWith('#') ? <span className={styles.nodeType}>{d.type}</span> : null}
    </div>
  );
}
