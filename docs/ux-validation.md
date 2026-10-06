# UX implementation evidence

Started 2026-10-06. Screenshots use disposable browser contexts and invented content.
No production accounts, boards, images or database records are used.

## Phase 0 baseline and interaction decisions

The clickable proposal was exercised in Chromium: board search, modal Escape and
focus return, and image save details. Its labels are simulated; the app's actual
session, IndexedDB and role state remain authoritative.

Baseline captures: `ux-evidence/baseline-*.png` (guest desktop/mobile, owner,
cloud failure, conflict, combined failure, tab restriction and proposal).
Role, expiry and image behavior are covered by the existing browser fixtures;
real collaboration and tab behavior were subsequently revalidated with the isolated
API/DB fixture after their presentation changes.

Engineering baseline: the open guest panel takes 280×276 pixels at 390 pixels wide.
Account-board actions require scanning a panel with repeated per-row controls.
Save location is one panel paragraph; normal device saves have no persistent label.
These are observed paths, not measured participant timings.

| Task | Baseline steps | Implemented steps / observed change |
| --- | --- | --- |
| Create a note | Choose Note → canvas → enter text → Escape | Same four steps; admin panel closed by default |
| Identify save location | Find paragraph in open Server boards panel | Persistent header location and confirmed-save status |
| Save guest board to account | Find Upload local board → start | Save to account → explicit confirmation; two deliberate clicks |
| Open known board | Scan open mixed list → Open | Boards → category/search → board title; deliberate browsing surface |
| Share current owner board | Find correct row → Share | Header Share; one entry click |
| Find recovery | Scan failure text and actions in long panel | Header status or persistent Details → contextual recovery actions |

The extra save confirmation is intentional consent. Step counts do not establish
human findability or faster task completion.

| Existing action | New home / interaction |
| --- | --- |
| Edit title | Header; same store and Enter/Escape blur boundary |
| Check account / Google sign-in / sign out / retry check | Account dialog; session stays mounted |
| Open / back to device / new account board / refresh | Boards drawer; safe session boundaries |
| Rename / delete | Board row actions → labelled dialog; role checks preserved |
| Upload guest board / save copy | Explicit Save to account / Save a copy dialog |
| Upload pending images | Status notice → Upload and save confirmation/progress |
| Retry account save | Persistent notice and Save details |
| Reload account version / previous draft / interrupted draft / reopen tab | Persistent notice and Save details; explain backup boundary |
| Share / invite / roles / remove / cancel / copy link | Focused Share dialog, owner only |
| Accept / decline invitation | Invitations category; invite link opens it deliberately |
| Undo / redo / selection / theme / tools / pan / zoom | Existing canvas controls, concise Help |
| Live participants / cursors | Header status / existing world layer |

Dialogs use native modal focus trapping, close/Escape and return focus. Account and
session effects remain application-scoped. Modal keys do not reach canvas shortcuts.
The header sits above the existing desktop tools; mobile keeps its existing dock.

Copy creation has **no metadata idempotency receipt**. If the metadata POST response
is lost, the app cannot prove which board was created. Do not silently replay it or
advertise seamless retry; refresh the account list to inspect the result first.
After the destination draft is installed, retry images/document saving on that
same board using existing mappings and operation receipts.

Human baseline feedback and 3–5 participant task observations are pending; no
human findability/timing or screen-reader conformance is claimed. They do not block
the locally authorized engineering work, and remain a pre-release validation step.

## Phase results

Results are added only after each local gate passes.

Phase 1: build, 3 status tests and 2 new browser boundaries passed. Guest reload,
sign-in without uploads, sign-out, account save, pending image and combined device/
account failure are covered. One account/session/cursor lifetime remains in App's
controller; modal state does not control its mounting.

Phase 2: 19 affected finite account browser cases and 9 actual API/Prisma/PostgreSQL
image/cross-tab scenarios passed. The additional cancellation scenario passed:
stop during an upload retains the destination draft; retry saves to the same board
without another metadata creation. Already accepted provider work can finish after
client abort; the existing upload gate then releases. The UI explains that a limit
can require waiting. No upload is automatically replayed.

Three focused browser cases cover closed guest defaults, truthful combined failures,
board categories/search/contextual rename/delete and explicit copy consent.

Phase 3: 4 focused sharing/invitation browser cases and 7 real sharing/collaboration
cases passed. The real cases use distinct browser contexts, authorized SSE, object
conflicts, independent edits, selective undo, reconnect, lost-response receipts,
world-space cursors, acceptance, downgrade and revocation. Double-submit plus a
lost invite response sends one mutation and exposes read/clipboard fallback.
Invitation intent survives the frontend's Google redirect via tab-scoped session
storage; it never grants access or accepts an invitation. Actual Google consent
and real clipboard permission prompts remain human/hosted checks.

Phase 4: 30 account/auth/layout browser cases, the targeted touch regression and
the added keyboard/contrast/IME/keyboard-viewport case passed. A real failed
IndexedDB write is retryable through the existing queue and survives reload.
Nested Escape closes one dialog; Tab stays within the active dialog and focus
returns. Collaborator names open in a keyboard-accessible dialog from the live
header control; Enter/Escape and focus return pass with actual SSE peers. New text/primary labels pass 4.5:1; input boundaries and focus tokens
pass 3:1 against the tested light/dark surfaces. This is scoped token validation,
not a full canvas contrast or accessibility conformance claim.

Widths 320/360/390/768/1440, long titles, landscape, light/dark, a reduced mobile
keyboard viewport and an equivalent 200% layout (half CSS viewport, double raster
density) were inspected. Screenshots: `ux-evidence/after-*.png`. Actual browser
chrome zoom, physical soft keyboards, hardware IME and screen-reader testing
remain pending. The first broad run exposed mobile history/dock overlap and
nested modal Escape propagation; both were repaired and their gates rerun.


## Phase 5 local regression and release handoff

Local checks on 2026-10-06:

- `npm test`: 582 passed. The standard fast command skips 95 PostgreSQL-only
  checks; those are not claimed as rerun in this UX session.
- `npx playwright test --reporter=line`: 49 passed, one historical baseline
  capture skipped by default. The opt-in baseline capture passed before UI edits.
- `npx playwright test -c playwright.integration.config.ts --reporter=line`:
  17 passed against the actual local API/Prisma/PostgreSQL fixture. Image storage
  is a controlled in-memory provider; no ImageKit/production mutations occurred.
- `npm run build` and the integration-fixture TypeScript check passed. Vite reports
  the existing nonblocking bundle-size warning; no dependency/splitting change
  was included in this UX scope.
- Focused diff review and whitespace validation passed. Existing deployment notes
  in `docs/implementation-status.md` were preserved; its UX summary was subsequently
  updated for the authorized delivery commit.

The broad browser run exposed two pen tests starting over the relocated settings
panel and an assertion matching a stale screen-reader announcement. Test gestures
now use exposed canvas; saved-state assertions target the visible header. Object,
asset, revision, history and permission assertions remain. Viewer and removed-access
messages are checked separately. The live desktop/mobile screenshots use actual
SSE-connected disposable contexts; mock screenshots never prove live behavior. Focused account, presence and layout
gates were rerun after final assertion/accessibility repairs.

The fixture uses only guarded loopback PostgreSQL port 5434 and random
`scribble_browser_test_*` schemas. Teardown completed; a read-only catalog check
found zero remaining fixture schemas. The previously stopped existing Docker
PostgreSQL container was started for these tests and is left running. No existing
board, image, volume or normal-schema data was changed by the mutation fixtures.

Human acceptance remains pending: run the plan's short script with the user and
3–5 unfamiliar participants; record timings/findability separately from network
wake latency. Test a physical mobile keyboard/IME, actual browser chrome zoom,
screen reader and real Google/clipboard permission flows. Automated layout,
composition and focus checks are evidence for their stated scope only.

Before any release, review hosted CI and Cloudflare Pages deployment settings
separately from Render (auto-deploy OFF), resolve human findings and preserve the
previous frontend deployment/commit for rollback. The user subsequently authorized this UX delivery’s commit and push on
2026-10-06. This commit uses Cloudflare’s `[CF-Pages-Skip]` prefix to omit its Pages
deployment without suppressing GitHub Actions. Deployment and future commits/pushes
still require fresh authorization. This frontend change requires no backend contract,
Neon migration, database reset or image cleanup. No deployment was performed. The implementation session completed locally;
the subsequent commit/push authorization is recorded in the checkpoint. Offsite backups/schedulers/monitoring remain separate follow-ups.

Representative evidence:

- [Guest desktop](ux-evidence/after-guest-1440.png) and
  [guest mobile](ux-evidence/after-guest-390.png).
- [Live account desktop](ux-evidence/after-live-desktop.png) and
  [live account mobile](ux-evidence/after-live-mobile.png).
- [Recovery notice](ux-evidence/after-recovery-mobile.png) and
  [recovery dialog](ux-evidence/after-recovery-dialog.png).
