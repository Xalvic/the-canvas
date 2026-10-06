# Scribble: single guest whiteboard and signed-in workspace

Created: 2026-10-06. Status: M0-M6 verified locally; M7 is next.

## Session entry: read this first

Execute **one milestone per session**, then save a handoff and stop. The user
explicitly requested this boundary to reduce repeated context and token use.
Do not use the previous end-to-end execution prompt.

1. Read `AGENTS.md` and `docs/learning-checkpoint.md` once per new session.
2. Read sections 1, 8, and 9 of this file for authority, constraints, and current
   handoff. Use the milestone table in section 6 to choose the first incomplete
   milestone whose dependencies are verified, unless the user names a milestone.
3. Read only that milestone's block and its listed reference sections/files. Use
   heading searches and bounded reads; do not load this whole plan, old plans,
   completed implementation history, or unrelated source into every session.
4. Implement and validate that milestone. Do not start the next milestone in the
   same session, even when it looks small, unless the user explicitly extends scope.
5. Update the status table, compact handoff in section 9, and the brief learning
   checkpoint for a substantial implemented milestone. End with the next milestone ID.

The earlier research is already complete. Reuse it; browse again only when a new
technical uncertainty needs verification. Run focused checks for each milestone;
the full integrated validation belongs to M11. Do not repeat passed checks without
new changes, failures, or unresolved concerns that justify them.

## 1. Objective and authority

Deliver a familiar whiteboard experience modeled on tldraw's canvas, navigation,
and unobtrusive saving:

- Before sign-in: one immediately usable whiteboard, persisted on this device.
- After Google sign-in: one personal workspace containing pages, with automatic
  account saving, page navigation, and sharing.
- A **page** is one independent infinite canvas. Existing account boards become
  pages in the interface. The workspace is the account's collection of pages.
- Remove the routine Save to account, Upload and save, device/account chooser,
  and repeated diagnostic status flows.
- Losing focus, switching to an unrelated browser tab, or waking a device must
  not produce a false "Editing in another tab" warning or require manual reopening.

The user explicitly permits API updates, new APIs, and necessary data-model
changes. Do not limit this delivery to CSS or hide broken behavior behind cleaner
wording. This file is the current product direction and supersedes conflicting
UX proposals in `docs/ux-simplification-plan.md` and its old wireframe. Those files
remain useful implementation history, not the acceptance criteria for this work.

This planning session authorizes writing this plan only. Implementation starts
when the user supplies the execution prompt. That prompt authorizes necessary
local code changes, commands, and validation; production changes, commits, pushes,
and deployment remain separate actions requiring explicit authorization.

## 2. Evidence and starting points

Research was performed on 2026-10-06 against the live tldraw guest interface at
1440 x 900 and 390 x 844, and repository commit
`035b741dc331bf76a4cb9af27c346be10bba2a88`. Signed-in behavior was inspected in
source, not through a real signed-in tldraw account.

- [Live tldraw](https://www.tldraw.com/): canvas-first guest screen, bottom drawing
  tools, compact menus, contextual styles, and a small sign-in entry.
- [Workspace sidebar](https://github.com/tldraw/tldraw/blob/035b741dc331bf76a4cb9af27c346be10bba2a88/apps/dotcom/client/src/tla/components/TlaSidebar/TlaSidebar.tsx):
  collapsible navigation with creation, recent items, and account controls.
- [Create action](https://github.com/tldraw/tldraw/blob/035b741dc331bf76a4cb9af27c346be10bba2a88/apps/dotcom/client/src/tla/components/TlaSidebar/components/TlaSidebarCreateFileButton.tsx):
  create, navigate directly, and close the mobile sidebar.
- [Guest and return navigation](https://github.com/tldraw/tldraw/blob/035b741dc331bf76a4cb9af27c346be10bba2a88/apps/dotcom/client/src/tla/pages/local.tsx):
  separate guest editor, pending sign-in/import handling, and reopening recent work.
- [Persistence documentation](https://tldraw.dev/docs/persistence): document data
  and local session state are separate; local persistence can synchronize tabs.

Scribble will use one flat page list. tldraw's additional file/page/workspace
hierarchies are not all part of this scope. Retain Scribble's renderer and current
React/TypeScript/Vite stack; this is not an SDK replacement.

### Confirmed current issues

- `ServerBoards.tsx` renders Boards and Save to account even on the guest canvas.
- `Account.tsx` makes ordinary sign-in pass through an account-management dialog.
- `accountBoardSession.ts` supports blank creation, copying, document autosaving,
  image upload, collaboration, and recovery, but its image uploads remain explicit.
- `POST /api/boards` currently creates metadata with a new random ID on every
  request. Lost-response retries cannot safely identify the original creation.
- Image uploads reserve a new random asset per request. An uncertain provider
  response retains the reservation, but transparent retries need a stable identity
  and reconciliation before re-uploading.
- `BoardTabCoordinator` has a 20-second lease and 5-second heartbeat. `renew()`
  rejects an expired lease even if no second writer ever appeared. The UI maps
  `tabReadOnly` to "Editing in another tab" without proving that claim.
- An isolated in-memory IndexedDB reproduction created only one coordinator,
  advanced its clock by 20,001 ms, and called `renew()`. Ownership was lost and
  `savePresentation()` returned that warning. This proves the code path, not the
  exact production browser throttling schedule.

### Targeted code map

| Area | Start here |
| --- | --- |
| App lifetime | `src/App.tsx` |
| Current header/browser/dialogs | `src/components/ServerBoards/ServerBoards.tsx`, `BoardBrowser.tsx`, `SaveFlow.tsx`, `RecoveryDialog.tsx`, `Sharing.tsx` |
| Account and status | `src/components/Account/Account.tsx`, `src/components/SaveStatus.ts`, `src/components/BoardIdentity/BoardIdentity.tsx` |
| Canvas controls | `src/components/Toolbar/Toolbar.tsx`, `src/components/ZoomControls/ZoomControls.tsx`, `src/canvas/viewport/CanvasViewport.tsx` |
| Active page and persistence | `src/store/boardStore.ts`, `src/persistence/accountBoardSession.ts`, `useLocalBoardPersistence.ts`, `localBoardStorage.ts`, `boardTabCoordinator.ts` |
| Client requests | `src/api/boards.ts`, `src/api/accountBoardQueries.ts`, `src/api/auth.ts`, `src/api/collaboration.ts` |
| Server routes/data | `server/app.ts`, `server/boards.ts`, `server/postgresBoards.ts`, `server/documents.ts` |
| Live collaboration | `server/collaborationRoutes.ts`, `server/collaboration.ts`, `server/contracts/collaboration.ts` |
| Images | `server/imageAssets.ts`, `server/assets.ts`, `server/postgresAssets.ts`, `server/imageKit.ts` |
| SQL authority | `db/*.sql`, `server/migrations.ts`; mappings in `prisma/schema.prisma` |

Read `AGENTS.md` and `docs/learning-checkpoint.md` once at the beginning of the new
session. Then follow these entry points and direct dependencies. Do not recursively
scan or reread all project history. Recheck actual code before relying on this map.

## 3. Product behavior

### Guest

- Open directly into the existing `current-board` canvas. Drawing and local
  IndexedDB saving work independently of account-service availability.
- Show the app menu, drawing tools, zoom, contextual appearance, and one
  **Sign in with Google** entry. Keep theme/help/export in the app menu.
- Hide the workspace, page list, New page, and sharing controls. Do not show
  disabled page-management controls as upsells.
- Reload restores the same drawing and viewport. No guest multi-page feature.
- Local-saving success is quiet. A real local-save failure remains visible and
  actionable; never claim it is saved if IndexedDB failed.

### Google sign-in and existing guest work

- With an empty guest canvas, the Google action goes directly to authentication
  after the local save boundary completes.
- With existing guest content, the sign-in surface contains one explicit,
  initially unselected **Bring this drawing into my workspace** choice beside
  the Google continuation action. Explain that this includes its images. This is
  the only transfer-consent step; there is no later Save to account button.
- If selected, persist a transfer intent and source snapshot locally before OAuth.
  After successful authentication, create one destination page, transfer supported
  assets, save the document, and open it. Preserve the original guest drawing.
- If not selected, retain the guest drawing on this device and open the user's
  workspace. A secondary account-menu action can later bring in that retained
  drawing through the same explicit consent flow; it is not a normal header action.
- Mere session restoration or account detection must never import guest content.
- Scope an intent to the deliberate flow and bind it to the authenticated account
  on return. Persist destination/request IDs before subsequent operations. Failed
  or canceled sign-in must not consume the intent or erase the source; stale or
  canceled intents must not execute on an unrelated later login.
- Respect an invitation/deep-link destination. Invitation authentication does not
  auto-import unrelated guest work or auto-accept invitations. If both deliberate
  intents exist, retain the transfer for an explicit resume after the invitation.

### Signed-in workspace

- Use one personal workspace, a collapsible left sidebar, a flat list of pages,
  and **+ New page**. Desktop remembers sidebar visibility; mobile starts closed.
- New page opens a ready-to-edit untitled canvas without a required naming dialog.
  Rename inline; Enter commits and Escape cancels. One click opens a page.
- Keep secondary Rename/Delete actions under a labelled overflow menu. Confirm
  deletion. Do not add folders, teams, multiple workspace management, or reordering
  unless a later user request requires them.
- List owned pages first; show a small Shared with me group only when applicable.
  Invitations live in an inbox/notification entry, not a mandatory navigation tab.
- Reopen the explicit page URL when present, otherwise the last accessible page.
  Support reload and Back/Forward. Respect the deployed `/scribble/` base path.
  A base-compatible query such as `?page=<boardId>` is sufficient; do not require
  new hosting rewrites just for client navigation.
- On first entry, initialize an untitled page only if there is no accessible page
  and no pending guest transfer. Multiple tabs/devices must not create duplicate
  first pages. A failed page-list request is never an empty workspace.
- After deleting the final page, show an intentional empty workspace with New page;
  do not silently recreate deleted content or reveal the guest canvas.
- Scope cached pages and last-opened state by account. Do not display another
  account's cached page during sign-out or account switching.
- Page switching saves/journals pending work first, respects active text/pointer
  commits, clears stale selection, restores that page's viewport, and isolates
  undo history. No undo operation may mutate a different page after switching.

### Canvas layout and sharing

- Top left: app menu, sidebar toggle when signed in, current page title.
- Top right: Google sign-in for guests; avatar, permitted Share action, and
  relevant collaborators for signed-in users.
- Bottom center: main drawing tools and compact undo/redo. Bottom left: zoom/fit.
- Contextual styles: beside the canvas on desktop; compact popover on mobile.
- Opening a sidebar or resizing the viewport must not shift world-space content
  unexpectedly or break pointer-coordinate conversion.
- Preserve owner/editor/viewer semantics. Share opens a focused dialog for the
  current page. Keep the existing email-bound invitation and link-copy behavior.
  This plan does not add anonymous public editing or email delivery.
- Keep menus keyboard accessible, label icon buttons, restore focus, and prevent
  menu/dialog shortcuts from leaking to the canvas. Avoid layout overlap with the
  soft keyboard and mobile safe areas.

### Automatic saving and exceptional states

- Every workspace page automatically saves durable document and title changes.
  Pasted/dropped/inserted supported images upload automatically as part of that
  user action. Routine use never requires Upload and save or Save to account.
- A small Saving/Saved indicator is enough. "Saved" for a workspace page means
  its latest document, title, and referenced assets are remotely confirmed.
- Offline work may continue on an already loaded recoverable page under the
  established permission policy. Show a concise offline/pending state and retry
  safely on reconnection. This does not add offline app installation/loading.
- For initial scope, creating an entirely new account page requires connectivity.
  Preserve the current canvas and show a local retry message when creation fails.
- Auth loading, service timeout, and confirmed sign-out are distinct states.
  A slow API must not bounce a signed-in user into guest mode or discard drafts.
- Sign-out preserves pending account work in account-scoped drafts, clears cloud
  access and visible account state, and returns to the retained guest canvas.
  Confirmed session expiry must similarly protect pending work and offer sign-in.
- Show one actionable message for real errors, not duplicate header/banner text.
  Recovery details remain available on demand for divergent drafts or permanent
  failure. Never silently replace an unconfirmed local document with a remote one.
- Automatic retries are bounded, use backoff, honor rate-limit responses, and stop
  on authentication, permission, validation, or cancellation failures. Repeated
  failure offers one Retry action rather than an endless stream of notifications.

## 4. Tab ownership and collaboration design

### Immediate false-warning fix

Separate coordination states: acquiring, owned, expired/unverified, verified other
writer, and storage unavailable. Initial acquisition must not briefly flash a
warning. Focus/visibility changes are lifecycle signals, not proof of another tab.

On wake or timer expiry, compare durable owner/token and actual Web Lock ownership.
If no intervening writer exists, safely renew/reacquire without clearing history
or generating a false recovery draft. If ownership changed, preserve pending work
and reconcile the latest durable record before admitting writes. Retain atomic
lease/token checks in the same IndexedDB transaction as writes. Never fix this by
removing write protection or merely increasing the timeout.

### Actual simultaneous tabs

- Signed-in pages: support multiple editors through the existing revision/operation
  and SSE collaboration protocol, including two tabs of the same account. A local
  canonical-draft lock must not unnecessarily make one cloud editor read-only.
- Recommended persistence model: keep board identity unchanged, but use separate
  editor-session journals for unacknowledged work. Give each live editor a unique
  identity, including duplicated tabs; keep operation IDs stable across recovery.
  A compatible shared snapshot may be coordinated separately. Scope image mappings
  and writes so one tab cannot erase another tab's pending operations.
- Recover prior journals after reload/crash under the correct account. A newer
  timestamp alone is not proof that older pending operations can be deleted. See
  the migration section before changing existing draft keys.
- Guest tabs: retain one canonical local whiteboard with synchronized snapshots
  and a coordinated writer/handoff. The newly active tab requests a safe handoff;
  the prior writer flushes committed work, releases, and the new writer reloads or
  reconciles before editing. Preserve interrupted strokes and text composition.
- If a real writer cannot release promptly, keep the second guest view safe and
  show a precise contextual state only when editing is attempted. A temporary
  "Continue editing here" action is acceptable for verified contention; a
  permanent instruction to close another tab is not the normal workflow.
- Never steal an actively held Web Lock solely because a heartbeat is old. Define
  and test fallback behavior when Web Locks or BroadcastChannel are unavailable.
- Different boards must not block each other. Different browsers/devices do not
  share an IndexedDB lease; cloud collaboration handles those writers.

M2's implemented journal schema/handoff protocol is recorded in
`docs/workspace-ux-m2.md` and section 9's durable contract notes. Preserve these
ownership and recovery boundaries while implementing subsequent milestones.

## 5. API and database work

The following is the recommended contract. Small route/payload adjustments are
allowed after inspecting existing conventions; record the final contract in this
file. Required outcomes are reliable creation, deterministic workspace entry,
safe uploads, current authorization, and compatibility with existing data/clients.

Keep existing `/api/boards` resource names internally. UI pages map one-to-one to
boards. A personal workspace needs per-user state, not a new team/membership model.

| API | Planned behavior |
| --- | --- |
| `GET /api/workspace` (new) | Read current user's initialization and last-opened-page state; return `initialized` and nullable `lastOpenedBoardId`. No creation side effect. List pages through existing `GET /api/boards`. |
| `POST /api/workspace/initialize` (new) | Accept stable `requestId` and `createInitialPage` boolean. Serialize first initialization per user. Create one blank page only when requested and no accessible page exists. Pending guest import uses `false`. Return workspace state and any created/openable board metadata. Subsequent calls do not manufacture another first page. |
| `PATCH /api/workspace` (new) | Persist nullable `lastOpenedBoardId` after successful page opening. Validate current access. This preference must not change the user's currently displayed page when another device updates it. |
| `POST /api/boards` (extend) | New client sends `requestId` and `initializeDocument: true` with `title`. Atomically create board metadata, a blank document, and a durable creation receipt. Return the board and confirmed document revision; repeat requests return the same destination. Preserve legacy `{title}` behavior during rollout. |
| Existing board GET/PATCH/DELETE | Retain ownership and role checks. Rename autosaves; delete clears or safely invalidates last-opened references. An inaccessible/deleted last page falls back to another accessible page or the empty workspace. |
| Existing document and `/operations` APIs | Reuse compare-and-swap, durable operation receipts, and selective collaboration semantics. New clients start from the revision returned by atomic creation; do not assume revision zero. |
| `POST /api/boards/:id/assets` (extended in M5) | Optional stable UUID header `X-Scribble-Upload-Request`, scoped to actor/destination and hashed original MIME/bytes. Keyed POST returns `200 {upload}` ready or `202 {upload}` pending; replay reuses the original reservation before quota admission. Changed bytes conflict (409); cleaned identities are terminal (410). Legacy no-header `201 {asset}` remains. |
| `GET /api/boards/:id/asset-uploads/:requestId` (M5) | Returns `200 {upload}` pending/ready/failed with original asset ID, bounded delay and retry permission. Current edit access/original actor required. May reconcile/finalize the original provider file but never uploads bytes; no provider secrets or signing-budget charge. |
| Auth, sharing, presence, events | Reuse current Google OAuth, permission, invitation, and SSE contracts. Add only fields needed by the above flows. |

### Retry and transaction requirements

- Scope creation receipts by authenticated actor and request ID; hash the relevant
  canonical payload. Same ID/same payload returns the same board; same ID/different
  payload returns a defined conflict. Concurrent requests and process restarts must
  not create duplicates. A receipt whose board was deleted must not recreate it.
- Persist the request ID and pending intent before dispatch. A lost response must
  resume the same operation after reload. Once the destination is known, all image
  and document retries target that destination.
- Use a per-user transaction lock/unique state row for initial workspace creation.
  Client-side disabling of New page is not an idempotency guarantee.
- Guest transfer is a resumable sequence: preserve source -> initialize workspace
  without blank page -> create destination -> upload assets -> commit document ->
  mark transfer complete/open destination. The source stays recoverable at every
  interruption. Destination creation alone is not transfer success.
- Never replay a committed initial snapshot over newer edits. In-progress import
  must either keep its source snapshot immutable while the destination prepares or
  explicitly journal subsequent edits. Do not enable an editable blank destination
  and later overwrite it with the imported snapshot.
- Asset retries compare the key, board, actor, and content identity. Reconcile
  uncertain provider writes by the durable reservation/path before uploading again.
  Do not hold a database transaction open during a provider network request. Handle
  in-progress retries without duplicate provider files or quota charges.
- Apply current authorization on replay/status reads as well as first execution.
  Do not leak existence or content through an idempotency endpoint.
- Mount new workspace routes behind the same session, mutation-origin/header,
  production proxy, and durable rate-budget protections as board routes. Observe
  parser ordering and body limits in `server/app.ts`.
- `renameBoardSchema` currently aliases `createBoardSchema`: split their schemas
  when extending create so rename cannot accept creation-only fields.

### SQL and compatibility

- Add ordered SQL migrations using the next unused migration numbers. As of
  planning, versions 1-8 exist; recheck before allocating new numbers. SQL and
  `server/migrations.ts` remain authoritative; update Prisma mappings/client as
  needed, not through an independent Prisma migration history.
- Recommended additions: a per-user workspace-state row, actor-scoped page-creation
  receipts, and upload-request identity/receipt state attached to existing assets
  or a dedicated receipt table. Decide indexes, payload hashes, status fields,
  deletion behavior, and bounded retention explicitly.
- Keep completed creation identity/tombstone information long enough that replay
  of any retained local intent cannot create a duplicate or resurrect a deletion.
  Define a terminal expired-intent response rather than silently treating an old
  request as new. Tie server receipt retention to the client recovery contract.
- Existing board IDs, owners, members, invitations, images, document formats, and
  URLs remain valid. Do not rename every SQL table merely to match the word Page.
- Existing users initialize workspace preferences lazily and retain all their
  current pages. Do not auto-claim ownerless legacy rows.
- Preserve `current-board`, legacy account-draft records, image blobs, saved asset
  mappings, pending saves/operations, and recovery copies. Read or migrate older
  records safely before adopting new journal keys; never delete the only copy.
- Tests must cover rollback, existing-data preservation, API/backend restart, and
  the older-client creation path. Apply migrations only to disposable test schemas
  during implementation unless a separate database target is explicitly approved.

## 6. Session-sized milestones

Each milestone is a separate implementation session with its own deliverable and
validation gate. All are required for the finished product, but a session is done
when its selected milestone passes and its handoff is saved. Do not combine them
into the former six large phases. Dependencies are prerequisites, not permission
to execute several milestones in one session.

| ID | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| M0 | Confirm baseline and reusable fixtures | None | Verified |
| M1 | Fix false other-tab warning and safe wake recovery | M0 | Verified |
| M2 | Safe guest handoff and simultaneous account editors | M1 | Verified |
| M3 | Retry-safe page creation API and SQL receipts | M0 | Verified |
| M4 | Workspace initialization and last-opened-page APIs | M3 | Verified |
| M5 | Retry-safe image uploads and reconciliation | M3 | Verified |
| M6 | Account lifecycle and workspace navigation controller | M2, M4 | Verified |
| M7 | Google sign-in and resumable guest transfer | M5, M6 | Pending |
| M8 | Automatic document, title, and image saving | M5, M6, M7 | Pending |
| M9 | Minimal guest UI and signed-in page sidebar | M6, M7, M8 | Pending |
| M10 | Toolbar layout, responsive behavior, and accessibility | M9 | Pending |
| M11 | Integrated validation and release handoff | M0-M10 | Pending |

Default order is M0 through M11. If a milestone proves too large for one session,
save an explicit incomplete handoff with the next substep and validation state;
resume that milestone next time. Do not label incomplete work Done to fit a session.
The user has not specified a numeric token budget, so do not invent one or trade
away correctness to hit an arbitrary limit.

### M0 - Confirm baseline and reusable fixtures

**Read:** section 2's confirmed issues/code map, Git status, and only the existing
fixture/test setup needed to reproduce guest and signed-in behavior.

- [x] Confirm the repository still matches the recorded starting assumptions.
- [x] Reuse the completed tldraw research; record only material differences.
- [x] Reproduce the isolated one-tab expiry and capture baseline guest/owner UI.
- [x] Identify reusable auth, API/DB, role, offline, and lost-response fixtures.
  Create only missing baseline helpers, not every future scenario in advance.
- [x] Record fixture commands and the code entry points for M1 in the handoff.

Verified 2026-10-06. Evidence and exact commands: `docs/workspace-ux-baseline.md`.

**Gate:** a verified baseline and usable fixtures. No product feature or API
implementation is required here; do not replan all later milestones.

### M1 - Fix the false other-tab warning

**Read:** section 4's immediate fix; `boardTabCoordinator.ts`,
`useLocalBoardPersistence.ts`, `SaveStatus.ts`, and their focused tests.

- [x] Separate expired/unverified ownership, real contention, and storage failure.
- [x] Recover a sole writer on wake without false warnings, lost work, or unnecessary
  history clearing; preserve atomic token/lease checks.
- [x] Prevent initial acquisition/loading from flashing another-tab warnings.
- [x] Keep real competing writers protected while M2's broader work is pending.

**Gate:** focused ownership tests and an isolated browser wake/background case pass;
stale-writer protection still holds. Stop before implementing the multi-tab redesign.

Verified locally 2026-10-06: 65 focused unit tests, seven browser lifecycle/storage
cases, one converted M0 expiry check and three actual browser/API/DB cross-tab
scenarios pass. Build and focused browser-spec typecheck pass. Behavior, exact
commands and remaining fallback boundaries: `docs/workspace-ux-m1.md`.

### M2 - Support actual simultaneous tabs safely

**Read:** section 4 and section 5's local compatibility requirements;
`localBoardStorage.ts`, `accountBoardSession.ts`, the stores/persistence dependencies
they directly use, and cross-tab/collaboration integration fixtures.

- [x] Finalize and record guest handoff and account editor-journal contracts.
- [x] Implement synchronized guest snapshots and safe automatic writer handoff.
- [x] Isolate account editors' pending work while reusing server collaboration.
- [x] Preserve old draft keys, assets, pending operations, and crash recovery.
- [x] Handle duplicated tabs, interrupted strokes/text, different pages, sleeping
  writers, and missing Web Locks/BroadcastChannel with safe fallbacks.

**Gate:** real two-tab guest and same-account collaboration tests pass without stale
overwrites; reload and legacy-record checks pass. Record the selected schema and
ownership boundaries so later sessions need not rediscover them.

### M3 - Make page creation retry-safe

**Read:** section 5's create API, receipt/transaction rules, and SQL compatibility;
board routes/stores, document creation, migrations, Prisma mappings, and client
creation adapters. Do not read image-provider internals yet.

- [x] Extend page creation with stable request identity, atomic blank document,
  returned revision, and durable creation receipts.
- [x] Preserve legacy creation behavior; split create/rename validation schemas.
- [x] Add SQL/Prisma changes, HTTP fixtures, and typed client request support.
- [x] Verify concurrent duplicates, lost responses, restart, payload mismatch,
  actor isolation, deleted destinations, and receipt retention behavior.

**Gate:** focused HTTP and real PostgreSQL tests prove one destination per request
and legacy compatibility. Record exact request/response/error shapes and migrations.

Verified locally 2026-10-06: 120 focused HTTP/client cases and 83 real PostgreSQL
checks across creation/migrations/boards/auth/assets/sharing/collaboration pass.
Actual API process restarts, SQL/Prisma no-drift, both builds, targeted typechecks,
and public-data/schema cleanup checks pass. Contracts/commands/release boundaries:
`docs/workspace-ux-m3.md`. Migration 9 touched disposable test schemas only.

### M4 - Add workspace state and initialization

**Read:** section 3's workspace entry behavior and section 5's workspace endpoints;
M3's recorded contracts, auth/access middleware, board-list implementation, and
workspace-state SQL/client modules introduced here.

- [x] Add read/update workspace state and last-opened accessible page.
- [x] Serialize first initialization, including the no-blank-page import mode.
- [x] Preserve existing users/pages and define deleted/inaccessible last-page and
  intentionally empty workspace behavior.
- [x] Apply existing session, origin, proxy, and rate protections to new routes.

**Gate:** first initialization in concurrent tabs/devices creates at most one default
page; access checks and last-page deletion behave as specified. Record API contracts.

Verified locally 2026-10-06: 171 focused HTTP/client cases and 119 distinct real
PostgreSQL checks pass, including simultaneous API processes, restart, import mode,
permissions, final deletion, transaction/SQL rollback and existing-data preservation.
Both builds, strict touched-test typechecks and SQL/Prisma no-drift pass. Migration
10 touched disposable schemas only. Final contracts: `docs/workspace-ux-m4.md`.
Initialization returns HTTP 200 with workspace/current opening candidate and echoed
request acknowledgement; it never rewrites documents or resets initialization.
Last-opened preferences change only on PATCH. The current UI is still unchanged.

### M5 - Make image upload retries safe

**Read:** section 5's upload/reconciliation requirements; `imageAssets.ts`,
`assets.ts`, `postgresAssets.ts`, `imageKit.ts`, upload adapters, and focused tests.

- [x] Add stable upload request identity and durable pending/ready/failed state.
- [x] Reconcile uncertain provider writes before allocating/uploading again.
- [x] Add status lookup or equivalent replay contract, bounded retries, and
  current permission checks on both initial and repeated requests.
- [x] Preserve quotas, validation, referenced assets, and completed mappings.

**Gate:** real API/DB tests with controlled provider responses cover lost responses,
concurrent retries, restart, content mismatch, revocation, and rate limits without
duplicate assets/quota charges. Automatic UI upload orchestration belongs to M8.

Verified locally 2026-10-06: 170 focused client/HTTP cases and 141 distinct real
PostgreSQL cases, including 22 new upload cases, independent API processes,
discarded responses/restart and API crash after provider storage. Migration 11
adds retained actor/board/request identity, original-byte hash and fenced leases/
three-write counter to existing assets. Both builds, strict typechecks, SQL/Prisma
no-drift and normal-database fingerprints pass; zero disposable schemas remain.
Contract/commands: `docs/workspace-ux-m5.md`. No normal/production migration or
real provider changes. Existing manual UI stays legacy until M8; new adapters
require caller-owned persisted intents. M4/M5 are uncommitted. Next: M6 only.

### M6 - Implement workspace lifecycle and navigation

**Read:** section 3's workspace/lifecycle rules; completed API and journal contracts;
`App.tsx`, account/session controller, board store, and relevant request adapters.

- [x] Keep one mounted controller and distinguish guest/auth-loading/workspace,
  service failure, confirmed expiry, and sign-out.
- [x] Implement page URL, Back/Forward, last-page restore, safe switching, and
  first initialization; reserve pending transfer intent priority for M7.
- [x] Prevent stale async responses, wrong-page history, account-cache leakage,
  duplicate first-page creation, and loss of pending work on logout/expiry.
- [x] Preserve existing invitation/deep-link intent through authentication.

**Gate:** focused controller/browser tests cover account entry, switching, reload,
navigation, slow/error responses, logout, and current roles. Keep the existing UI
usable until M9; this milestone does not require the visual redesign.

**Verified 2026-10-07:** 136 focused controller/client/persistence cases, 40 standard
browser regressions and 15 real browser/API/Prisma/PostgreSQL cases pass. Both
builds, strict touched-test/fixture typechecks and diff checks pass. Account
timeouts preserve known identity; URLs, safe journaled switching, serialized return
preferences, permanent first initialization, intentional final deletion and M7's
transfer-priority hook are wired. All 12 normal tables/14 rows are unchanged;
zero disposable schemas remain. Contract/commands: `docs/workspace-ux-m6.md`.
M4-M6 are included in the combined commit authorized 2026-10-07. Next: M7 only.

### M7 - Implement Google sign-in and guest transfer

**Read:** section 3's sign-in/transfer behavior and section 5's transfer transaction
rules; account UI, invitation intent, session controller, and completed API adapters.

- [ ] Provide direct empty-canvas Google sign-in and explicit existing-drawing consent.
- [ ] Persist a scoped source snapshot/intent and resume on the same destination
  through creation, images, document confirmation, and reload.
- [ ] Preserve the guest original and pending edits; prevent later imports from
  session restoration, declined consent, canceled OAuth, or unrelated accounts.
- [ ] Handle invitation priority and a deliberate later import from the account menu.

**Gate:** transfer/decline/cancel/failed-auth and interruption tests prove no unsolicited
upload, duplicate destination, or overwritten newer edits. Document real-Google
checks separately from fixture verification.

### M8 - Automate workspace saving

**Read:** section 3's saving rules; completed upload/creation contracts;
`accountBoardSession.ts`, save state, image insertion hooks, and relevant tests.

- [ ] Integrate document/title autosaving and automatic uploads for new image actions.
- [ ] Resume only authorized transfers/uploads; handle legacy unconsented images
  through one migration consent while keeping all local content recoverable.
- [ ] Implement truthful confirmed/pending/error status and bounded reconnection
  retries that reuse request IDs, asset mappings, and operation receipts.
- [ ] Retain assets needed by undo/redo and stop retries on terminal access failures.

**Gate:** drawing, renaming, supported-image insert/paste/drop, offline/reconnect,
lost responses, and undo/redo pass focused browser/API checks without manual saving.
Obsolete presentation controls are removed in M9 after this behavior is verified.

### M9 - Replace guest and workspace navigation UI

**Read:** section 3's guest/workspace/sharing rules; current header/browser/account,
title, sharing, recovery, and help components; verified M6-M8 contracts.

- [ ] Show minimal guest chrome with no page management or routine save controls.
- [ ] Build the signed-in page sidebar, New page, direct selection, inline rename,
  overflow deletion, avatar menu, shared group, and contextual invitation entry.
- [ ] Wire the current-page Share dialog and preserve actual permission behavior.
- [ ] Remove normal-path SaveFlow/device-account browsing and duplicated notices;
  retain useful recovery actions and update help/copy/selectors.

**Gate:** real guest/owner/editor/viewer journeys use the new UI and controllers;
no fake-data wireframe or missing backend behavior stands in for a finished flow.

### M10 - Finish canvas layout and accessibility

**Read:** section 3's layout rules; Toolbar, ZoomControls, relevant viewport placement
code, style files found by targeted search, and responsive/accessibility fixtures.

- [ ] Arrange drawing tools/history, zoom, contextual styles, and compact top controls.
- [ ] Finish mobile drawer behavior, safe areas, soft-keyboard layouts, and dark mode.
- [ ] Verify labels, keyboard traversal, Escape/focus restoration, and shortcut isolation.
- [ ] Check pan/zoom coordinates and pen/drag/resize behavior when chrome changes size.

**Gate:** inspected desktop/mobile screenshots and focused layout/input tests pass;
no overlap of essential controls or regression in world-to-screen interaction.

### M11 - Validate the integrated delivery and prepare handoff

**Read:** the compact milestone results/contracts, section 7's full acceptance
matrix, section 8, and only source implicated by failures. Do not repeat research.

- [ ] Run the integrated acceptance matrix and appropriate broader commands after
  the prior milestone gates pass. Fix cross-feature regressions before completion.
- [ ] Verify browser/API/PostgreSQL combinations and inspect final representative UI.
- [ ] Inspect the complete task diff, SQL/data compatibility, and cleanup of test assets.
- [ ] Record final API contracts, migrations, evidence, and remaining physical/live
  checks in this plan and a focused validation document.
- [ ] Update the learning checkpoint/progress and mark the old UX plan superseded.
- [ ] Prepare release order, mixed-version behavior, and rollback notes; present the
  local implementation without committing, pushing, or deploying.

**Gate:** no required code/API/data work remains an unimplemented UI promise. Clearly
separate completed local evidence from unavailable physical or production checks.

## 7. Acceptance and regression matrix

| Scenario | Required result |
| --- | --- |
| Fresh guest / API unavailable | Usable single canvas; no workspace/New page/Save to account; local saving works |
| Guest reload with objects/images | Same document, blobs, title, and viewport remain available |
| Empty-canvas Google sign-in | Direct auth entry; one workspace initialization; no duplicate empty pages |
| Guest transfer selected | Exactly one destination; source preserved; all confirmed supported content present |
| Transfer declined/canceled/auth fails | No unsolicited upload; source stays intact; no stale later transfer |
| First login in two tabs/devices | At most one automatic first page |
| Lost create response / reload mid-transfer | Same request/destination resumes; no manual account-list investigation required |
| New page / rename / delete / final deletion | Direct predictable navigation; deletion does not recreate content |
| Page switch during save or text/pointer edit | Safe commit/journal boundary; no wrong-page edits, selection, or undo |
| Returning user / direct link / Back/Forward | Correct accessible page opens; invalid target handled without losing drafts |
| Account switch / logout / expired session | No cross-account cache or image leak; pending work preserved |
| Image insert, paste, drop, undo, redo | Autosave/upload works; assets needed by history remain usable |
| Lost upload response / provider uncertainty / 429 | Original reservation reconciled; no duplicate upload or uncontrolled retry |
| Offline/reconnect / slow API / cold backend | Truthful pending state; no false Saved, logout, empty-list creation, or lost work |
| One tab hidden >20 s / long sleep / unrelated tab | No false other-tab warning; safe automatic return to editing |
| Two guest tabs, including crashed/sleeping writer | Safe handoff and fresh data; no stale canonical overwrite |
| Same account/page in two tabs or browsers | Live updates with independent pending work and selective undo |
| Different pages in different tabs | Independent editing and local coordination |
| Owner/editor/viewer/revoked member | Current permissions govern API and UI; local cache never grants access |
| Legacy data/clients/migrations | Boards, images, drafts, pending operations, permissions, and URLs preserved |
| Desktop/mobile/dark/keyboard/200% layout | No overlapping essential controls; usable focus, menus, dialogs, safe areas |
| Pan/zoom/draw/drag/resize/pen interruption | Existing coordinate, performance, history, and ink behavior preserved |

Existing test entry points include `src/persistence/boardTabCoordinator.test.ts`,
`accountBoardSession.test.ts`, `localBoardStorage.test.ts`, `src/components/SaveStatus.test.ts`,
server HTTP/PostgreSQL tests, `e2e/authentication.spec.ts`, `e2e/account-boards.spec.ts`,
`e2e/ux-simplification.spec.ts`, `e2e/ux-layout.spec.ts`, and integration
`cross-tab`, `collaboration`, `cloud-images`, and `sharing` specs. Extend/update
behavioral assertions; do not retain old UX expectations just to make tests pass.

Use the narrowest relevant commands first. The current broader commands are:

```text
npm test
npm run build
npm run typecheck:server
npm run build:server
npm run test:database:docker
npm run test:e2e
npm run test:e2e:integration
git diff --check
```

Confirm fixture isolation before database commands. The integration config uses
disposable schemas through the existing local Docker setup. Start the existing
Docker/database services only when needed; do not reset volumes or overwrite
normal/production databases. Clean up only resources created for this validation.
No physical-device, screen-reader, real Google, or production claim is established
by mocks alone. Record unavailable checks honestly without abandoning other work.

## 8. Scope boundaries and release

- Preserve free guest use, Google-only authentication, IndexedDB compatibility,
  existing cloud collaboration/sharing, selective undo, and the recent pen update.
- Keep pointer-move paths lean; transient drag/resize/ink frames must not create
  extra persistence writes or history entries.
- Keep existing free-tier providers. No paid infrastructure, PWA/service-worker
  project, Postman artifacts/cloud maintenance, or unrelated refactors.
- Do not copy tldraw branding or replace the canvas engine. Match its interaction
  simplicity using the existing application and necessary focused backend changes.
- Release preparation must state migration -> compatible backend -> frontend order,
  capability/version handling if mixed versions are possible, and rollback behavior.
  Preserve additive SQL/data on rollback rather than dropping recovery information.
- Production SQL, provider settings, deployment, pushes, and commits are not part
  of local implementation authorization. Record what is ready and what awaits a
  separate release decision. Do not silently deploy through an automatic Git push.

## 9. Progress and next-session handoff

M0-M6 are verified locally. M7-M11 remain pending. The next session should
execute **M7 only**, Google sign-in and resumable guest transfer.

### Current handoff - replace after each session

- Last completed milestone: M6 - verified locally 2026-10-07.
- Next milestone: M7 - Implement Google sign-in and guest transfer.
- In-progress substep: none.
- Changed: mounted workspace controller, passive account UI, page URL/history,
  stable initialization, safe switching and intentional final deletion. Guest
  recovery waits during navigation; hidden/inert canvas keeps its size/viewport.
  M4-M6 are included in the combined commit authorized 2026-10-07;
  M0-M3 were previously committed.
- Verified: 136 focused cases, 40 standard browser regressions and 15 real browser/
  API/Prisma/PostgreSQL cases. Both builds, strict touched-test/fixture typechecks
  and diff checks pass. Exact commands/contract: `docs/workspace-ux-m6.md`.
- Contract: URL -> last accessible -> owned/shared fallback; current document/role
  reads before open, serialized preference PATCH afterward. Service errors retain
  identity; confirmed expiry preserves journals and clears private access. Persist
  initialization UUID/mode before dispatch; final deletion never recreates defaults.
- Boundaries: M7 supplies durable consent/account-bound transfer to the entry-intent
  hook. Transfer mode suppresses defaults; explicit page/invitation has priority.
  Keep M2 v4 journals, M3/M4 receipts, M5 immutable uploads and the pen renderer.
  Legacy manual creation/upload controls remain until M8/M9.
- Blockers: none. No new SQL migration. All 12 normal tables/14 rows retain identical
  fingerprints; zero browser schemas remain. Evidence:
  `workspace-ux-evidence/m6-database-isolation.json`. Docker 5434 is running.
  No normal/production migration, provider change, push or deployment.
- Next read: M7 block, section 3 sign-in/transfer rules, account UI, workspace
  entry-intent hook and M3/M5 adapters. Next SQL: 12. Physical IME/sleep: M11.

Keep this current handoff around 150-250 words or less. Capture exact test commands
and results, relevant migrations/API/journal decisions, current file locations, any
uncommitted work from earlier sessions, and the next concrete substep. Do not make
the next session infer completion from old commentary or Git commits alone.

Use the section 6 table as the status authority: Pending, In progress, or Verified.
Check off tasks and mark Verified only after the milestone gate passes. If work is
incomplete, name the failing/unrun gate and resume it before selecting a later
milestone. Preserve concise durable contract notes below; replace the current
handoff instead of appending a long narrative every session.

### Durable contract notes

M0: no contract changes. Baseline evidence, reusable fixture map, limitations and
commands are in `docs/workspace-ux-baseline.md`. Add short milestone-labelled
API/migration/journal decisions here when implemented.

M2: IndexedDB v4 adds `editor-journals`, wrapper version 1. Physical keys are
`account-board:<account>:<board>:editor:<UUID>` with journal-specific `:recovery`
copies; logical board IDs and record schema stay unchanged. Fresh runtime editor
UUIDs, guarded journal adoption, unchanged operation IDs, account-scoped image
maps and retained legacy records support concurrent account editors. Guest data
still uses `boards/current-board`; identity-only BroadcastChannel/storage signals
plus polling coordinate flush/release/reload. Atomic lease checks guard all writes;
no held Web Lock stealing. Exact contracts and rollback limit:
`docs/workspace-ux-m2.md`. No API or SQL migration in M2.

M3: migration 9 adds actor/request-keyed `board_creation_receipts`. POST /api/boards
accepts legacy `{title}` or `{title, requestId, initializeDocument: true}`. A
per-actor user-row lock guards atomic metadata/blank revision-one document/receipt.
Same normalized payload replays with HTTP 200 (first create 201); mismatch is 409.
Replay returns live accessible metadata and original creation revision, never
rewrites content. Expired (90-day) or deleted destinations return terminal 410;
compact identities remain indefinitely. Typed `createServerPage` requires a
caller-owned stable intent; orchestration awaits M6/M7. Exact contracts/commands/
rollback: `docs/workspace-ux-m3.md`.

M4: migration 10 adds workspace state and permanent actor/request initialization
identities. GET has no creation/write side effect; PATCH validates current access.
POST initialize returns HTTP 200/current candidate and initializes only once,
with no default for false/import mode or existing accessible pages. Later requests
cannot recreate a deleted final page; same UUID/changed mode conflicts. Read the
current document before editing, then PATCH after opening. Shared actor NO KEY
UPDATE and workspace parent SHARE locks preserve serialization/access without
sharing/FK lock cycles. Exact contracts: `docs/workspace-ux-m4.md`.
UI wiring remains M6/M7.

M5: migration 11 adds retained uploader/scope-board/request UUIDs, original MIME/
byte hashes and database-clock leases/0-3 write attempts to existing assets.
Header `X-Scribble-Upload-Request` selects `200/202 {upload}` ready/pending POST;
legacy no-header `201 {asset}` remains. Status GET returns bounded state and
reconciles/finalizes only; no byte upload or signed URL. Current edit permission
and original actor required on every replay/status/write admission/finalization.
Same bytes reuse one reservation before quota checks; changed bytes conflict.
Exact immutable provider path, SDK retries off, token fencing and persisted
cooldown protect concurrency/restart. Unknown writes keep quota; only confirmed
cleanup releases it. Cleaned request identities remain terminal 410 indefinitely.
Ready draft/history assets and completed local mappings are retained. Adapters
require a caller-persisted intent; automatic UI adoption is M8. Exact contract:
`docs/workspace-ux-m5.md`. Next unused SQL number: 12.

M6: one mounted lifecycle/navigation controller distinguishes service errors from
confirmed expiry. Base-compatible page URLs/Back/Forward, fresh current documents,
account-scoped journals and serialized post-open preferences restore pages safely.
Persist initialization UUID/mode before dispatch; never treat a list failure as
empty or recreate defaults after deletion. Wait for guest hydration and suppress
guest recovery during navigation; preserve measured canvas size while hidden/inert.
M7 supplies explicit transfer intent through the reserved entry hook. Legacy manual
creation/upload UI stays available until M8/M9. No schema/API changes. Commands,
compatibility and regression evidence: `docs/workspace-ux-m6.md`.

### Reusable one-milestone execution prompt

Use this same prompt for each new session. It selects the next incomplete eligible
milestone from the saved status. To select explicitly, replace the first sentence
with "Execute milestone M<number> only" and check its prerequisites first.

```text
Execute the next incomplete eligible milestone only from
E:\PROJECTS\the-canvas\WORKSPACE_UX_IMPLEMENTATION_PLAN.md.

Follow its Session entry instructions. Read AGENTS.md and the learning checkpoint
once, then the compact handoff, milestone table, selected milestone, and only its
relevant reference sections/source files. Reuse recorded research and passed gates.

I authorize local code/API/migration changes, commands, existing local services,
and disposable test fixtures needed for that milestone. Preserve existing data.
Do not modify production, reset databases, commit, push, deploy, or change providers.

Finish the selected milestone and its focused validation. Make routine decisions
without repeated permission requests. Do not expand into subsequent milestones.
Update its status, checkboxes, compact handoff, and relevant learning checkpoint.
Report what passed, what remains, and the next milestone ID, then stop so I can
continue in a new session. If incomplete, save the exact next substep honestly.
```
