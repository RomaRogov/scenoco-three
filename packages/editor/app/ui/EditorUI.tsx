import { TopBar } from './TopBar.js';
import { BottomLauncher } from './BottomLauncher.js';
import { NodeListSheet } from './NodeListSheet.js';
import { InspectorSheet } from './InspectorSheet.js';

/** The whole editor chrome: a responsive top bar, a bottom launcher, and the two
 *  bottom sheets (node list + inspector). */
export function EditorUI(): React.JSX.Element {
  return (
    <>
      <TopBar />
      <BottomLauncher />
      <NodeListSheet />
      <InspectorSheet />
    </>
  );
}
