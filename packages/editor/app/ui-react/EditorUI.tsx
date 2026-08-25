import { TopBar } from './TopBar.js';
import { BottomLauncher } from './BottomLauncher.js';
import { NodeListSheet } from './NodeListSheet.js';
import { InspectorSheet } from './InspectorSheet.js';
import { AddMemberPopup } from './AddMemberPopup.js';
import { FilePicker } from './FilePicker.js';

/** The whole editor chrome: a responsive top bar, a bottom launcher, the two bottom sheets
 *  (node list + inspector), and the open dialog that stands in for all of it until a document
 *  is open. */
export function EditorUI(): React.JSX.Element {
  return (
    <>
      <TopBar />
      <BottomLauncher />
      <NodeListSheet />
      <InspectorSheet />
      <AddMemberPopup />
      <FilePicker />
    </>
  );
}
