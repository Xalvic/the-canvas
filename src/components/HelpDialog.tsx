import { Dialog } from "./Dialog";

export function HelpDialog({ open, close }: { open: boolean; close: () => void }) {
  return <Dialog open={open} title="Help and shortcuts" close={close}>
    <p>Draw freely on this device. Google sign-in opens your workspace. Choose “Bring this drawing into my workspace” to transfer your drawing and images; the original stays on this device.</p>
    <dl className="save-facts">
      <div><dt>Tools</dt><dd>V Select · H Hand · N Note · T Text · C Connector · F Frame · P Pen</dd></div>
      <div><dt>Move around</dt><dd>Space + drag to pan. Pinch to zoom on touch screens. + / − zoom; 0 resets the viewport.</dd></div>
      <div><dt>History</dt><dd>Ctrl/Cmd + Z to undo; Shift + Ctrl/Cmd + Z to redo. Finish a text edit with Escape.</dd></div>
      <div><dt>Pages</dt><dd>Open Pages to select a workspace page or choose + New page. Use a page’s actions to rename or delete it. Enter commits a title; Escape cancels. Workspace edits and newly added images save automatically. Older device-only images require one upload review.</dd></div>
      <div><dt>App menu</dt><dd>Change theme, open help, view save details, or export drawing data as a JSON file with its available images.</dd></div>
      <div><dt>Sharing</dt><dd>Owners use the current page’s Share button to create Google email invitations. Copy and send each link yourself; recipients choose Accept invitation in the invitation inbox.</dd></div>
      <div><dt>Recovery</dt><dd>Select the save status or a notice’s Details to see actual device/account status and recovery options.</dd></div>
    </dl>
  </Dialog>;
}
