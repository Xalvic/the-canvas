# UI redesign R7: integrated acceptance and release handoff

2026-10-08 (Asia/Calcutta). **Verified locally; R7 complete.**
Authority: [UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md),
sections 10-13. After requesting a documentation-only handoff, the user explicitly
requested R7 acceptance and a working local server for manual testing. This
record supersedes the earlier handoff-only status. Shared visual tokens and UI
primitives remain the completed R1 implementation.

## Local app ready for manual testing

Open **http://127.0.0.1:5173/scribble/**. The normal frontend, API on port 3001
and existing Docker PostgreSQL on port 5434 are running. The API health endpoint
returns `status:ok`; the signed-out auth response advertises Google sign-in and
link sharing. These services are separate from the disposable acceptance servers.

The startup failure came from missing SQL migration 12: the API probes the new
link tables during startup. Before migrating, an encrypted custom-format
`pg_dump` backup was saved under ignored
`backups/r7-local-1791399833928/` (`database.enc` and `database.key`; retain both).
Authenticated decryption and `pg_restore --list` verified a readable 306,692-byte
archive containing the original 15 tables; no restore was performed. The
[backup check](../ui-redesign-evidence/r7-backup-check.json) and its script retain
the envelope/decryption details without exposing the key or database rows.
A stable random backend-only `SHARE_LINK_KEY` was added to ignored `.env.docker`.
`npm run db:migrate:docker` applied only migration 12. The audit verified all
existing rows, table definitions and earlier ledger entries were preserved;
only three empty link tables and the version-12 ledger entry were added.
Normal local state changed from 15 tables/32 rows to 18 tables/33 rows.

For a later restart, use three terminals from the repository root:

```text
npm run db:start
npm run dev:server:docker
npm run dev -- --host 127.0.0.1 --port 5173
```

The current API was started in a hidden Node process using `.env.docker`;
its logs are ignored `backups/r7-api.stdout.log` and `backups/r7-api.stderr.log`.
Avoid starting another API on port 3001 while this process is running.

## Implemented application and evidence status

| Milestone | Delivered behavior | Evidence status |
| --- | --- | --- |
| R0 | Reviewable visual proposal and placement/token decisions. | Historical local proposal verification; not application behavior. |
| R1 | Shared light/dark tokens, native buttons/fields, focus, menus/dialogs and semantic notices. | Historical focused browser/build/type and visual verification. |
| R2 | Independent title/Share regions, flat sidebar/drawer and account/footer layout. | Historical focused browser/build/type and visual verification. |
| R3 | Compact drawing/history/zoom controls, contextual styles and responsive surfaces. | Historical editor/browser/build/type and visual verification. |
| R4 | Additive link schema, authenticated API and consistent effective access. | Historical 844 fast checks and 176 PostgreSQL checks, including 25 R4 cases. |
| R5 | Direct Share, Link settings, clipboard recovery, Google recipient flow and explicit guest transfer. | Historical 865 fast checks, 15 actual browser/API/DB journeys and 26 editor/layout regressions. |
| R6 | Automatic metadata freshness, cached-error Retry and bounded recovery of original link intents. | Previously user-reported; current R7 fast/browser checks exercise the combined implementation. |
| R7 | Consolidated acceptance and release handoff. | Current fast/DB/browser/API gates, builds/types, visual review, migration and cleanup audits pass. |

R0-R5 counts describe historical gates. Current combined results are recorded
separately below; they are not the sum of earlier milestone counts. The original
[R6 implementation note](ui-redesign-r6.md) retains its historical evidence.

The application imports `ui-tokens.css`, `ui-primitives.css`,
`workspace-shell.css`, `editor-controls.css` and `share-controls.css` through
`src/styles.css`. Menu and Dialog retain native button/modal semantics, keyboard
isolation and focus handling. No additional token/component implementation is
needed to prepare this handoff.

Earlier implementation/evidence records:
[R0](ui-redesign-r0.md), [R1](ui-redesign-r1.md), [R2](ui-redesign-r2.md),
[R3](ui-redesign-r3.md), [R4](ui-redesign-r4.md), [R5](ui-redesign-r5.md),
[R6](ui-redesign-r6.md), [inherited M11](workspace-ux-m11.md).

## Representative current visuals

R7 captures exercise the combined application and use new paths, preserving all
R0-R6/M11 evidence. Desktop/mobile owner and guest views, focus, native fields,
error Retry, safe-area and reduced-viewport layouts have been visually inspected.

| View | Light | Dark |
| --- | --- | --- |
| Owner desktop, 1440x900 | [Current application](../ui-redesign-evidence/r7-standard-owner-1440-light.png) | [Current application](../ui-redesign-evidence/r7-standard-owner-1440-dark.png) |
| Owner mobile, 390x844 | [Current application](../ui-redesign-evidence/r7-standard-owner-390-light.png) | [Current application](../ui-redesign-evidence/r7-standard-owner-390-dark.png) |
| Guest desktop, 1440x900 | [Current application](../ui-redesign-evidence/r7-standard-guest-1440-light.png) | [Current application](../ui-redesign-evidence/r7-standard-guest-1440-dark.png) |
| Guest mobile, 390x844 | [Current application](../ui-redesign-evidence/r7-standard-guest-390-light.png) | [Current application](../ui-redesign-evidence/r7-standard-guest-390-dark.png) |
| Link settings and native focus | [Current settings](../ui-redesign-evidence/r7-r1-sharing-light.png) | [Current settings](../ui-redesign-evidence/r7-r1-sharing-dark.png) |
| Actual API Link settings, desktop | [Current settings](../ui-redesign-evidence/r7-r5-settings-1440-light.png) | [Current settings](../ui-redesign-evidence/r7-r5-settings-1440-dark.png) |
| Actual API Link settings, mobile | [Current settings](../ui-redesign-evidence/r7-r5-settings-390-light.png) | [Current settings](../ui-redesign-evidence/r7-r5-settings-390-dark.png) |

[Link settings error and Retry](../ui-redesign-evidence/r7-r1-sharing-error-dark.png),
[keyboard-panned dialog](../ui-redesign-evidence/r7-standard-keyboard-link-settings.png),
[mobile pending save](../ui-redesign-evidence/r7-standard-pending-mobile.png),
[safe areas](../ui-redesign-evidence/r7-standard-safe-area.png) and
[equivalent 200% layout](../ui-redesign-evidence/r7-standard-zoom-layout.png)
were inspected. Styles use internal scrolling on constrained views; the
automated checks confirm focused controls and Close remain reachable.
No shared token is visible in these captures.
[Separated recovery/share/appearance errors](../ui-redesign-evidence/r7-r5-pending-share-error.png)
and long-account-name [desktop](../ui-redesign-evidence/r7-long-account-1280-dark.png)/
[mobile](../ui-redesign-evidence/r7-long-account-390-light.png) captures were also
inspected after the sidebar fix.

## Final sharing contracts

Source review confirms the implemented paths in `server/shareLinkRoutes.ts`,
their session mount in `server/app.ts`, and the typed client in
`src/api/shareLinks.ts`. These are R4/R5 contracts, not new R7 endpoints.

| Endpoint | Request and result |
| --- | --- |
| `GET /api/boards/:id/share-link` | Owner only. Returns `{settings:{enabled,role,generation,version}}`; does not activate sharing or return a token. |
| `POST /api/boards/:id/share-link/copy` | Owner only. `{requestId,expectedVersion}` enables a fresh generation or reuses the active link. Returns `{settings,token,requestId,replayed}`. |
| `PATCH /api/boards/:id/share-link` | Owner only. `{requestId,expectedVersion,role:"viewer"|"editor"}` or `{requestId,expectedVersion,enabled:false}`. Returns `{settings,requestId,replayed}`. |
| `POST /api/share-links/open` | Signed-in Google account. `{token}` records a current-generation grant and returns `{board}` with its effective role. A direct board ID never creates a grant. |
| `GET /api/auth/me` | Signed-in response advertises `capabilities.shareLinks:1` when the store is enabled; signed-out error details include `shareLinksEnabled:true` when enabled. Missing capability does not authorize an alternative sharing flow. |

Requests retain existing session, origin/CSRF and expected-account checks.
Mutations use JSON and the original UUID/settings version. Unknown outcomes
reuse that exact intent; version conflicts require review and superseded
receipts cannot restore a stopped link. Rate limits retain deliberate retries.
Responses inherit `Cache-Control: no-store`.

The URL is the app origin plus Vite `BASE_URL`, with
`#share=<43-character base64url token>`. The fragment is consumed by the existing
tab-scoped navigation flow; the secret must not enter Google redirect parameters,
normal list metadata, logs or screenshots. Signed-out recipients cannot read
protected drawing/title/image/presence data.

Effective access is owner first, otherwise the greater permission from explicit
membership and an enabled matching-generation link grant. Current link role
applies to grants dynamically. Stop disables link access; another Share creates
a new generation and old links/grants stay invalid. Independent memberships and
legacy invitation acceptance retain their existing behavior.

Free guest IndexedDB editing, Google-only authentication, explicit transfer and
image consent remain intact. Document schema version 1 and IndexedDB version 4
are unchanged. Existing workspace, creation/upload receipts, recovery journals,
collaboration and selective undo contracts remain documented in
[M11](workspace-ux-m11.md). This is not a full-project API inventory.

## Schema, configuration and release sequence

Migration [012_create_board_share_links.sql](../db/012_create_board_share_links.sql)
adds `board_share_links`, `board_share_link_grants` and
`board_share_link_receipts`. SQL is the migration authority;
`server/migrations.ts` registers version 12 and Prisma maps the tables. There
is no new R7 migration, backfill, document format or storage-key change. Existing
pages start without link rows and their settings default to disabled/viewer.

`SHARE_LINK_KEY` must be a backend-only 64-character hexadecimal key representing
32 random bytes, stable across restarts and API replicas. Keep it in ignored
local/provider configuration and secured backup, never in a `VITE_` variable or
chat. Missing key disables the link store/capability; malformed configuration
fails startup. Store token digests and authenticated ciphertext, not plaintext.

R7 applied migration 12 and configured the stable key in the normal local Docker
environment, as authorized by the request to start the local app. See the
[migration preservation audit](../ui-redesign-evidence/r7-local-migration.json).
Acceptance mutations use disposable random schemas and fixture identities/keys;
the normal database is independently audited before and after acceptance.
Production migration and key configuration have not been checked or changed.

Release remains a separate authorized action:

1. Review the R7 acceptance record and full pending delivery, then confirm
   the actual target database/migration ledger and hosting state. Capture a new
   before-state and a recoverable encrypted backup without replacing old evidence.
2. Apply outstanding additive SQL, including version 12, using the existing SQL
   runner (`npm run db:migrate` in the deliberately configured target environment).
   Compare existing rows/schema and retain all recovery/receipt data. Prisma
   generation does not apply SQL.
3. Configure the stable backend key and deploy the compatible backend. Verify
   readiness, Google/account boundaries and link capability; missing migration
   must not be treated as a working link configuration.
4. Deploy the frontend with its correct app base path. Verify direct Share,
   recipient sign-in, viewer/editor permissions, Stop, retry and guest drawing
   against the released backend, using controlled accounts/pages.

Only normal-local migration/key configuration and development service startup
were performed. No provider change, production SQL, commit, push or deployment
occurred. Prior release authorization does not authorize this delivery.

## Mixed versions and rollback

| Combination | Expected behavior |
| --- | --- |
| New frontend, backend without link capability | Show sharing unavailable; do not fabricate a copied link or fall back to guest upload/email invitation creation. Guest local drawing remains available. |
| Older frontend, compatible new backend | Existing explicit membership/invitation flows remain supported; older UI does not gain the new direct Share controls. |
| Backend rollback to code predating link grants | Link capability disappears and link-granted access closes; independent explicit membership remains. Keep additive link/grant/receipt tables. |
| Frontend rollback | Preserve document compatibility and an M8-aware IndexedDB v4 parser/opener for pending drafts, uploads and title intents. Do not reset journals or assets. |

Key loss/replacement can prevent copying an existing encrypted link. With a
replacement key configured, the owner can Stop and then Share to create a fresh
generation; without a key, link endpoints are unavailable. No automatic key
rotation is implemented. Already downloaded content cannot be recalled;
previously issued ImageKit signed URLs last 300 seconds. Live access/session
checks use the existing SSE mechanism (default one-second recheck).

## Current integrated acceptance and commands

These are fresh R7 results against the combined checkout. All current standard
specs ran. Three opt-in pre-redesign proposal/baseline cases are skipped; current
wake/tab tests cover the inherited writer-recovery behavior. The separate
production-only pen spec is not part of the local gate.

| Gate | Result | Evidence |
| --- | --- | --- |
| Fast unit/API checks | 868 passed; 176 PostgreSQL checks skipped here and run separately. | [Fast JSON](../ui-redesign-evidence/r7-fast-results.json) |
| PostgreSQL gate | 176 passed, zero failures; bounded to two workers. | [Database JSON](../ui-redesign-evidence/r7-database-results.json) |
| Standard browser gate | 108 passed, three historical baseline skips, zero failures. | [Browser JSON](../ui-redesign-evidence/r7-standard-results.json) |
| Actual API/browser/database gate | 87 distinct cases passed across the full run and focused fixture rechecks; zero remaining failed/unrun cases. | [Combined case audit](../ui-redesign-evidence/r7-integration-summary.json) |
| Frontend and backend builds | Both passed. Existing bundle-size/Zod annotation warnings are nonblocking. | `npm run build`; `npm run build:server` |
| Browser fixture/config and deployment types | Passed. | `r7-typecheck.json`; `deployment/tsconfig.json` |
| Prisma schema | Valid. | `npm run db:validate` |
| Normal-local migration | Additive version 12 verified; existing data preserved. | [Migration audit](../ui-redesign-evidence/r7-local-migration.json) |
| Post-acceptance normal DB and fixture cleanup | Unchanged 18 tables/33 rows, ledger 12; zero disposable schemas/specs and no listeners on 4173/4174/4301. | [Isolation audit](../ui-redesign-evidence/r7-database-isolation.json) |

The complete integration run passed 63 of 87 cases and exposed 24 outdated or
timing-sensitive fixture expectations. The focused recheck passed 23 of those
24; its remaining failure was an invalid fixture-provider failure count. After
correcting the image fixture, the final single-case rerun passed. The application
was unchanged across these runs; only fixture assertions/timing were corrected.
The combined audit maps every original case ID to its latest executed result and
rejects missing/failed cases or non-test runner errors. This is **87 verified
cases across runs**, not a claim that the initial full run passed.

Raw reports: [full run](../ui-redesign-evidence/r7-integration-results.json),
[24-case recheck](../ui-redesign-evidence/r7-integration-recheck-results.json),
[final image check](../ui-redesign-evidence/r7-integration-final-results.json).

Local commands used (repository root, PowerShell):

```text
node --env-file=.env.docker ui-redesign-evidence/r7-database-audit.mjs before-migration
node ui-redesign-evidence/r7-backup-check.mjs
npm run db:migrate:docker
node --env-file=.env.docker ui-redesign-evidence/r7-database-audit.mjs after-migration
node ui-redesign-evidence/r7-preservation.mjs before
node --env-file=.env.docker ui-redesign-evidence/r7-database-audit.mjs before
node ui-redesign-evidence/r7-gates.mjs fast
node --env-file=.env.docker ui-redesign-evidence/r7-gates.mjs database
node ui-redesign-evidence/r7-browser.mjs standard
node ui-redesign-evidence/r7-browser.mjs integration
$env:SCRIBBLE_R7_REPORT_FILE = 'r7-integration-recheck-results.json'
node ui-redesign-evidence/r7-browser.mjs integration --last-failed
$env:SCRIBBLE_R7_REPORT_FILE = 'r7-integration-final-results.json'
node ui-redesign-evidence/r7-browser.mjs integration --last-failed
# Optional cleanup when replaying in one terminal:
Remove-Item Env:SCRIBBLE_R7_REPORT_FILE
node ui-redesign-evidence/r7-integration-summary.mjs
npm run build
npm run build:server
npx tsc -p ui-redesign-evidence/r7-typecheck.json
npx tsc -p deployment/tsconfig.json
npm run db:validate
node --env-file=.env.docker ui-redesign-evidence/r7-database-audit.mjs after
node ui-redesign-evidence/r7-preservation.mjs after
git -c core.safecrlf=false diff --check
```

The report variable was scoped to each command's PowerShell process; the remove
line is for replaying those commands in one terminal. The raw recheck report
retains its preparatory failure rather than overwriting it with the final pass.
Baseline commands create files exclusively and refuse to overwrite an existing
baseline.
For a later acceptance session, use fresh evidence paths and a fresh before-state;
do not delete these baselines or treat them as the new session's initial data.

R7 browser runners make temporary spec copies beside their originals to retain
relative imports, redirect only screenshot/output paths to R7, then remove those
exact copies in `finally`. The integration fixture enables link sharing with an
ephemeral key and its existing disposable random SQL schema. Missing-capability
and legacy invitation/membership behavior remain explicit compatibility cases.
Screenshots/traces on failure are disabled to avoid accidental token captures;
deliberate UI captures contain no shared token. Mutation cases never use the
normal API on port 3001.

Preparatory runs exposed stale save-indicator text, the former Reset viewport
button and sharing/email forms, plus missing DOM globals in the R6 action tests.
These were corrected to current accessible labels and direct Share/settings/
retained-access flows. Meaningful R6 checks cover cached errors, stale focus and
sidebar reads, hidden/offline polling, reconnect, original-intent replay, bounded
recovery, disposal and clipboard isolation. The image fixture retains one real
failed reservation by blocking later browser upload attempts until reload, then
verifies the same persisted asset. Repeated provider failure beyond the server's
attempt limit correctly requires explicit attention and is not used to assert
automatic reload recovery. UI error captures flush pending local saves before
injecting the presentation state, so a previous
successful write cannot clear it.
An initial DB run had four migration-lock timeouts under default concurrency;
limiting the final gate to two workers produced a clean 176-check pass. A
preparatory browser run was stopped after identifying systematic stale fixtures;
only its owned process tree/disposable schema were cleaned up.

Acceptance also found and fixed an application layout defect: long account names
expanded the sidebar footer's implicit grid sizing and intercepted zoom clicks.
`src/workspace-shell.css` now allows the account slot/name to shrink and truncate.
The fresh-device image and cross-board copy flows pass after the fix; a regression
checks both themes at 1280, 1440, 1101 and 390px, account-menu focus, clickable zoom
and unchanged drawing/history. Final standard/browser gates include this fix.

The standard gate covers both themes at 1440x900, 1024x768, 768px, 390x844,
320px and short landscape, plus safe areas, simulated keyboard-panned visual
viewport, equivalent 200% layout, focus/restoration, contrast and touch targets.
It also verifies guest/owner/editor/viewer navigation, pointer/shortcut
isolation, pan/zoom coordinates, drag/resize/text, atomic history, IndexedDB,
consented transfer, tab recovery and background editor/history isolation.

Physical keyboard/IME/pen, screen-reader interaction, actual browser zoom,
sleep/wake and live Google/ImageKit acceptance remain separate pending human/
provider checks. Simulated identities, viewport changes and fixtures do not
replace these checks.

## This session's changes and review

R7 adds acceptance runners/configuration, report/capture paths, database and
inherited-work audits, new freshness/link-recovery checks and current-UI fixture
updates. The sole application-code change is the long-account-name sidebar fix
in `src/workspace-shell.css`. This note and the active plan record current
results. The earlier R6
verification addendum remains a historical record. Learning documents are
unchanged. Local `.env.docker`, encrypted backup and service logs are ignored.

Final integration, data-preservation, fixture cleanup, link validation and diff
review pass. The [inherited-work audit](../ui-redesign-evidence/r7-preservation.json)
contains no unexpected changes/additions; historical evidence and unrelated
pending work remain intact. The normal frontend/API/database are healthy and
left running for user testing. No acceptance server or disposable spec remains.

Next: complete the physical/provider checks above, review the delivery and decide
whether to commit; production release remains separately authorized. No commit,
push or deployment was performed. Stop after R7.
