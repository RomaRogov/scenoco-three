/** @jsxImportSource react */
import { ListTree, SlidersHorizontal } from 'lucide-react';
import { TopBar } from './TopBar.js';
import { NodesSheet } from './Nodes.js';
import { InspectorSheet } from './Inspector.js';
import { useController, useUI } from './store.js';
import { cx } from './parts.js';

export function App(): React.JSX.Element {
  return (
    <>
      <TopBar />
      <StatusLine />
      <Launchers />
      <NodesSheet />
      <InspectorSheet />
    </>
  );
}

/** What the editor has to say — a save, or why one was refused. Under the toolbar, not in it. */
function StatusLine(): React.JSX.Element | null {
  useUI((s) => s.rev);
  const { text, error } = useController().status;
  if (!text) return null;
  return (
    <div className={cx('se-status', error && 'se-error')} role="status">
      {text}
    </div>
  );
}

/** The two buttons that open the sheets, each hidden while its sheet is open. */
function Launchers(): React.JSX.Element {
  const { nodesOpen, inspectorOpen, openNodes, openInspector } = useUI();
  return (
    <>
      {!nodesOpen && (
        <button className="se-launcher se-launcherLeft" title="Node list" aria-label="Node list" onClick={openNodes}>
          <ListTree />
        </button>
      )}
      {!inspectorOpen && (
        <button className="se-launcher se-launcherRight" title="Inspector" aria-label="Inspector" onClick={openInspector}>
          <SlidersHorizontal />
        </button>
      )}
    </>
  );
}
