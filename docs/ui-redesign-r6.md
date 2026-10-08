# UI redesign R6: automatic freshness

2026-10-08 (Asia/Calcutta). **Implemented; runtime verification deferred.**
Authority: [UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md),
R6 only. The user explicitly requested implementation without tests. R7 remains
Pending at the end of the original implementation session.

Handoff update, 2026-10-08: the user subsequently reported R6 completed and
verified locally. The active plan records **Verified locally (user-reported)**.
No verification commands or detailed evidence accompanied that confirmation;
the original session results below remain unchanged. R7's handoff is now prepared
in [ui-redesign-r7.md](ui-redesign-r7.md), with combined acceptance still pending.

## Application changes

The Pages sidebar has no routine Refresh action. Page-list failures retain cached
rows and show Retry pages beside the error. Invitations and existing-access lists
use the same cached-error behavior; Refresh invitations and the routine Check
link settings action are removed. Legacy invitation acceptance remains available.

Page, invitation and sharing metadata use shared 30-second staleness, bounded read
retry, stale mount/focus reads and reconnect refresh. Opening the sidebar checks
stale page/invitation caches without cancelling an existing read. Window focus
also refreshes stale active metadata when visibility has not changed. Create,
rename, delete and link join retain their established list invalidation; member,
invitation and link changes invalidate metadata without fetching editor documents.

The page list polls every 30 seconds while the sidebar is open. A single parent
observer polls invitations while the sidebar or inbox is open, avoiding a second
dialog polling timer. Existing access and link settings poll while their surfaces
are open. Polling and active-page access checks pause when the document is hidden
or the browser is offline. Cache keys and formats are unchanged; metadata reads
also send the existing expected-account header. Auth transitions still cancel
private reads and remove account caches through the established session owner.

ShareLinkActions restores pending nonsecret tab intents on mount. An uncertain
mutation receives up to two automatic attempts, delayed by one and three seconds.
Focus, visibility restoration and reconnect can resume checking. Each attempt
reuses the original request UUID, expected settings version and operation; it
cannot create a new intent or rebase a conflict. Rate limits and local preparation
failures require a deliberate retry. Failed bounded recovery retains error-only
Retry. Successful recovery invalidates metadata; conflicting settings are read
for review without replaying a different operation.

Automatic recovery bypasses the preparation helper that blurs inputs, commits
canvas interactions and flushes local saves. Existing account/page/navigation/
editor-session guards fence completions. A recovered Copy retains its URL in
memory and shows a nonmodal notice with Copy link and Dismiss. A fresh click copies
it; clipboard rejection can then open the established manual-copy dialog. No
background recovery dialog steals canvas focus. Link settings refresh also keeps
mutation-conflict feedback visible and cannot hide a failed pending request.

## Review and verification

Application TypeScript passed:

```text
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
```

The changes were reviewed against a temporary snapshot of their pre-session
contents, separating R6 from inherited uncommitted R0-R5/M11 work. Focused diff
checks passed, and the routine refresh labels are absent from application source.
Learning-document hashes are unchanged.

**No tests were added or run.** No build, browser execution, screenshots,
visual acceptance or API/database verification was performed. Runtime freshness,
hidden-tab timing, account switching, recovery and editor/history regression
checks remain unverified in this session. Do not mark R6 Verified locally based
on implementation checkboxes or historical R5 results.

Changed application files: `src/api/accountBoardQueries.ts`, `boards.ts`,
`sharing.ts`; `src/components/ServerBoards/PageSidebar.tsx`, `ServerBoards.tsx`,
`Sharing.tsx`, `ShareControls.tsx`, new `useVisiblePolling.ts`; and
`src/persistence/shareLinkActions.ts`. This note and the active plan hold the
handoff. Learning documents and prior evidence remain untouched.

No server routes, SQL, Prisma, IndexedDB/document format, packages, services,
database data, providers or production settings changed. No commit, push or
deployment was performed. Next: R7 integrated acceptance when requested,
including the deferred R6 runtime gate; normal SQL 12/key activation remains a
separate release action.
