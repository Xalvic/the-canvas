# Workspace UX M6: account lifecycle and page navigation

Verified locally 2026-10-07. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`.
Next: **M7 only**, deliberate Google sign-in and resumable guest transfer.
M4/M5/M6 are included in the combined commit authorized 2026-10-07;
M0-M3 were previously committed. No push is authorized.

## Mounted controller and account states

`src/persistence/workspaceController.ts` owns account checks, workspace entry,
navigation and sign-out. `ServerBoards` mounts it once beside the existing single
`AccountBoardSession`, query client and collaboration cursor. `Account` displays
that state and delegates account checks/sign-out; it no longer owns another auth
effect or reports a service failure as a null user.

Lifecycle distinguishes auth-loading, guest, workspace, service-error, expired
and signing-out. Workspace phases distinguish loading, ready, empty, error,
reserved transfer and the temporary explicit device-board entry. Focus/online
checks verify identity without reopening the current document or following another
device's return preference. Reads and transitions are bounded, cancelable and
guarded by a navigation generation. Serialized preference writes have a separate
account epoch so a same-account check cannot silently drop a queued preference.

A network failure, malformed response, server error or account-check timeout
retains the known account/page and its history. Confirmed 401/session expiry
preserves work, clears private queries, signed image access and live state through
the existing session, and returns to the retained guest drawing. Sign-out commits
active text/pointer work and finishes local persistence before sending logout;
an uncertain logout response remains a service error until identity is confirmed.
Another account's titles, page, dialogs and canvas are hidden during transition.

## Entry, URLs and durable boundaries

`workspaceNavigation.ts` reads/writes `?page=<UUID>` on the current URL, preserving
`/scribble/`, other query parameters and the hash. Explicit page URLs take priority,
then a deliberate tab-scoped page target retained before Google redirect, then
last-opened state, then an owned-before-shared accessible fallback. Popstate opens
Back/Forward destinations; successful initial entry replaces the URL and explicit
page choices push it. Failed Back/Forward restores the still-loaded page's URL.
Unavailable/deleted destinations fall back without manufacturing pages.

Entry reads workspace state, cancels earlier list reads, then fetches an
authoritative account list. This ordering prevents an earlier empty list from
being paired with another tab's newly initialized state. A failed list never
initializes or represents an empty workspace. Uninitialized entry persists
`{requestId, createInitialPage}` under the account-scoped localStorage key
`scribble:workspace-initialization:<userId>` before POST. Uncertain responses reuse
that UUID and mode across retry/reload; confirmed initialization clears the local
intent. M4's permanent initialization marker remains authoritative after deletion.
Successful initialization updates/invalidates the visible list cache.

Before a page switch, the controller waits for initial guest hydration even when
its lease is passive, blocks native composition replacement, commits the existing
text/pointer boundary and flushes the serial local queue. A transient
`boardStore.navigationPending` flag prevents guest reacquisition/snapshot recovery
from racing the account read. It is not stored in IndexedDB. The existing session
reads current metadata/document/roles and its account-scoped journal, clears
selection/history and restores the page viewport. Its queued operations and active
save are both canceled on account changes; external navigation aborts cannot apply
late document results. Preference PATCH happens only after successful opening,
never as a command to navigate another tab/device.

The canvas stays mounted and retains its measured dimensions while hidden/inert;
using display:none would move its world viewport through ResizeObserver. Active
deletion calls back into workspace navigation. The final deletion shows an empty
workspace with New page, retains all device journals, and never automatically
reveals the guest drawing or recreates the default. Legacy explicit device/copy/
image controls remain usable until M9; their existing manual creation/upload flows
remain unchanged. Full creation/transfer/upload intent adoption remains M7/M8.

## M7 boundary and compatibility

The controller accepts an entry-intent getter returning `pendingTransfer`. M7 must
supply its durable, deliberately authorized and account-bound transfer intent.
The reserved path initializes with `createInitialPage:false` and defers ordinary
opening; an explicit page or invitation has priority. M6 does not create/import a
guest transfer merely because an account is detected. Existing invitation intent
and explicit acceptance remain intact through authentication. Fixtures simulate
authentication; no real Google/provider acceptance is claimed here.

No SQL migration, IndexedDB upgrade, package change or API contract was added.
IndexedDB v4/journal wrapper v1, guest `boards/current-board`, M3 identities,
M4 permanent initialization, M5 assets, selective undo and the pen renderer remain
compatible. M6 requires a backend with workspace APIs: a mixed older backend yields
an actionable error and preserves device data, with no legacy initialization
fallback. Release order remains SQL migrations 9-11 -> compatible backend ->
frontend. Keep additive SQL/receipt/journal data and the v4 opener on rollback.
Next unused SQL number remains **12**.

## Validation and handoff

136 focused client/controller/persistence cases passed, including 30 new controller
cases and one save-versus-account-transition case. 40 standard browser regressions
passed, covering guest handoff, wake, roles, drafts, manual image/copy flows and
sharing. 15 actual browser/API/Prisma/PostgreSQL cases passed: ten M6 journeys plus
five existing M2 journal/collaboration/migration cases. These include simultaneous
first entry, lost initialization/save responses, reload, URLs/Back/Forward,
viewport/history isolation, service errors/slow reads, sign-out text commits,
expiry, deletion, current viewer/revoked access, invitation/page intent and account
switching. The legacy fixture seeds disk data before automatic entry, preserving
its original migration assertions.

```text
npm test -- src/persistence/workspaceController.test.ts src/persistence/accountBoardSession.test.ts src/api/accountBoardQueries.test.ts src/api/workspace.test.ts src/persistence/accountEditorJournals.test.ts src/persistence/localBoardStorage.test.ts src/persistence/boardTabCoordinator.test.ts
npm run test:e2e -- e2e/account-boards.spec.ts e2e/ux-simplification.spec.ts e2e/workspace-wake.spec.ts e2e/workspace-tabs.spec.ts --output=test-results/m6-browser
npm run test:e2e:integration -- e2e-integration/workspace-navigation.spec.ts e2e-integration/workspace-journals.spec.ts --output=test-results/m6-integration
npm run build
npm run build:server
npx tsc -p e2e-integration/tsconfig.json
npx tsc --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution Bundler --jsx react-jsx --lib ES2023,DOM --types vite/client,node src/persistence/workspaceController.test.ts src/persistence/accountBoardSession.test.ts
git diff --check
```

`../workspace-ux-evidence/m6-database-isolation.json` records identical data and
definition fingerprints for all 12 normal public tables/14 rows, with zero
disposable browser schemas remaining. The real tests use a disposable schema and
controlled storage only. No normal/production migration, real provider mutation,
push or deployment occurred. All pending updates are included in the combined
commit authorized 2026-10-07. Docker 5434 remains running. Physical native
IME/sleep/device acceptance and the full integrated release matrix remain M11.
