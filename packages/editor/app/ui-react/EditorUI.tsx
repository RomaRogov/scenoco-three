import { TopBar } from './TopBar.js';
import { StatusLine } from './StatusLine.js';
import { BottomLauncher } from './BottomLauncher.js';
import { NodeListSheet } from './NodeListSheet.js';
import { InspectorSheet } from './InspectorSheet.js';
import { ConfigSheet } from './ConfigSheet.js';
import { AddMemberPopup } from './AddMemberPopup.js';
import { FilePicker } from './FilePicker.js';

/** The whole editor chrome: a responsive top bar, a bottom launcher, the two bottom sheets
 *  (node list + inspector), the form a config document opens as instead, and the open dialog
 *  that stands in for all of it until a document is open. */
export function EditorUI(): React.JSX.Element {
  return (
    <>
      <TopBar />
      <StatusLine />
      <BottomLauncher />
      <NodeListSheet />
      <InspectorSheet />
      <ConfigSheet />
      <AddMemberPopup />
      <FilePicker />
    </>
  );
}
