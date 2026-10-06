import { Dialog } from "./Dialog";

export function HelpDialog({ open, close }: { open: boolean; close: () => void }) {
  return <Dialog open={open} title="Help and shortcuts" close={close}>
    <p>Draw freely on this device. Google sign-in enables optional account copies and sharing; it never uploads your board by itself.</p>
    <dl className="save-facts">
      <div><dt>Tools</dt><dd>V Select · H Hand · N Note · T Text · C Connector · F Frame · P Pen</dd></div>
      <div><dt>Move around</dt><dd>Space + drag to pan. Pinch to zoom on touch screens. + / − zoom; 0 resets the viewport.</dd></div>
      <div><dt>History</dt><dd>Ctrl/Cmd + Z to undo; Shift + Ctrl/Cmd + Z to redo. Finish a text edit with Escape.</dd></div>
      <div><dt>Boards</dt><dd>Boards opens device and account work. Save to account creates a copy. Image upload is always an explicit choice.</dd></div>
      <div><dt>Sharing</dt><dd>Owners create Google email invitations. Copy and send each link yourself; recipients choose Accept invitation.</dd></div>
      <div><dt>Recovery</dt><dd>Select the save status or a notice’s Details to see actual device/account status and recovery options.</dd></div>
    </dl>
  </Dialog>;
}
