# Scribble UI redesign and authenticated link sharing

Created: 2026-10-07 (Asia/Calcutta).
Status: **R0-R7 verified locally**. R7 combined acceptance completed 2026-10-08.
Next: remaining physical/provider acceptance, then a separately authorized release.
Execute one milestone per session.

## 0. Session entry and authority

This is the active plan for the UI redesign requested on 2026-10-07. It replaces
WORKSPACE_UX_IMPLEMENTATION_PLAN.md, which the user explicitly requested deleting.
References to that deleted file in older documents describe historical work.
Do not recreate it or restart its completed milestones.

1. Read AGENTS.md and docs/learning-checkpoint.md once per new session.
2. Read sections 1, 10, and 13 of this plan: confirmed scope, milestone status,
   and the current handoff. The checkpoint predates the M11 completion record;
   this plan and docs/workspace-ux-m11.md resolve that discrepancy.
3. Select the first incomplete eligible milestone, unless the user names one.
   Read only its block and the reference sections/source files it requires.
   Use heading searches and bounded reads instead of rereading the entire plan.
4. Implement and validate that milestone. Make routine implementation decisions
   within the authorized scope; ask only for material missing information.
5. Update its checklist, status, evidence, and the compact handoff. Stop after
   that milestone unless the user explicitly extends the session's scope.

The planning session authorizes creating this document and deleting the old
root plan only. It does not start application implementation. Section 14 provides
the reusable prompt that authorizes local implementation in a later session.
Commits, pushes, deployments, production SQL, and provider changes remain
separate actions. Prior release authorization does not authorize this delivery.

Keep learning documents unchanged for this plan unless the user requests an
update. Preserve existing uncommitted work. Do not create subagents unless the
user explicitly requests delegation.

## 1. Confirmed product requirements

| Requirement | Required result |
| --- | --- |
| Remove the top bar | No full-width bordered/filled header strip or large rounded header card. Compact title/navigation and Share controls remain independently positioned over the canvas. |
| Redesign the whole UI | A consistent treatment of sidebar, tools, styles, menus, dialogs, account controls, status, empty states, errors, desktop, mobile, and both themes. |
| Use the supplied tldraw screenshot as reference | Flat navigation, restrained separators, compact controls, and generous canvas space. Retain Scribble's identity and existing editor. |
| Share copies a link | Clicking Share on an owned cloud page creates or reuses its link and copies it. No required sharing dialog or second Copy button in the successful flow. |
| No recipient email | Creating a new shared link never asks for an email address and sends no email. |
| Authentication for recipients | **Google sign-in is required to view or edit a shared page.** A link alone never authorizes anonymous access. This is an explicit user decision. |
| Link permissions | Owner selects Can view or Can edit and can stop link sharing. Recipients use their own Google account; no predetermined recipient account is required. |
| No Refresh pages option | Routine data freshness is automatic. A contextual Retry is available after an actual failure. |
| Keep existing work safe | Guest drawing, IndexedDB, autosave, explicit guest-transfer consent, images, collaboration, tab recovery, and undo/redo continue to work. |

Implementation defaults where the user did not specify a value:

- New links grant **Can view**. Owners can choose Can edit in Link settings.
  Treat this as the implementation default, not a user-confirmed preference.
- One active reusable link per page. Links remain active until stopped or the
  page is deleted; this scope adds no expiration settings.
- Owner-only creation, permission changes, and revocation. The existing owner
  limitation on the primary Share action remains.
- Desktop sidebar width starts at 240px; spacing and compact control geometry
  are finalized in R0. Existing user visibility/theme choices are respected.
- Keep Scribble's violet accent. The tldraw reference does not require copying
  its blue accent, branding, QR code, comments, publish tab, or workspace hierarchy.

## 2. Evidence and inherited baseline

### Research already completed

The supplied screenshot is the signed-in tldraw visual reference. The research
session inspected current tldraw source and docs, plus Scribble source and its
saved desktop/mobile M11 screenshots. The tldraw web page required JavaScript
in the browsing tool; do not describe that as a live signed-in browser audit.

- [tldraw sidebar CSS](https://github.com/tldraw/tldraw/blob/main/apps/dotcom/client/src/tla/components/TlaSidebar/sidebar.module.css):
  full-height sidebar, mostly borderless controls, hover/selected backgrounds,
  and compact navigation/account areas.
- [tldraw title controls](https://github.com/tldraw/tldraw/blob/main/apps/dotcom/client/src/tla/components/TlaEditor/TlaEditorTopLeftPanel.tsx):
  page/file identity, inline naming, and contextual menus.
- [tldraw sharing](https://github.com/tldraw/tldraw/blob/main/apps/dotcom/client/src/tla/components/TlaFileShareMenu/Tabs/TlaInviteTab.tsx):
  link activation, viewer/editor selection, and copying as separate concerns.
- [tldraw UI examples](https://tldraw.dev/examples/custom-menus):
  independent toolbar, navigation, styles, and menu regions.

These main-branch references may evolve. Reuse the findings; revisit a source
only when a new implementation uncertainty needs verification. This is a redesign
of the current React/TypeScript/Vite application, not a tldraw SDK migration.

### Current implementation findings

- ServerBoards.tsx renders a full-width board-header/workspace-header containing
  menu, sidebar toggle, identity, save text, collaboration text, Share, and avatar.
- PageSidebar.tsx renders an inset bordered card with New page, search, page
  groups, and a persistent Refresh pages footer.
- Toolbar/history and zoom already have their intended general locations.
  Refine their presentation without rebuilding drawing interactions.
- styles.css contains both earlier styles and later workspace overrides.
  Replace the affected rules coherently; do not add another contradictory layer.
- Sharing.tsx requires an email, creates an invitation, and then exposes a copy
  action. postgresSharing.ts verifies the invitation against the recipient email.
  Removing the input alone cannot implement general authenticated link access.
- Current cloud access combines owner and explicit board membership.
  List/workspace/collaboration queries also contain permission SQL and must be
  updated consistently with any new link-grant model.
- Page-list queries already have a 30-second stale time, bounded read retries,
  and reconnect refresh. Existing mutation invalidation is reusable.

### Completed work that this plan inherits

The deleted plan recorded **M0-M11 verified locally**. The durable completion
record is [docs/workspace-ux-m11.md](docs/workspace-ux-m11.md). It records 813 fast
tests, 151 PostgreSQL tests, 89 standard browser tests, 72 actual browser/API/DB
journeys, builds/typechecks, persistence/backup proofs, and visual inspection.
These are historical results, not checks performed by this planning session.

M11 includes fixes for confirmed-pending image-upload retries and interrupted
collaboration reads. Those changes and multiple updated fixtures were uncommitted
when this plan was created. Preserve them and the associated evidence.

Preserve SQL migrations 1-11, document format version 1, IndexedDB version 4,
account journals, upload/creation receipts, and the current guest-transfer model.
Migration 12 was the next unused number at planning time; verify before allocating.
Historical database fingerprints and row counts are evidence, not permanent
expected values for future environments.

The previous handoff records earlier frontend delivery and production migrations,
with backend release awaiting the user's manual Render action at that time.
Recheck deployment state only if release work is subsequently authorized.
Physical devices/IME, screen readers, real browser zoom, sleep/wake, and live
Google/image-provider acceptance were separate pending checks.

## 3. Layout and visual specification

### 3.1 Desktop composition

The canvas fills the app shell. UI controls occupy discrete overlay regions.
The top edge between the title cluster and Share remains visually open.

| Region | Contents and behavior |
| --- | --- |
| Left sidebar | Edge-attached, full-height flat surface; Scribble/workspace identity, search, New page, My pages, Shared with me; account/help/theme in footer. |
| Upper left of exposed canvas | Sidebar toggle, compact page title, page menu. No spanning header background or outline. |
| Upper right | Compact collaborator indicators and owner Share action. Local guest has a clear Google sign-in entry. |
| Right canvas edge | Contextual tool/selection appearance panel when relevant, with collapse control. |
| Bottom center | Primary tool dock; small undo/redo row immediately above it. |
| Bottom left of exposed canvas | Compact zoom percentage/menu. |
| Exceptional state | A small anchored notice with an actionable message; expandable details only when needed. |

Center the dock within the unobscured working region when the desktop sidebar
is open. Reposition UI overlays without resizing/recentering the canvas world.
Keep enough separation between title, Share, style controls, and notices.

### 3.2 Sidebar and page identity

- Attach the sidebar to the viewport edge. Remove the card border, large corner
  rounding, exterior gutter, and panel shadow. One quiet edge separator is enough.
- Use a consistent vertical rhythm. Search and New page should look like compact
  workspace actions, not a stack of boxed forms.
- Show a neutral soft background for the current page. Reserve the accent for
  primary actions, tool selection, and focus where appropriate.
- Page actions appear on hover and keyboard focus; remain discoverable on touch.
- Long titles truncate visually, remain available accessibly, and do not push
  Share or the drawing controls out of bounds.
- Preserve inline rename, ownership checks, navigation, deletion confirmation,
  search semantics, loading, empty, error, and Shared with me groups.
- Keep one page list hierarchy. Do not add folders, organizations, multiple
  workspaces, or nested file/page concepts.
- A collapsed sidebar leaves a usable toggle. Existing visibility preferences
  are retained. Desktop and mobile visibility remain distinct.
- Move the existing account presentation to the footer/menu without mounting a
  second account controller or duplicating session state.

The title reads as ordinary text at rest, with a clear editable state on focus
or activation. Preserve Enter/blur commit, Escape cancel, IME composition, and
read-only roles. The guest title continues to describe its local drawing.

### 3.3 Controls, typography, colors, and surfaces

- Define shared tokens for spacing, radii, text hierarchy, control sizes,
  surface levels, focus, shadows, and semantic colors in both themes.
- Use the existing sans-serif stack consistently across headings, labels,
  popovers, form fields, buttons, and dialogs. Avoid dependency/font downloads
  unless a verified issue makes them necessary.
- Start with a 4px spacing rhythm, 13-14px UI text, 18-20px icons, 6-8px compact
  control radii, and approximately 10-12px floating-surface radii.
- Keep hit targets comfortable: at least 44px for primary touch interactions.
  Visual icon/background size can be smaller than its interactive area.
- Use transparent default buttons, subtle hover fills, and clear pressed/active
  states. Disabled controls remain distinguishable without being mistaken for
  working actions.
- Restrict shadows to floating docks, popovers, and dialogs. Avoid a border
  around every control or nested section.
- Preserve visible focus, readable muted text, and sufficient control contrast.
  Color alone must not communicate save state or permission.
- Keep the grid subtle. Do not change stored grid/theme preferences as a side
  effect of restyling.
- Use short, restrained transitions and honor reduced-motion preferences.

### 3.4 Drawing tools and contextual panels

- Reuse existing tools, shortcuts, icons, and tool state. Do not add tools based
  solely on icons present in the tldraw screenshot.
- Keep selection/drawing controls in one compact bottom dock. Put less common
  tools in the existing accessible overflow menu.
- Keep undo/redo adjacent to the dock in a quieter row; expose selection actions
  only when the selection supports them.
- Style controls reflect the active tool or selection. Do not display unrelated
  settings or duplicate selection state.
- Condense padding, labels, swatches, size choices, and opacity controls.
  Keep actual drawing settings and generated ink unchanged.
- Replace permanent instructional cards with short contextual hints that do not
  obscure artwork and disappear once unnecessary.

### 3.5 Menus, dialogs, status, and empty states

- Restyle account, Help, page menus, recovery, upload consent, and delete dialogs
  with the same typography, action hierarchy, and spacing.
- Use popovers for ordinary compact choices. Keep real modal dialogs for consent,
  destructive confirmations, and recovery decisions that need attention.
- Show a compact save indicator with a meaningful accessible label and details
  on activation. Preserve the distinction between saved on device, cloud pending,
  cloud confirmed, offline, access removed, and save failure.
- Show actual collaborators compactly; disclose names/roles accessibly on demand.
  Do not imply live collaboration when disconnected.
- Keep visible error actions. Visual simplification must not hide an unsaved
  draft, an image-consent request, a conflict, or a revoked permission.
- Empty canvas: quiet centered hint, no large bordered welcome card. Empty
  workspace: clear New page action. A failed list load is never an empty workspace.

### 3.6 Mobile and intermediate widths

- Use the existing 768px desktop/mobile breakpoint as a starting point; test the
  full width range rather than assuming one desktop and one phone size suffice.
- Sidebar becomes a bounded drawer with overlay, Escape/close support, trapped
  focus, and focus restoration. It must not remain as a narrow desktop column.
- Top controls remain compact. Avoid the current multiple-row status/header card.
  Put secondary account/status details in menus.
- Preserve the bottom primary tool row, safe-area padding, and reachable undo/redo.
  Collapse secondary tools before reducing essential hit targets.
- Style controls open on demand in a bounded popover/sheet. Close or collapse it
  when returning to drawing; prevent simultaneous overlapping style/action rows.
- Bound dialogs to the visual viewport during virtual-keyboard use. Long titles,
  browser zoom, landscape, and limited height must not hide focused controls.
- On tablet/intermediate widths, prioritize canvas space: collapse optional
  panels or move secondary controls instead of overlapping docks.

## 4. Sharing behavior and owner experience

### 4.1 Direct Share action

For a signed-in owner on a cloud page:

1. Clicking Share explicitly enables link access if needed, or retrieves the
   existing active link. Do not enable sharing during render, hover, or page open.
2. Commit/journal any active edit using the established boundary. Reuse the
   existing save queue; never discard pending edits to manufacture a share result.
3. Copy the usable URL. On success show a short accessible **Link copied**
   confirmation, optionally including **Can view** or **Can edit**.
4. Do not open a modal or require an email, invitation creation, or second click.

Keep the operation tied to its initiating account/page. Coalesce repeated clicks
while busy. Disable only the relevant action, not the whole canvas. If the user
switches page/account or signs out before completion, ignore stale UI/clipboard
completion and avoid copying the wrong page's link.

Sharing a live page does not require all future autosaves to stop. If this device
has unuploaded changes/images, keep its truthful pending state visible and explain
that those changes will appear after syncing. Never imply unsynced bytes were
included in a confirmed cloud save.

Clipboard failure is a separate outcome from link creation failure. Display the
selectable URL and a retry-copy action; never report success unless copying
actually succeeded. Account for browsers that require fresh user activation after
an asynchronous server request. A fallback second click is allowed only for that
failure path, not as the designed normal flow.

### 4.2 Link settings

Entry: page menu -> **Link settings**. The owner sees:

- Whether sharing is active.
- **Can view / Can edit** selection; new links default to Can view.
- **Copy link** when active.
- **Stop sharing** when active.

No recipient email field, pending-invitation creation form, QR code, publishing
tab, or unrelated export workflow belongs in this surface.

Can view permits reading the page and its images. Can edit uses the existing
editor permissions, including permitted rename and collaboration actions.
Neither permits deletion of the page, ownership changes, or sharing management.

Changing the link role affects all access derived from that link. Stop sharing
invalidates the link and its derived access. Sharing again issues a fresh link;
an old revoked URL must never become valid again.

Keep existing explicit members and pending invitations compatible. Existing
member management may be presented in a secondary Access section; creating new
email invitations is removed from the primary UI. Old invitation URLs/inbox
acceptance continue working for already-created invitations.

Stopping link sharing does not remove independently granted explicit membership.
If showing member removal, explain that an active reusable link can grant access
again. Do not imply an individual ban when the implementation only removes a
named membership.

### 4.3 Guest sender

Local drawing stays available without authentication. A local-only drawing has
no remotely usable share URL.

If the guest selects Share, explain that sharing requires Google sign-in and
saving this drawing to the account. Use the existing explicit transfer-consent
flow and preserve the local original. Cancellation leaves local work intact.
Do not silently upload a guest board on ordinary sign-in.

After a successful explicit transfer, resume the share intent on the exact
created destination. Preserve the current image-consent and upload rules.
If automatic copying is blocked after navigation, offer the normal Copy fallback.

## 5. Recipient access, identity, and revocation

### 5.1 Recipient journey

1. The recipient opens the copied link.
2. If signed out, display a minimal **Sign in with Google to open this page**
   entry. Do not fetch or render protected title, drawing, images, or presence.
3. Preserve the validated destination through Google redirect in tab-scoped
   intent state, alongside existing page/invitation/transfer navigation rules.
   Do not place the share secret in Google's redirect parameters or OAuth state.
4. After authentication, resolve the link for the current account and open the
   page through the existing workspace controller.
5. Show the resulting Can view/Can edit state. A link is reusable by multiple
   signed-in accounts; it is not consumed by the first visitor.

This link explicitly expresses an intent to open the shared page. Do not require
the old email-invitation acceptance step. Do not auto-import the recipient's guest
drawing, create an unnecessary first workspace page, or replace its local drawing
with the shared document.

Preserve/journal any existing active work before navigation. A pending explicit
guest transfer must retain its recorded destination and consent; resolve navigation
priority deliberately, never retarget that transfer to the shared page.

After successful opening, remove the secret from the address bar and temporary
intent and use the existing canonical page URL. The account's valid link-derived
grant permits subsequent opening from Shared with me or a normal page URL.
On logout/expiry clear private rendered/cached data through the established path.

Invalid, stopped, or deleted-page links show a concise unavailable state without
revealing protected data. A transient API/network failure offers Retry and does
not falsely claim the link was revoked. Google cancellation preserves the intent
for an explicit retry and keeps the local drawing available.

### 5.2 Access model

Add a distinct source of access for authenticated users who opened an active link.
Do not convert link use into an indistinguishable permanent board membership.

Effective permissions:

1. Owner remains owner.
2. An existing explicit member keeps their independently assigned role.
3. A valid link-derived grant contributes the link's current role while the
   matching link generation remains active.
4. Combine valid explicit and link-derived roles by the greater permission.
   A viewer link never downgrades an explicit editor.

Consequences:

- Revoking a link removes only access derived from that link.
- Changing editor -> viewer blocks subsequent writes for link-only editors.
- Re-enabling sharing creates a new generation. Previous link-only recipients
  must open the new URL to regain access.
- Directly entering a board ID does not redeem or bypass a link.
- Joined pages appear in Shared with me; revoked link-only pages disappear on
  refresh, and stale list entries cannot open protected content.

Apply the same effective permission to metadata/list/workspace selection,
document reads/writes, rename/delete rules, operation receipts/replay, images and
upload reconciliation, SSE subscriptions, presence, and active editing.

Use existing transactional locking conventions for link changes and concurrent
document writes/redemption. Recheck current authorization before returning stored
operation receipts or signing asset URLs.

Stop future protected API reads/writes as soon as revocation commits. Terminate
or reauthorize live subscriptions within a documented short bound; acceptance
target is at most the existing 30-second access-check interval. Preserve unsaved
local drafts and switch the client out of editing when access is lost.

Previously delivered content and already-issued signed asset URLs cannot be
recalled by changing a role. Record existing URL lifetimes and cache behavior,
stop issuing new URLs, and do not claim immediate erasure of downloaded content.

## 6. Backend, URL, and compatibility specification

This section defines the required contract. Suggested endpoint/table names can
be adjusted to existing conventions during R4, with the final choices recorded.
Permission semantics and user behavior are fixed.

### 6.1 Data model

Use additive SQL migrations and matching Prisma mappings:

- Per-page link state: board ID, active flag, viewer/editor role, generation,
  settings version, protected token material, and timestamps.
- Per-account link grants: board ID, user ID, joined generation, timestamps, and
  uniqueness preventing duplicate grants for repeated opens.
- Foreign keys and page-deletion cleanup; indexes appropriate to permission and
  Shared with me lookups.
- Stable request identity/version checks for uncertain owner mutations. Add a
  receipt only if the final implementation requires it; do not misuse existing
  page-creation receipts for unrelated actions.

Use high-entropy opaque tokens from a cryptographic random generator. The same
active URL must be retrievable for repeated copies and after owner reload.
Store verification digests and protect any recoverable secret material server
side; R4 must document the exact storage/key strategy and restart behavior.
Do not propose hash-only storage without explaining how repeat Copy retrieves
the same URL. Reuse established crypto primitives and secret configuration.

Never return share secrets in ordinary board lists, workspace responses, members
lists, telemetry, or errors. Only the authorized owner receives copy material.

### 6.2 Proposed API surface

| Operation | Proposed route | Required behavior |
| --- | --- | --- |
| Read link settings | GET /api/boards/:id/share-link | Owner only; enabled, role, generation/settings version; no activation side effect. |
| Enable/reuse for copying | POST /api/boards/:id/share-link/copy | Owner only; stable request ID and conditional settings version; returns the active URL/role. Existing active link is reused. |
| Change permission/stop | PATCH /api/boards/:id/share-link | Owner only; version-checked mutation; returns current nonsecret settings. Stopping revokes the generation. |
| Resolve and join | POST /api/share-links/open | Google session required; token in request body; idempotently records current-generation grant and returns accessible page metadata/role. |

Use strict validation and current origin/CSRF/session/account-binding checks.
Rate-limit link resolution and mutations through the existing budget model.
Do not make existing board APIs public to implement this feature.

Unknown mutation outcomes reconcile with the server using the original intent;
retries must not create multiple active links, downgrade a newer role, or
reactivate sharing after the owner stopped it. Concurrent settings changes yield
a recoverable conflict rather than a silent last-writer overwrite.

Authentication failures, unavailable links, permission failures, stale versions,
offline errors, and rate limits must have distinguishable client behavior.
Do not expose page existence/title to unauthorized users through these errors.

### 6.3 URL and sign-in intent

Prefer a fragment-based share URL relative to Vite BASE_URL, for example:

~~~text
https://<host>/<app-base>/#share=<opaque-token>
~~~

The fragment avoids sending the secret in the initial page HTTP request. Parse
only the documented token shape, move it into short-lived tab intent as needed,
and remove it once resolved. Verify compatibility with current workspace URL
handling; do not replace existing page or invitation routes.

If sessionStorage is unavailable, show a recoverable instruction to reopen the
original link after Google sign-in; do not persist the token in unrelated durable
stores or silently lose the destination.

No share tokens in provider URLs, server access logs, analytics, screenshots,
test output, referrers, or public errors. Review API error logging before adding
the token-bearing request body. Tests use disposable tokens.

### 6.4 Mixed versions and release

- Preserve existing email invitations and explicit board memberships.
- Existing pages default to link sharing disabled.
- A frontend against an older backend must detect unsupported link sharing and
  show a useful unavailable state. Never copy a URL that cannot grant access.
- Extend the existing capability mechanism rather than inferring support from
  a failed board request or reverting to an email form.
- Document migration -> compatible backend -> frontend rollout order, any new
  secret configuration, and frontend/backend rollback behavior.
- Older backend code may not understand link grants; rollback must close that
  feature safely while retaining additive data and all existing explicit access.
- Keep document/IndexedDB formats unchanged unless a concrete integration need
  is proved. Preserve v4 journal compatibility and pending recovery records.

## 7. Automatic freshness and removal of refresh controls

Remove the persistent Refresh pages action and its normal loading text.
Also eliminate routine Refresh sharing/invitations buttons from redesigned
surfaces; retain contextual retries and legacy invitation compatibility.

Use TanStack Query and established caches:

- Refresh stale page lists when the sidebar opens or the window regains focus.
- Refetch on reconnect; invalidate/update after create, rename, delete, link
  join, permission changes, and membership changes.
- While the signed-in sidebar is visible, use a bounded interval (initial target
  30 seconds) if no existing event makes other-device page changes timely.
  Pause unnecessary polling when hidden and reuse/deduplicate current queries.
- Keep stale list data visible during background reads and recoverable failures.
- Abort/cancel private requests and clear account-scoped caches on auth changes.
- Reconcile uncertain link mutations automatically before offering another
  mutation. Do not replace a removed Refresh button with unsafe blind retries.

No refresh command performs a browser reload. Background list/permission reads
must not replace the active editor document, overwrite local drafts, change the
viewport, or add history entries. Continue to use existing collaboration merges.

Retry appears only beside an actual failure. Recovery actions such as Retry save,
Restore previous draft, and Use account version retain their separate semantics
and existing confirmations; they are not routine page-refresh controls.

## 8. Engineering invariants and scope boundaries

- Preserve one account/workspace lifecycle and one collaboration-cursor lifetime.
  Moving avatar/sidebar components must not mount duplicate session controllers.
- Keep world/screen coordinates distinct. Measure UI overlays separately from
  the canvas; sidebar toggles must not move drawn objects.
- Retain pointer ownership, touch/pen rules, interaction interruption behavior,
  selection ownership, atomic history boundaries, and selective collaboration undo.
- No new state writes, token work, permission fetches, or React render loops in
  high-frequency pointer-move paths.
- Keep IndexedDB keys, existing assets, guest original, journals, operation
  receipts, upload identity/leases, and explicit consent/binding behavior intact.
- Preserve one local guest drawing and Google-only authentication.
- Keep the current free-tier providers. No PWA/service-worker scope, Postman
  artifacts/cloud updates, paid services, or unrelated dependency/refactor work.
- Do not add anonymous shared viewing/editing, email/password login, comments,
  publish/QR features, extra workspace hierarchy, or a new canvas SDK.
- Preserve user's uncommitted work. Use targeted diffs; do not reset the checkout,
  rewrite unrelated files, or auto-commit a milestone.

## 9. Targeted source and evidence map

| Area | Read first, then follow direct dependencies only |
| --- | --- |
| App/shell/status | src/App.tsx; src/components/ServerBoards/ServerBoards.tsx; src/components/SaveStatus.ts |
| Sidebar/title | src/components/ServerBoards/PageSidebar.tsx; src/components/BoardIdentity/BoardIdentity.tsx |
| Account/menus/dialogs | src/components/Account/Account.tsx; src/components/AppMenu.tsx; src/components/Menu.tsx; src/components/Dialog.tsx |
| Drawing UI | src/components/Toolbar/Toolbar.tsx; src/components/ToolOptions/ToolOptions.tsx; src/components/ZoomControls/ZoomControls.tsx |
| Theme/presentation | src/styles.css; src/store/themeStore.ts; src/components/CollaborationPresence.tsx |
| Sharing UI/client | src/components/ServerBoards/Sharing.tsx; invitationIntent.ts in that directory; src/api/sharing.ts |
| Navigation/consent | src/persistence/workspaceController.ts; workspaceNavigation.ts; guestTransfer.ts; src/components/ServerBoards/SaveFlow.tsx |
| Autosave/cache/recovery | src/api/accountBoardQueries.ts; src/persistence/accountBoardSession.ts; src/components/ServerBoards/RecoveryDialog.tsx |
| Session/routes/permissions | server/app.ts; server/boardAccess.ts; server/boardPermissions.ts; server/authRoutes.ts |
| Sharing and list queries | server/sharing.ts; server/postgresSharing.ts; server/postgresBoards.ts; server/postgresWorkspace.ts |
| Protected documents/live/images | server/postgresCollaboration.ts; server/collaborationRoutes.ts; server/postgresAssets.ts; server/imageAssets.ts; directly related document-access queries |
| Schema | db/*.sql by migration number; server/migrations.ts; prisma/schema.prisma |
| UI browser gates | e2e/ux-layout.spec.ts; e2e/fixtures/ui.ts; relevant responsive/usability/authentication cases |
| Integrated journeys | e2e-integration/workspace-ui.spec.ts; sharing.spec.ts; collaboration.spec.ts; cloud-images.spec.ts; relevant transfer/navigation cases |
| Inherited baseline | docs/workspace-ux-m11.md; workspace-ux-evidence/m11-owner-1440-light.png; m11-owner-390-light.png and relevant dark/guest captures |

Confirm paths/symbols at the start of the selected milestone. Do not scan unrelated
repository folders or load all historical milestone documents.

## 10. Milestone status and execution order

Use **Pending**, **In progress**, or **Verified locally**. A checked task is not
equivalent to a passed milestone gate. If incomplete, resume it before advancing.

| Milestone | Deliverable | Dependencies | Status |
| --- | --- | --- | --- |
| R0 | Baseline and reviewable visual proposal | None | Verified locally |
| R1 | Shared visual tokens and UI primitives | R0 | Verified locally |
| R2 | Header removal, sidebar, account/title layout | R1 | Verified locally |
| R3 | Drawing controls, contextual panels, responsive polish | R2 | Verified locally |
| R4 | Link data model, authenticated API, access integration | R0 | Verified locally |
| R5 | Direct Share, settings, recipient/sign-in flows | R2, R4 | Verified locally |
| R6 | Automatic freshness and refresh-control removal | R2, R5 | Verified locally (combined R7 gate) |
| R7 | Integrated acceptance and release handoff | R0-R6 | Verified locally |

Default execution order is R0 through R7, one milestone per session. R4 is a
larger backend milestone; if it exceeds one session, save a named substep and
resume R4 rather than falsely marking it complete or expanding into R5.

R6 application implementation is complete. Its original session ran TypeScript/
diff checks and skipped runtime checks; the user subsequently reported local
verification. The current R7 gate now verifies the combined implementation,
including R6 freshness, hidden/offline polling and bounded original-intent
recovery. Keep the earlier evidence as historical records; do not restart R6.

### R0 - Baseline and visual proposal

Read: sections 1-3, 8-9, 12-13; relevant saved screenshots and shell components.

- [x] Record focused Git status and identify inherited uncommitted M11 work.
- [x] Inspect current desktop/mobile and light/dark behavior using existing
  fixtures; reuse historical evidence when current code is unchanged.
- [x] Produce a small local clickable visual proposal or equivalent reviewable
  renders for owner desktop, collapsed sidebar, guest, and mobile.
- [x] Include long title, tools/styles, page menu/Link settings, and status/error
  examples. Clearly label simulated sharing behavior as a proposal.
- [x] Record tokens, control placement, breakpoint behavior, and final design
  decisions in a compact companion spec referenced by this plan.

Gate: inspect desktop 1440x900 and mobile 390x844 proposals in both themes; also
check narrow/short constraints. Confirm no full-width header card, no routine
Refresh control, and the complete one-click sharing design. No backend behavior
is claimed implemented. Present the visual result with the handoff.

Verified 2026-10-07: [clickable proposal](docs/ui-redesign-proposal.html),
[design decisions and evidence](docs/ui-redesign-r0.md). Required 1440x900 and
390x844 views inspected in both themes; narrow/short constraints pass. Two
inherited owner/guest layout fixtures and 47 proposal checks passed. No spanning
application header card or routine Refresh control; one-click Share and its
failure/consent/recipient paths are clearly simulated. All 47 inherited changed
files and the old-plan deletion are preserved. No application/backend change.

### R1 - Shared visual foundation

Read: sections 3.3, 3.5, 8; styles, theme, Menu/Dialog, relevant button consumers.

- [x] Implement consistent visual tokens, typography, icons, buttons, focus,
  popovers, dialogs, inputs, and semantic status/error styles.
- [x] Remove conflicting declarations only in touched presentation areas.
- [x] Preserve native/control semantics, keyboard isolation, and theme choices.

Gate: focused theme/menu/dialog/layout checks and frontend build. Inspect light
and dark output. Do not add tests that merely mirror CSS values.

Verified 2026-10-07: [implementation and evidence](docs/ui-redesign-r1.md).
Shared token/native-control CSS is applied in the actual application. Twenty
focused browser cases, frontend build, strict fixture-aware test typecheck and
diff checks pass. Desktop/mobile and native form/error output inspected in both
themes. All 90 protected inherited/learning entries retain their hashes/status;
old-plan deletion preserved. No API/schema/dependency or production change.
At R1 completion, R2 remained Pending; no shell/navigation relocation or new
sharing behavior was included in that milestone.

### R2 - Workspace shell and navigation

Read: sections 3.1-3.2, 3.6, 8; ServerBoards, PageSidebar, BoardIdentity, Account.

- [x] Remove the full-width header surface and introduce discrete control regions.
- [x] Build the full-height flat desktop sidebar and mobile drawer.
- [x] Move account/help/theme placement without duplicating lifecycle ownership.
- [x] Preserve page actions, search, title editing, role restrictions, and focus.
- [x] Replace measured header assumptions with appropriate overlay geometry.

Gate: guest/owner/viewer, sidebar open/closed, long titles, keyboard/IME editing,
mobile navigation, and pan/zoom position preservation. Confirm backdrop clicks
and UI keyboard shortcuts cannot accidentally draw/delete canvas objects.

Verified 2026-10-07: [implementation and evidence](docs/ui-redesign-r2.md).
Independent title/Share overlays and the flat desktop/sidebar drawer layout are
implemented in the actual application. Twenty-five focused browser checks,
frontend build, strict fixture-aware TypeScript and diff checks pass. Both-theme
desktop/mobile output inspected. All 118 protected inherited/learning entries
retain hashes/status; historical screenshots and old-plan deletion preserved.
Account/cursor ownership, canvas bounds, coordinates, history and persistence
remain intact. No API/schema/dependency, production, commit or deployment change.
At R2 completion, R3 remained Pending.

### R3 - Editor controls and responsive polish

Read: sections 3.3-3.6, 8; Toolbar, ToolOptions, ZoomControls and related styles.

- [x] Refine dock, adjacent history, zoom, active states, and contextual selection UI.
- [x] Condense desktop styles and implement compact mobile presentation.
- [x] Restyle remaining consent/recovery/help/account/empty/error surfaces.
- [x] Fit controls to sidebar, safe areas, short viewports, and virtual keyboard.

Gate: targeted draw/select/pan/zoom/drag/resize/undo/redo tests with UI overlays;
responsive/theme screenshots; keyboard focus/Escape; mobile styles/tool switching.
Rendering and interaction behavior remain the existing implementation.

Verified 2026-10-07: [implementation and evidence](docs/ui-redesign-r3.md).
The editor controls use the shared R1 tokens in one coherent stylesheet. Quiet
history sits above the dock; zoom has a compact percentage menu. Desktop styles
are condensed, and compact panels collapse when drawing resumes. Dialogs,
consent, recovery, Help and empty states share the same presentation. Forty-two
focused browser checks, 21 unit checks, frontend build, strict fixture-aware
TypeScript and diff checks pass. Both-theme desktop/mobile and keyboard output
inspected. All 158 protected inherited/learning entries retain hashes/status;
one overwritten R2 capture was restored with its exact original bytes. Canvas
coordinates, selection, pointer ownership, atomic history and persistence remain
intact. No API/schema/dependency, production, commit or deployment change.
At R3 completion, R4 remained Pending.

### R4 - Authenticated reusable links

Read: sections 4-6, 8; sharing, permission/session helpers, permission SQL callers,
SQL/Prisma mappings, and relevant server/database tests.

- [x] Record final endpoint/storage/token/version and permission-resolution design.
- [x] Add additive link state and generation-bound account grants.
- [x] Implement owner settings/copy and authenticated resolve/open operations.
- [x] Apply effective permissions across lists, workspace, documents, images,
  operations/replay, subscriptions, presence, and upload paths.
- [x] Preserve explicit membership/invitations, account fencing, CSRF, budgets,
  existing transactions, and error privacy.
- [x] Implement capability/version behavior, uncertain-response reconciliation,
  revocation/downgrade, and fresh links after re-enabling.
- [x] Record migration, token configuration, signed-URL lifetime, and rollback limits.

Gate: meaningful server tests plus actual disposable PostgreSQL checks for
multi-user link reuse, viewer/editor limits, forged/invalid/revoked links,
concurrent copy/settings/open, lost responses/restart, independent membership,
schema preservation, all protected resource paths, and account/session changes.
Verify frontend/backend builds/typechecks as affected. No production migration.

Verified 2026-10-07: [implementation and evidence](docs/ui-redesign-r4.md).
SQL 12 adds link state, generation-bound account grants and separate owner request
receipts; Prisma mappings match the disposable migrated database. Owner settings/
Copy/Stop and authenticated open routes use current session/origin/account checks.
SHA-256 verification plus AES-256-GCM protects reusable token material with the
optional backend SHARE_LINK_KEY. Central effective-role helpers cover every
protected resource path and preserve independent membership/invitations. Stable
request/version checks prevent superseded retries from restoring sharing or roles.
Capability version 1 and typed client boundaries are ready for R5. Verified: 844
fast checks, 176 real PostgreSQL cases (25 R4), both builds, strict fixture/client
TypeScript, Prisma validation and diff checks. Actual dropped-response/API-restart
and live SSE revocation journeys pass. All 201 protected inherited entries and
normal DB 15 tables/32 rows retain hashes; normal SQL stays 11; zero test schemas.
No production/provider/configuration, dependency, commit or deployment change.
R5 remains Pending; direct Share/settings/recipient UI stays within that milestone.

### R5 - Share and recipient flows

Read: sections 4-6; Sharing, Account, workspace navigation/lifecycle, client API.

- [x] Replace email-invitation creation with direct Share and Link settings.
- [x] Add busy, copied, network-error, stale completion, and clipboard fallback states.
- [x] Preserve destination across Google sign-in and resolve for the signed-in actor.
- [x] Open via workspace controller, preserve drafts/guest source/transfer intent,
  and show correct role and Shared with me entry.
- [x] Keep legacy invitation acceptance and independently granted member access.
- [x] Handle unsupported backend, canceled sign-in, session expiry, and revocation.

Gate: actual owner and two recipient browser/API/DB journeys. Verify the sender
clicks Share once to copy, no new email field exists, signed-out recipients cannot
read protected data, viewer writes fail server-side, editor changes persist,
revocation works, and clipboard/auth/navigation failures are recoverable.

Verified 2026-10-07: [implementation and evidence](docs/ui-redesign-r5.md).
Actual app direct Share/settings, recipient OAuth/workspace and guest-transfer
continuation are wired to R4. Fifteen actual browser/API/Prisma/PostgreSQL journeys,
865 fast checks, 26 editor/layout regressions, frontend build, strict focused
TypeScript and diff checks pass. Native clipboard reuse/fallback, stable unknown
request retries, concurrent-version review, privacy, roles, offline draft
revocation, session expiry and exact transfer destinations are verified.
Light/dark desktop/mobile settings and separated notices inspected. All 238
protected entries and normal local DB 15 tables/32 rows remain unchanged; zero
disposable schemas. Normal SQL 12/key activation remains separate. No production,
provider, dependency, commit or deployment change. R6/R7 remain Pending.

### R6 - Automatic freshness

Read: section 7; PageSidebar, ServerBoards, Sharing, accountBoardQueries.

- [x] Remove routine Refresh pages/sharing/invitations UI.
- [x] Use stale focus/sidebar-open/reconnect reads and mutation invalidation.
- [x] Add only the bounded visible-sidebar polling necessary for other-device updates.
- [x] Reconcile uncertain sharing outcomes automatically; retain error-only Retry.
- [x] Preserve cached data, active documents/drafts, and account isolation.

Gate: stale/failed/cached lists, other-device changes, join/revoke/rename/delete,
offline/reconnect, retry success, hidden-tab polling limits, and account switch.
Confirm background refresh does not overwrite the editor or add history entries.

Implemented 2026-10-08: [application changes and handoff](docs/ui-redesign-r6.md).
Shared metadata options, stale sidebar-open/focus reads, reconnect refresh,
visible/online 30-second polling, cached error states and error-only Retry are
wired to the actual application. Unknown link outcomes automatically replay
their exact recorded intent with bounded attempts, preserve version conflicts,
and never run the canvas preparation helper in the background. Recovered Copy
uses a nonmodal notice and a fresh clipboard action. Account-bound metadata
headers supplement existing cancellation/cache isolation. Application TypeScript
and diff checks pass; no tests, builds or browser/visual checks were run, per the
user's implementation-only request. Subsequently, on 2026-10-08, the user
reported R6 completed and verified locally without supplying detailed results.
R7 subsequently verified the combined application; the table now reflects that
current gate while this paragraph preserves the original R6 session's scope.

### R7 - Integrated acceptance and handoff

Read: section 11, completed milestone results, section 12, relevant M11 commands.

- [x] Run the integrated matrix on the final combined checkout.
- [x] Inspect representative desktop/mobile/light/dark screenshots and focus/error states.
- [x] Run appropriate full fast/browser/API/DB gates and both builds/typechecks.
- [x] Verify additive migration/existing-data preservation and fixture teardown.
- [x] Record exact commands, results, missing physical/provider checks, final API
  contracts, configuration, rollout order, mixed-version behavior, and rollback.
- [x] Update final status and next handoff. Ask whether the user wants a commit;
  do not commit, push, deploy, or apply production SQL without authorization.

Gate: all required automated checks pass, visual acceptance is inspected, and any
unperformed human/provider acceptance is explicitly separated from verified work.
If a required check is failing/unrun, keep R7 In progress and name the next step.

Completed 2026-10-08: [R7 release and acceptance handoff](docs/ui-redesign-r7.md).
The user extended the earlier handoff-only request to integrated acceptance and
local server startup. Current results: 868 fast checks, 176 PostgreSQL checks,
108 standard browser checks (three historical baseline skips), and 87 integrated
cases verified across a full run plus focused fixture rechecks. Both builds,
browser/config/deployment types, Prisma validation and diff checks pass. Current
visuals were inspected in both themes. Acceptance fixed a long-account-name
sidebar overflow and reconciled stale fixtures without weakening consent/access
assertions. Normal-local SQL 12 and a stable backend key were configured after
an encrypted backup; existing data was preserved and final fixture teardown
verified. Physical/provider checks and production release remain separate.

## 11. Acceptance matrix

| Area | Required evidence |
| --- | --- |
| Visual scope | No full-width header card; edge-attached flat sidebar; consistent controls/dialogs; restrained borders and accent; both themes. |
| Responsive | 1440x900, 1024x768, 768px boundary, 390x844, 320px narrow width, and short landscape; safe areas and reduced visual viewport. |
| Navigation | Guest/owner/editor/viewer; sidebar collapse; search; New page; rename; delete/final page; direct links; Back/Forward; long titles. |
| Accessible interaction | Keyboard focus order, tooltips/labels, menu navigation, Escape/restoration, IME, readable contrast, reduced motion, touch targets. |
| Pointer isolation | Menu/drawer/dialog interaction does not draw, pan, delete, or trigger canvas shortcuts. |
| Coordinates/history | Sidebar/style toggles with pan/zoom; drawing/drag/resize/text; interruptions; selection ownership; atomic and selective undo/redo. |
| Share sender | One normal click -> usable copied link; repeated copies stable; no email; no duplicate link; correct page/account despite async changes. |
| Recipient auth | Google required before any protected metadata/document/image/live data; destination preserved; cancel/failure/retry; multiple recipients. |
| Link roles | Viewer cannot mutate; editor can use permitted edits; neither can delete/manage; explicit membership remains independent. |
| Revocation | Stop blocks new resolution and subsequent protected requests; active sessions update; old links stay invalid after sharing again. |
| Secret handling | Token absent from normal lists/logs/provider URLs; URL/base-path handling; storage-unavailable fallback; no cross-account leakage. |
| Freshness | No routine Refresh controls; sidebar-open/focus/reconnect and mutations update lists; error-only Retry; no editor replacement. |
| Persistence | Guest local-only work, explicit transfer, IndexedDB v4 journals, draft recovery, save retries, image mappings and receipts survive. |
| Collaboration | Two browser accounts, effective role checks, live presence/doc changes, selective undo, offline/reconnect, permission loss. |
| Compatibility | Existing members/invitations/URLs/pages/images retained; additive SQL; old frontend/backend behavior documented; no false working share link. |
| Real-world limits | Record physical keyboard/IME/pen/sleep, screen-reader, actual browser zoom, and Google/provider checks separately when unperformed. |

Use the narrowest meaningful validation per milestone. Reuse existing fixtures
and tests where they verify behavior. Run the broader gate in R7 or when a new
failure/risk justifies it; do not repeatedly rerun historical proofs without cause.
Use isolated disposable schemas/fixtures for mutation tests and preserve normal
local/production data, containers, volumes, assets, and credentials.

## 12. Definition of done and release boundaries

The redesign is complete when R0-R7 are verified locally, the visible UI matches
this specification, and authenticated sharing/freshness work across actual
browser/API/database paths without regressing the inherited editor behavior.

The final handoff must distinguish implemented, automatically verified, visually
inspected, manually verified, and still-pending results. Include representative
screenshots, changed files, migrations/API changes, meaningful limitations, and
the next concrete action.

Production release is a separate decision. Prepare its concrete reviewable steps
and configuration first. Do not apply production SQL, change providers, install
paid infrastructure, push/deploy, or trigger deployment through a commit/push
without explicit authorization. Never drop additive sharing or recovery data as
an automatic rollback step.

## 13. Current implementation handoff

Replace this block after each milestone; keep it approximately 150-250 words.
Store detailed commands/evidence in a companion milestone note when necessary.

- Latest verification: **R7 - Verified locally, 2026-10-08**. R0-R6 implementation
  is accepted on the combined checkout; shared tokens/primitives remain R1.
- Read docs/ui-redesign-r7.md for exact commands, current screenshots, final
  sharing contracts, configuration, rollout and rollback. Fresh R7 evidence
  preserves all R0-R6/M11 records.
- Verified: 868 fast checks, 176 PostgreSQL checks, 108 standard browser checks
  (three historical baseline skips) and 87 integrated cases across a full run
  plus focused fixture rechecks. Both builds, browser/config/deployment types,
  Prisma validation, contrast/focus/error visuals and diff checks pass.
- Acceptance reconciled obsolete Refresh/email/Share-dialog and save-label
  fixtures, added meaningful freshness/recovery coverage, and fixed long account
  names overflowing the sidebar footer and intercepting zoom. Learning documents
  and unrelated inherited work are preserved.
- Local app: http://127.0.0.1:5173/scribble/. Docker PostgreSQL on 5434 and API on
  3001 are healthy and left running. Missing SQL 12 caused startup failure; an
  encrypted backup preceded the additive migration and stable ignored local key.
  Earlier rows/schema/ledger were preserved. Final normal DB remains 18 tables/
  33 rows, ledger 12, with zero disposable schemas/specs or acceptance servers.
- Next: physical keyboard/IME/pen, screen reader, actual browser zoom/sleep and
  live Google/ImageKit acceptance; then separately authorized production release.
  Production still requires its own backup, ledger/key review, additive SQL,
  backend then frontend. Preserve link/receipt data and IndexedDB v4 on rollback.
  No commit, push or deployment; stop after this milestone.

### Durable implementation decisions

Record concise final choices here when made; do not append session transcripts.

- 2026-10-07: user selected Google sign-in required to view or edit shared pages.
- 2026-10-07: this plan replaces the completed workspace UX root plan; retain
  its one-milestone-per-session continuation method.
- 2026-10-07 (R0): visual tokens and placement finalized in docs/ui-redesign-r0.md;
  240px edge sidebar, compact independent controls, mobile below 768px and
  intermediate-width drawer/on-demand panels through 1100px. Saved visibility
  and canvas coordinates must remain unchanged by adaptive presentation.
- 2026-10-07 (R1): shared theme tokens and native-control presentation live in
  src/ui-tokens.css and src/ui-primitives.css. Preserve existing Menu/Dialog
  semantics and drawing-dock geometry when reusing them in subsequent milestones.
- 2026-10-07 (R2): workspace-shell.css owns independent overlay and flat-sidebar
  geometry. Drawer presentation extends through 1100px without changing saved
  desktop visibility. Keep one mounted Account/Help owner when relocating their
  controls; modal Tab containment must include portaled footer controls.
- 2026-10-07 (R3): editor-controls.css owns drawing-control presentation; remove
  competing rules from styles.css when touching this area. Compact styles follow
  the 1100px/500px media query and collapse on canvas pointer-down, never pointer
  move. Keep swatch hit areas separate from their paint and use the existing Menu
  and visual-viewport measurements for zoom. Durable drawing/settings stay unchanged.
- 2026-10-07 (R4): SQL 12 and Prisma map separate link/grant/receipt data. Central
  role helpers combine independent access by greater permission; only enabled
  matching generations count. Tokens are SHA-256 verified and AES-256-GCM protected
  under backend SHARE_LINK_KEY. Settings versions and original request receipts
  fence unknown outcomes. Capability shareLinks:1 gates the typed client; R5 owns
  application Share/sign-in/clipboard/navigation UI. Rollout is migration ->
  configured backend -> frontend; retain additive data on backend rollback.
- 2026-10-07 (R5): ShareLinkActions owns nonsecret tab mutation identity and reviewed
  settings versions; WorkspaceController owns authenticated link navigation and
  exact guest-transfer continuation. Keep recipient tokens in short-lived tab
  intent only, fence stale completions, and retain legacy invited access separately.
- 2026-10-08 (R6): metadata reads share account-scoped options and pause visible-list
  polling when hidden/offline. Access mutations invalidate metadata, excluding
  editor documents. Automatic receipt recovery reuses its original intent and
  bypasses canvas preparation; confirmed Copy feedback never steals focus.

## 14. Historical milestone-session prompt

R0-R7 are complete; there is no next implementation milestone. Keep this prompt
as a reference for the completed local workflow. A future session should name
the remaining manual/provider acceptance or a separately authorized release,
using section 13 and docs/ui-redesign-r7.md, rather than restarting the plan.

~~~text
Implement the next incomplete eligible milestone only from
E:\PROJECTS\the-canvas\UI_REDESIGN_IMPLEMENTATION_PLAN.md.

Follow section 0. Read AGENTS.md and docs/learning-checkpoint.md once, then the
new plan's confirmed requirements, milestone table, current handoff, selected
milestone, and only its relevant specification sections and source files.
The old WORKSPACE_UX_IMPLEMENTATION_PLAN.md was intentionally deleted; do not
recreate it or restart M0-M11. Preserve all inherited uncommitted work.

I authorize the local code, API, additive migration files, commands, existing
local development services, and disposable test fixtures necessary for this
milestone. Preserve existing data. Do not modify production, reset databases,
change providers, commit, push, or deploy.

Key requirements: remove the full-width top bar, redesign the entire UI using
the saved tldraw reference direction, make Share copy a reusable link without
recipient email, require Google sign-in for both viewing and editing shared
pages, and remove routine Refresh pages controls. Preserve free guest drawing,
explicit guest-upload consent, IndexedDB, autosave, collaboration, and undo/redo.

Make routine decisions without repeated permission requests. Complete only the
selected milestone and its focused validation. Update its status/checklist and
the compact handoff; leave learning documents unchanged. Report the reviewable
result, checks performed, any remaining limits, and the next milestone, then
stop so I can continue in a new session. If incomplete, save the exact next
substep instead of marking it verified.
~~~
