# Scribble UI/UX simplification plan

Created: 2026-10-06. Updated: 2026-10-06. Status: phases 0–4 implemented and locally gated; phase 5 local regression checks passed. Human usability and controlled release remain pending.

## Current implementation handoff

Read `AGENTS.md`, the current handoff in `docs/learning-checkpoint.md`, and this
plan. Open `docs/ux-wireframe.html` in a browser for a clickable layout proposal.
It uses invented boards and simulated states; it never accesses accounts or APIs.
The implementation now uses the real session/store state. See `docs/ux-validation.md`
for baseline, flow map, gate results and anonymized screenshots. Resume with human
usability/device checks and controlled release after local verification is complete;
do not repeat implementation phases or treat the wireframe as running behavior.

The objective is a calmer canvas where people can answer: **What am I editing?
Where is it saved? How do I share it? What should I do if saving fails?**
The first delivery is the board/account/save/share experience. Toolbar and visual
polish follow. A prettier interface alone will not resolve confusing flows.

Planning-artifact validation: the standalone preview was rendered in desktop,
mobile, dark and recovery states. Browser checks passed for search, modal Escape
and focus return, the simulated invitation stage, viewer/editor controls and
failure wording, with zero external requests or script errors. Thirty viewport /
state combinations had no overlapping primary controls or horizontal page
overflow. These checks verify the preview only; they do not verify implemented
app behavior, accessibility conformance or usability with participants.

## Current facts and constraints

- The user reports production Google sign-in, cloud APIs and two-account live
  collaboration working. Neon database `scribble`, branch `production`, project
  `muddy-shadow-82970904`, is configured; SQL migrations were applied successfully.
- Frontend: Cloudflare Pages `the-canvas-c3o.pages.dev`. Public entry:
  `https://milanputhukkudy.com/scribble/`. Dashboard Worker `scribble-router`
  forwards the frontend plus root `/api/*`, `/health` and `/ready`.
- API: Render Free `https://scribble-api-003m.onrender.com`. Auto-deploy is OFF.
  Public readiness succeeded per the user. Backend deployment is manual; Pages
  deployment has separate settings. Do not deploy as part of a UX-only change
  unless explicitly authorized. No paid services or added recurring charges.
- Google-only authentication; free guest editing and IndexedDB remain essential.
  Signing in must not upload anything. PWA and Postman are out of scope.
- This review inspected production as a fresh guest at 1440x900 and 390x844 and
  relevant source. It did not inspect a real signed-in account or measure task
  completion with independent participants. Signed-in observations below are
  code-based; validate them with fixtures in phase 0.
- One canonical guest board exists today (`CURRENT_BOARD_ID`). A browser for many
  independent local boards is a separate storage feature, not this redesign.
- Explicit image upload, recovery drafts, selective undo, access rechecks,
  single-writer tab protection and durable operation receipts must survive.
  Text conflicts are object-level; SSE updates are roughly once per second.

## Observed problems, ordered by impact

| Priority | Evidence | User consequence | Proposed response |
| --- | --- | --- | --- |
| P0 | `ServerBoards` is an open-by-default `<details>` with account, board list, uploads, invitations and recovery | Drawing begins with administrative UI already open | Closed-by-default board browser; compact header |
| P0 | `BoardIdentity` shows a save label only for errors; normal cloud status lives inside the panel | People cannot reliably tell whether work is local or in their account | Persistent location and save indicator derived from real state |
| P0 | Upload/retry/reload/copy/restore actions appear beside unrelated actions | Users must understand implementation terms to choose safely | One contextual notice and a focused recovery dialog |
| P1 | Sharing is an inline section within the same board list | Inviting someone competes with board navigation | Dedicated Share dialog for the active owned board |
| P1 | Every board row has Open, Rename, Delete and Share | Board selection becomes a dense action list | Clear row opening action plus a labelled overflow menu |
| P1 | Native prompts/confirms and repeated status paragraphs | Inconsistent focus, hierarchy and feedback | Reusable accessible dialogs and action-local errors |
| P1 | Live mobile guest panel measured 280x276 at 390x844 | It covers a large part of the drawing surface | Responsive board sheet, opened deliberately |
| P2 | Presence status is a separately positioned, high-z-index overlay | Header/presence/admin controls can compete for space | Presence belongs in the header; world-space cursors stay independent |

## Research and what to borrow

These are design references, not requirements to match another product's features.
The proposals below are Scribble-specific inferences from the references and audit.

| Reference | Verified pattern | Application to Scribble |
| --- | --- | --- |
| [Excalidraw](https://excalidraw.com/) and [official repository](https://github.com/excalidraw/excalidraw/blob/master/README.md) | Browser autosave and direct access to drawing/collaboration | Make drawing immediately usable and describe device storage plainly |
| [tldraw UI](https://tldraw.dev/sdk-features/ui-components) | Separate menu, tools, contextual styles, navigation and sharing areas | Give each family of actions a stable home; styles appear for relevant tools/selections |
| [Miro sharing](https://help.miro.com/hc/en-us/articles/360017730813-Sharing-boards-and-inviting-collaborators) | A dedicated Share entry with explicit permissions | Show people, roles and pending invites in one dialog |
| [FigJam tools](https://www.figma.com/resource-library/figjam-tools-for-the-classroom/) | Tools and canvas navigation are directly discoverable | Keep tool labels, shortcuts and pan/zoom guidance accessible |
| [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and [usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Prioritize frequent tasks; expose system status and actionable errors | Keep common actions visible; reveal exceptional controls when relevant |
| [W3C modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [target sizes](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) | Keyboard/focus behavior, pointer targets and non-disruptive announcements | Build these into the controls and validation from the first phase |

Do not copy public-link access, email delivery, teams, templates or paid features.
Scribble currently uses email-bound invitations that owners send themselves.
Do not introduce an Excalidraw/tldraw SDK replacement or a new sync protocol.

## Proposed information architecture

| Surface | Contains | Opens when |
| --- | --- | --- |
| Board header | Boards button, current title, location/save state, Share, account/sign-in; compact collaborators on account boards | Always |
| Board browser | This device entry; signed-in My boards / Shared with me / Invitations; search over the loaded account list | Boards button |
| Account menu | Signed-in identity, sign out, theme/help links where useful | Account button |
| Share dialog | Google email, Can view / Can edit, create invite, copy link, members, pending invites | Owner chooses Share |
| Save details / recovery | Accurate device/cloud status and the relevant retry, upload, restore or reload options | Status button or exceptional notice |
| Tool dock | Existing tools, undo/redo, contextual appearance; maintain established desktop placement initially | Always/contextually |
| Navigation/help | Existing zoom, fit/reset and concise shortcut help | Always or deliberate help action |

Default guest view: title, `On this device`, tools, navigation, a quiet Sign in
entry, and the existing empty-canvas guidance. No mandatory dashboard or tour.
After signing in, the current guest board stays local. Its primary cloud action
is `Save to account`, with a short explanation that this creates an account copy.
For an account board, an owner gets `Share`; an editor/viewer gets a permission
indicator rather than owner controls. Controls must not overlap at narrow widths.

Use `On this device`, not `Private`: device storage does not prove privacy.
Device storage can be cleared; explain that in save details without constant
warnings. Cloud boards remain private to their owner and explicitly authorized
members, but a cloud copy does not automatically remove the device draft.

## Critical journeys and exact behavior

### A. Draw as a guest

Open directly into the current canvas. Device saving works while account checks
are pending or unavailable. Once a device write is confirmed, show `Saved on this
device`. Show `Saving on this device…` while writing. Do not represent a failed
auth check as signed out; offer retry in the account menu. No login nagging.

### B. Sign in and save to an account

Keep the existing pre-sign-in local save boundary. Return to the same local
board. `Save to account` opens one concise explanation, then calls the existing
explicit copy/upload operation. Include image count and upload progress when
relevant. Keep source data. Success means the first document write completed,
not merely that a board ID was created. Partial failure keeps the draft and
reveals what succeeded; retry must reuse existing receipts/mappings and must not
silently create duplicate boards. If existing copy creation lacks that recovery
guarantee, document a bounded follow-up before advertising seamless retry.

### C. Browse and switch boards

Open one board browser. Preserve the existing current guest board as a separate
This device entry. My boards are owner entries; Shared with me uses current
editor/viewer roles. Rows show title, meaningful update time when available and
access. Open is the main action; Rename/Delete/Share use an overflow menu with
labels. Search/filter the loaded list locally; no new endpoint is necessary.
Stale role/list data does not authorize actions; server/access rechecks still do.
Flush current edits at the established boundary before switching. Failures keep
the current board and show retry. Never discard or silently replace unsaved work.

### D. Share and accept an invitation

Local Share intent explains `Save to your account to share`, then uses journey B
with explicit confirmation. Owned account board: Share opens the dialog directly.
Keep the current default Viewer (`Can view`); Editor is `Can edit`. A successful
invite reveals `Copy invitation link` for that invitation, with `Send this link
yourself. Only this Google account can accept it; expires in 7 days.` Never say
`Email sent`. Clipboard refusal offers a selectable link and manual copy.

Member role changes and removal show pending/error feedback on that row. Keep
owner-only controls. Confirm removal/deletion with the person's/board's name.
Do not offer public-link sharing or ownership transfer.

An incoming `?invite=` link surfaces an invitation-focused card, not a long
administrative panel. Preserve invitation intent through sign-in; use the invited
email. Acceptance remains explicit. After authoritative success, present `Open
board` (or open through the existing safe session boundary); never auto-accept.
Handle wrong account, expired, cancelled and already accepted links clearly.
Opening another board through an invitation must preserve the current draft.

### E. Add an image to an account board

Render the new image locally immediately, as today. When an upload is required,
show `1 image waiting to upload` with `Upload and save`. The button is the upload
consent; existing automatic text/object saving cannot trigger a binary upload.
Show completed/total while uploading and a specific retry on failure. Cloud
state cannot say `All changes saved` while any image reference is still local-only
or while edits made during the request remain unsaved. Leave completed asset
retention, copy-to-destination rules and signed URL refresh unchanged.

### F. Recover from failure

Keep problems visible even when menus are closed. One notice identifies the
problem and offers one primary action plus `Details`. Recovery details explain
each alternative and its effect on the device draft before allowing it.
`Use account version` retains a confirmed backup before replacing content.
`Save a copy` creates a separate account board. `Restore device draft` identifies
which recovery snapshot it restores; do not promise a preview unless one exists.
Do not add last-write-wins or merge same-object text behind the user's back.
Access loss requires a permission-specific screen; never imply retry restores
access. Existing allowed copy/export behavior needs verification, not new promises.

## Status contract: simplify presentation, keep the distinctions

Derive UI from the existing local, account, image, access and live state. Do not
persist a second save state or duplicate selection/session ownership. The table
describes representative combinations, not an exhaustive new state machine.

| Situation | Visible wording | Main action / detail |
| --- | --- | --- |
| Guest, confirmed local save | Saved on this device | Save details; optional Save to account |
| Any pending local write | Saving on this device… | Keep drawing; no saved guarantee |
| Local write failed | Couldn’t save on this device | Details and targeted retry; persistent notice |
| Account, acknowledged current content | Saved to account | Save details, including confirmed device draft |
| Dirty/saving account content | Changes waiting to save / Saving to account… | Quiet progress; no repeated toast |
| Pending image uploads | Images waiting to upload | Upload and save |
| Cloud failure, confirmed device draft | Account save failed · saved on this device | Retry save; Details |
| Cloud failure plus failed local persistence | Your changes haven’t been saved | Persistent urgent notice; never claim safe draft |
| Object conflict | This board changed elsewhere | Review options; show backup status honestly |
| Live stream reconnecting | Reconnecting live updates… | Separate from save state; edits may still save |
| Signed out on an account board | Sign in to sync this board | Google sign-in; accurate device draft status |
| Viewer / access removed | Can view / Access removed | Permission explanation; safe allowed alternatives |
| Same-board writer in another tab | Editing in another tab | Reopen here through existing lease/access flow |
| Interrupted/recoverable draft exists | Device draft available | Review/restore, preserving current content |

Surface the most consequential problem first: local data durability, access/tab
restrictions and conflicts must not be obscured by routine upload/live indicators.
Save location, permission and live connection are separate facts. A read-only
label cannot replace an active data-loss warning. Deduplicate alerts by cause;
details still disclose other problems. Avoid a toast on every autosave/heartbeat.

Render Free can wake slowly. Show `Connecting to your account…` and then a
bounded retry path; keep guest drawing available. Do not describe every timeout
as offline. Avoid polling `/ready` to keep the host awake, infinite retries,
longer blanket deadlines or automatic replay of non-idempotent mutations.

## Visual and accessibility direction

- Keep Scribble's violet accent, existing typography, light/dark modes and canvas
  character. Use the current Lucide icons and code-native shapes; no asset purchase
  or new UI framework. Establish a small spacing/radius/type token set after
  checking current CSS, rather than replacing the entire style system.
- One accent primary action per dialog; secondary actions quieter; dangerous
  actions isolated in menus/confirmations. Readable title and status, shorter copy,
  consistent hover/focus/disabled/pending states, no layout jumps while loading.
- Preserve desktop tool order/shortcuts initially. Keep advanced tool properties
  contextual. On mobile retain Select, Note, Text, Pen and More unless task testing
  justifies another split. Do not combine toolbar relocation and pointer rewrites.
- Test 360/390, 768 and 1440 CSS-pixel widths, plus a narrow 320-pixel fallback;
  landscape, long names, soft keyboard, touch and 200% browser zoom. A toolbar or
  open sheet must not cover the active text input or essential actions.
- Aim for 44x44 touch targets. WCAG 2.2 AA's target-size rule is 24x24 CSS pixels
  with exceptions; 44x44 is our larger usability target, not that rule's minimum.
  Check normal text contrast 4.5:1, large text 3:1 and necessary UI/focus contrast
  against the applicable WCAG criteria. Do not communicate role/error by color alone.
- Dialogs have accessible names, focus placement/trapping, Escape and focus return;
  background canvas shortcuts/pointers do not leak through. Use native dialog or
  proven existing primitives where possible; verify nested popovers and IME input.
- Announce meaningful save/action transitions politely and errors appropriately.
  Debounce/deduplicate announcements; no screen-reader flood from cursors or saves.
  Tooltips are keyboard-accessible; help is available without hover. Respect reduced
  motion. Verify controls with keyboard and a screen reader; do not claim full
  canvas accessibility based on dialog checks alone.

## Implementation phases and release gates

### Phase 0 — Baseline and interaction specification

- [x] Inspect only the relevant UI/store/session modules listed below; verify the
  current guest, owner, editor, viewer, upload, conflict, tab and expired-session
  states in isolated fixtures. Save anonymized screenshots and a short flow map.
- [x] Walk through the wireframe, settle header placement and define exact actions
  and focus behavior for each surface. Prototype copy is not a state guarantee.
- [x] Record engineering baseline task steps and existing/new action homes.
- [ ] Validate human findability/timings with the user and, if available, 3–5 people
  unfamiliar with Scribble using non-sensitive test content.

Gate: every existing action has a new home; no missing recovery action or made-up
storage/permission promise. Baseline uses disposable fixture data, not real boards.
The engineering baseline and action mapping passed locally. Signed-in/failure
fixtures are verified; participant feedback/timings remain pending separately.

### Phase 1 — Header, account and truthful save status

- [x] Keep one application-scoped account session/cursor subscription when moving
  the UI; collapsing a menu must not unmount persistence or close collaboration.
- [x] Introduce the compact header, account menu and derived status presentation.
  Keep current session commands and hide the old panel only once replacements work.
- [x] Show important notices outside menus; test combined local/cloud/image/access
  failures and clean loading/guest states. No wholesale canvas restructure.

Gate: guest drawing/reload, login without upload, sign out, normal cloud save,
pending image, local failure and cloud failure all retain correct behavior.
No duplicate subscriptions, API loops, session state or per-pointer React updates.

### Phase 2 — Board browser and explicit save/upload journeys

- [x] Replace the board list with the drawer/sheet; implement loaded-list search,
  My boards / Shared with me / Invitations and the current device entry.
- [x] Move rename/delete into accessible contextual menus and dialogs. Reuse
  session open/back/create/rename/remove/copy boundaries and real role checks.
- [x] Add the explicit Save to account / Upload and save flows with progress,
  partial-failure details and safe cancellation. Do not silently discard work.

Gate: switch/reload with drafts, copy with images, guest/cloud separation,
account switching, stale access, offline/timeout and two-tab ownership pass.
No new local-board schema, endpoint or automatic upload is introduced.

### Phase 3 — Sharing and invitation experience

- [x] Implement the focused Share dialog, row-level roles/pending feedback and
  immediate link-copy affordance after invitation creation.
- [x] Present the invitation-link journey with explicit acceptance and safe Open
  board; verify intent survives Google redirect and wrong-account cases.
- [x] Integrate compact presence into the header without changing SSE/cursor
  subscriptions, coordinates, throttling or selective undo semantics.

Gate: owner/editor/viewer permissions, cancellation/removal, copied/manual links,
expiry, two distinct browser contexts and independent/conflicting edits pass.
No email delivery or public access is implied. Every invite creates at most one
intended mutation, even after double-clicks or a lost response.

### Phase 4 — Recovery, responsive UI and visual polish

- [x] Unify notices and recovery details; preserve each existing restore/reload
  action and accurately distinguish failed device saving from successful backup.
- [x] Complete responsive drawer/dialog behavior, contextual tool styling, loading,
  empty/error states, consistent tokens, light/dark and help affordances.
- [x] Run automated keyboard/focus/scoped contrast, equivalent 200% layout and
  reduced keyboard-viewport checks.
- [ ] Validate screen-reader use, actual browser zoom, hardware IME and physical
  mobile soft keyboards with people/devices.

Gate: conflict, downgrade, removed access, tab loss and restore remain discoverable
with menus closed. Drawing pan/zoom/selection/drag/resize/history behave as before.
Before/after mobile and desktop review shows a calmer primary workspace.

### Phase 5 — Usability validation and controlled release

- [ ] Repeat the short task script below. Observe rather than explain the UI. Fix
  failures in the relevant phase before calling the redesign complete.
- [x] Run affected fast tests and `npm run build`; add browser tests for new
  user-visible boundaries using existing mocked account fixtures. Use actual
  browser/API/DB cases when session, permissions, upload or recovery behavior changes.
  Update obsolete labels/selectors without weakening behavioral assertions.
- [x] Review the focused local diff and screenshots.
- [x] Obtain fresh authorization for this delivery’s commit and push (2026-10-06);
  use `[CF-Pages-Skip]` for this commit to omit its Pages deployment.
- [ ] Review hosted CI and obtain separate deployment authorization.
  Backend auto-deploy stays OFF; Pages deployment settings are independent.
- [x] Preserve existing API contracts; no endpoints or database schema changes.
  Prefer existing API contracts. If a contract change is necessary, isolate it,
  keep compatibility and release the backend before a dependent Pages frontend.
  Pages can publish on push: verify its deployment settings before release.

Local gate: 582 fast tests, 49 standard browser cases and 17 actual API/DB cases
passed; build, fixture typecheck and diff validation passed. Evidence and scoped
limitations are in `docs/ux-validation.md`. Human acceptance and controlled release
are pending; this does not claim the human completion targets below were achieved.

Release gate: all critical paths pass; documented limitations are explicit. Keep the
previous frontend deploy/commit available for rollback. UX-only releases do not
require database resets, image deletion or Neon schema changes.

## Acceptance script and completion measures

Proposed targets are evaluation goals, not results already achieved. First record
the current baseline; record human task timings separately from host wake/network
delay. Small-sample observations help prioritization, not statistical guarantees.

| Task | Pass condition |
| --- | --- |
| First visit | Create a note within 30 seconds without a tour/login or opening admin controls |
| Explain storage | After editing, identify device vs account location and whether saving completed |
| Sign in | Current guest board remains; sign-in alone makes zero board/image uploads |
| Save to account | Find the action within 15 seconds; understand it creates a cloud copy |
| Find a board | Locate/open a known board from the browser without scanning per-row action clusters |
| Share | Find Share within 10 seconds; choose a role, create invite, copy link and know no email was sent |
| Receive invite | Sign in to the invited account, accept explicitly and open without losing previous work |
| Upload an image | Find Upload and save; progress and failure are visible; never see a false saved claim |
| Cloud outage | Keep drawing locally when allowed; identify retry and actual local-save state |
| Conflict/revocation | Identify the cause and a safe allowed next action; never overwrite silently |
| Keyboard/mobile | Open/close menus and dialogs, return focus, edit text and navigate without canvas shortcut leakage |

Critical automated acceptance: zero unintended uploads, zero lost test objects or
assets, no duplicated save/invite on retries, no authorization bypass, and one
expected local undo history action per user-visible edit. If a gate fails, stop
the next phase and repair the failure; a visual improvement does not waive it.

## Code map for focused implementation

| Area | Existing entry points |
| --- | --- |
| Application/session lifetime | `src/App.tsx`, `src/components/ServerBoards/ServerBoards.tsx`, `src/persistence/accountBoardSession.ts` |
| Title/save/account | `src/components/BoardIdentity/BoardIdentity.tsx`, `src/components/Account/Account.tsx`, `src/store/boardStore.ts` |
| Sharing/invitations | `src/components/ServerBoards/Sharing.tsx`, `src/api/sharing.ts`, `src/api/accountBoardQueries.ts` |
| Local durability/tab protection | `src/persistence/useLocalBoardPersistence.ts`, `src/persistence/localBoardStorage.ts`, `src/persistence/boardTabCoordinator.ts` |
| Toolbar/layout/presence | `src/components/Toolbar/Toolbar.tsx`, `src/components/ToolOptions/ToolOptions.tsx`, `src/components/CollaborationPresence.tsx`, `src/styles.css` |
| Coordinate/focus boundaries | `src/canvas/viewport/CanvasViewport.tsx`; its DOM rect and pointer-exclusion selectors require checking when controls move |
| Existing behavior tests | `e2e/account-boards.spec.ts`, related `e2e/` cases, `e2e-integration/` image/sharing/collaboration/cross-tab fixtures |

Suggested UI boundaries: `BoardHeader`, `SaveStatus`, `BoardBrowser`,
`AccountMenu`, `ShareDialog`, `RecoveryDialog` and a small reusable dialog/menu
layer. These are tentative component names, not required files or a new state
architecture. Keep durable behavior in the existing session/stores; React state
owns only transient presentation such as open panel and search text.

## Explicitly deferred

PWA, Postman, new authentication, public sharing/email delivery, CRDT/WebSocket
replacement, comments/templates/teams/AI, multi-board guest storage, provider
migration and paid hosting are outside this UX plan. Automatic completed-image
reclamation remains a separate policy. Encrypted offsite backups, deployment
schedulers and monitoring are still operational follow-ups; this plan does not
pretend they were activated by deployment or redesign.

## Next session

Read the current handoff and `docs/ux-validation.md`. Run the short acceptance script
with the user/3–5 unfamiliar participants, hardware mobile/IME/screen-reader checks,
and actual browser chrome zoom; record results separately from automated tests.
Resolve observed failures before release. Review Cloudflare Pages deployment settings,
hosted CI and rollback availability, then seek separate deployment approval.
This delivery’s commit/push is authorized; future commits and pushes need fresh approval.
Render auto-deploy stays OFF. No database reset, Neon migration, image deletion,
PWA/Postman work or paid-resource change is required for this frontend UX release.
