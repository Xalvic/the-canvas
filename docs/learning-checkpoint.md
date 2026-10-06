# Scribble: resume here

Updated: 2026-10-06. Read once per new project session.

## Current handoff

Workspace UX **M0-M3 are verified locally** on 2026-10-06. Status authority and next
session instructions: `WORKSPACE_UX_IMPLEMENTATION_PLAN.md`, sections 6 and 9.
Next: **M4 only**, workspace state/initialization APIs. M3 contracts and commands:
`docs/workspace-ux-m3.md`. POST /api/boards adds actor/request receipts and an atomic
blank document at revision 1; legacy {title} creation remains unchanged. Replay
confirms original creation without resetting current title/content. Fresh document
reads precede recovered editing; 90-day expiry/deletion return terminal 410 and
retained identities prevent recreation. Typed createServerPage leaves stable intent
persistence to M6/M7. Current UI still uses the legacy path.
Migration 9 was applied only to disposable schemas; next unused number is 10.
Verified 120 focused HTTP/client cases, 83 real PostgreSQL checks including actual
API process restarts, SQL/Prisma no-drift, both builds and targeted typechecks.
All 12 normal public tables/14 rows have unchanged fingerprints; zero disposable
schemas remain. Docker 5434 is left running. M0-M3 changes are included in the
user-authorized local commit; M2's IndexedDB v4 journals/guest handoff contract is in
`docs/workspace-ux-m2.md`. Retain its v4-capable opener on rollback; physical
sleep/native IME remain M11. M4 initialization must reuse the actor-row lock in one
transaction. User authorized committing all current updates on 2026-10-06;
future commits need fresh approval. No normal/production migration, push,
provider change or deployment. Stop after the selected milestone and save its
handoff.

## Previous pen handoff

Pen drawing update is implemented locally on 2026-10-06. Guide and validation:
`docs/pen-drawing-validation.md`. The root `PEN_DRAWING_UPDATE_PLAN.md` is still
ignored/untracked and records progress. Single pointer ownership, provisional
touch pinch, pen preference, interrupted ink preservation, versioned
perfect-freehand geometry, calibrated mouse/touch/pen profiles, stationary force,
exact endpoints, actual low-zoom pixel widths, theme paint and conservative
culling/bounded caching are implemented. Legacy ink stays on its original renderer;
IndexedDB keys/schema and atomic history stay unchanged. Shared cloud validation
accepts the optional new fields; no SQL migration or deployment was performed.
599 fast tests and the standard browser regressions pass; production DPR/browser
visuals and desktop replay are documented. Physical Redmi tracing, touch-policy
tuning, real pressure hardware and tablet/120 Hz performance remain pending.
User confirmed the reported failure happened on the deployed HTTPS URL with the
palm off-screen; do not claim palm interference caused it. Next: physical acceptance
and coordinated API/frontend release after authorization. User authorized this pen
update's local commit on 2026-10-06. Push/deployment and future commits still require
fresh authorization.

## Previous UX handoff

Current focus: UI/UX simplification implementation completed locally through phases
0–4; phase 5 local regression checks passed. Read `docs/ux-simplification-plan.md`
and `docs/ux-validation.md`. `docs/ux-wireframe.html` remains a fake-data clickable
proposal, not application behavior.

Implemented: compact board header, separate truthful device/account/access/live
status, account dialog with bounded checks, board drawer with loaded-list search and
My boards / Shared with me / Invitations, explicit account-copy/image confirmation
and progress, focused owner sharing, manual clipboard fallback, Google-redirect
invitation intent without auto-accept, keyboard-accessible collaborator names,
recovery details/confirmed replacement,
device-save retry, responsive layouts, modal keyboard/focus isolation and Help.
One mounted account session/cursor lifetime remains; local IndexedDB, permissions,
SSE, selective undo, cross-tab leases and existing durable boundaries are preserved.
Sign-in still uploads nothing. No new API/database contract or dependency was added.

Human usability/timings, screen-reader, physical soft keyboard/IME and actual browser
chrome zoom checks are pending. Automated reduced-viewport/IME and equivalent 200%
layout checks are recorded separately. Metadata copy creation still lacks an
idempotency receipt: on an unknown creation response, inspect My boards before
creating another copy; no silent replay is advertised. Completed image mappings and
known destination document operations reuse the existing recovery paths.

Local evidence: 582 fast tests, 49 standard browser cases and 17 actual API/DB
scenarios passed; build, integration-fixture typecheck and diff validation passed.
Zero disposable browser fixture schemas remain. Desktop/mobile live SSE screenshots
are in `docs/ux-evidence/`. The existing Docker PostgreSQL container was started for
tests and is left running. No production/provider mutations were made.

Next: human acceptance using the saved task script and controlled release.
The user authorized this UX delivery’s commit and push on 2026-10-06. This
commit uses `[CF-Pages-Skip]` to omit the Cloudflare Pages deployment while
GitHub CI remains enabled. Deployment still needs fresh authorization; review
Pages settings separately. Render auto-deploy remains OFF. Existing user data
and offsite-backup/monitoring follow-ups are preserved. Free tiers, Google-only auth,
PWA/Postman exclusions remain.
Deployment update (user-reported, 2026-10-06): frontend is Cloudflare Pages
`the-canvas-c3o.pages.dev`, served at `https://milanputhukkudy.com/scribble/` by
dashboard Worker `scribble-router`. The updated Worker forwards `/api/*`, `/health`
and `/ready` to Render Free `https://scribble-api-003m.onrender.com`. Render
auto-deploy is OFF; Pages deployment is independent. Neon Free project
`muddy-shadow-82970904`, production branch, database `scribble` is configured and
SQL migrations succeeded. Production Google callback was registered. The user
verified readiness, Google sign-in/cloud APIs and two-account live collaboration.
These are user-reported live results; this UX session uses local disposable fixtures.
Encrypted offsite backups, active schedulers/monitoring, remaining deployed failure
checks and hosted CI review are still follow-ups. Stay on free tiers. PWA/Postman
remain out of scope. Commit `d5bf489` and the two preceding commits were pushed to
main after explicit authorization; future commits/pushes/deployments need fresh
authorization. The original 2026-10-06 request authorized local UX implementation and validation;
the follow-up authorized this delivery’s commit and push. Future commits/pushes
and any deployment require fresh authorization. Keep secrets in ignored local/provider settings.

## Previous local implementation handoff (2026-10-05)

Active implementation queue (2026-10-05): frontend cloud images are implemented
and locally verified with six actual browser/API/Prisma/PostgreSQL scenarios,
controlled provider bytes/signatures and zero leftover schemas. Explicit uploads
persist completed local→cloud mappings outside undo; copied cloud images upload
new destination assets. Signed URLs stay in memory, refresh and clear on auth
changes. Completed assets are retained for saved boards, offline recovery drafts
and undo; cleanup targets unfinished uploads only. Signing limit is 1,500/hour
per user with the existing global monthly byte budget. No existing data/images
were deleted. Guide: `docs/cloud-images.md`.

Real-time collaboration is implemented: atomic object CAS operations, durable
retry receipts (migration 7), authorized SSE revision hints and presence, client
merging and selective undo. All 12 real browser/API/DB image and collaboration
scenarios pass, including two browsers, reconnect, conflicts, lost responses and
access changes. Migration 7 is applied to normal Docker PostgreSQL on 5434;
fingerprints confirmed nine existing tables and six rows unchanged. The API
container passed 36 persistence checks across actual API/database restarts and
container recreation in a disposable stack; normal volumes and 5433 were untouched.

Scope change (2026-10-05): the user cancelled PWA installation/offline app loading
and Postman tooling/collection maintenance. PWA additions and local Postman
directories are removed; do not recreate them or update the cloud collection.
Historical collection results below are prior verification only. A consolidated
API list can wait until project completion. Cross-tab local save protection is
implemented and passes three real two-tab browser/API/DB scenarios, atomic lease
tests and a board/image-preserving IndexedDB upgrade. Production preparation is written:
Worker proxy/HTTPS Compose, CI and systemd templates, production auth/TLS/origin
guards, durable rate budgets and readiness/privacy-safe logs. Migration 8 is
applied to Docker 5434 with ten prior tables/six rows unchanged; Prisma has no
drift. Encrypted backup restore passed 15 checks across all 12 populated tables;
Caddy error-log privacy passed six real checks. Nothing is deployed; Neon, origin
host and the existing external Worker integration still need configuration.
Final local checks: 579 fast tests, 95 real PostgreSQL checks, 41 standard browser
cases and 16 actual browser/API/DB cases verified; both builds, deployment/fixture
typechecks, CI YAML/pinned-action checks and diff validation pass. Focused reruns
repaired old async-switch/favicon/ledger assertions and one new sharing selector.
Zero fixture schemas or disposable resources remain. No existing image or board
data was deleted. Guides: `docs/local-reliability.md`, `docs/collaboration.md`,
`docs/production.md`, `docs/backups.md`.
Next: choose the API hosting provider/HTTPS hostname, fill ignored `.env.production`
locally using `production.env.example` (Neon pooled/direct URLs, Google OAuth and
ImageKit settings, shared Worker/backend proxy secret), and provide the existing
external Worker source location for review. Configure offsite encrypted backup
storage/notifications and keep the key separate. Do not ask for secrets in chat.
Deployment and hosted checks require separate approval after configuration review.
User authorized these
task-related commands/edits/installs/local Docker/disposable assets and focused
subagents in the pasted request. The user explicitly authorized committing and
pushing this completed change set on 2026-10-05. Future commits/pushes need fresh
authorization; publishing/deployment remains pending separate approval.

## Prior completed backend/sharing handoff

Prisma is committed as `c092b74`. Sharing/roles and the backend cloud-image
milestone are implemented and included in the combined commit authorized on
2026-10-05; check `git log` for its revision. Future commits need fresh approval;
no push or deployment is authorized. Sharing supports seven-day Google-email invitations,
explicit acceptance/decline and owner-managed roles/removal/cancellation. Owners
manage sharing/deletion; editors edit/rename; viewers read only. Invite links are
copied by the owner; no email delivery service. Guide: `docs/sharing.md`.
Viewer canvas mutations are blocked; focus/30-second access checks preserve
local drafts after downgrade/revocation. Permission is never trusted from disk.

ImageKit backend configuration, private immutable storage, validated binary
uploads and board-scoped five-minute signed reads are implemented. Owners/editors
upload; owners/editors/viewers read with current-access checks. JPEG/PNG/WebP
are fully decoded and normalized; SVG/GIF/animation are rejected for cloud
uploads. Limits: 5 MiB, 4096 per dimension, 16 million pixels; bounded concurrency,
upload rates/storage and persistent signed-URL issuance budgets. Backend version-1
documents accept completed same-board UUID image references; revision conflicts,
permission locks and transaction rollback remain intact. Frontend cloud-image
integration is still pending: browser adapters continue rejecting cloud images.

SQL migration 6 adds asset metadata/budgets and Prisma maps them. Migrations 1–6
are applied to Docker PostgreSQL on 5434; all pre-existing rows, columns,
constraints and indexes fingerprint unchanged and Prisma reports no drift.
Portable PostgreSQL on 5433 is untouched. SQL remains the migration authority.
Saved-once assets are retained indefinitely, including after removal/board
deletion. Never-saved uploads become cleanup candidates after 24 hours; the
explicit cleanup command releases quota only after confirmed provider deletion
or absence. Failed/uncertain uploads retain their reservations and exact paths.
Guide and operational limits: `docs/cloud-images.md`.

Backend ImageKit variables are configured locally in ignored `.env.docker`.
The actual restricted key passed upload/read/delete/signing checks; signed URLs
returned 200, unsigned/expired URLs 401. A separate real HTTP/Prisma/PostgreSQL/
ImageKit proof verified owner/editor uploads, viewer read/denial, image save/read
and revocation in an isolated schema. All disposable ImageKit files were deleted;
the existing uploaded image was preserved. The active subscription screen has
not been independently verified. No paid-plan change or upgrade was requested.

Verification: 438 fast tests, 76 isolated-schema PostgreSQL tests, server
typecheck, both builds and Prisma comparison passed. Postman verification is
138 requests / 466 assertions with a clean fetched-back mirror; details are
recorded in `docs/implementation-status.md`. Browser tests were not rerun for
this backend-only slice; previous sharing checks covered 41 scenarios with
mocked account HTTP. Manual sharing between two actual Google accounts remains
unverified. Live Google sign-in/reload/sign-out and account save/open were
user-verified on 2026-10-04. Next: frontend image upload/recovery, cloud asset
references and signed-image refresh. API/Neon deployment, PWA loading and
real-time collaboration remain pending. Guest IndexedDB stays free and separate;
login never uploads a board. Google-only authentication remains the choice.
The frontend is already deployed through a Cloudflare Worker at
`https://milanputhukkudy.com/scribble/`; Express/PostgreSQL remain local.

## Implementation record

Learn through small Scribble slices; general study/DSA remain separate.

Covered: Phase 1 backend/HTTP foundations, Node/Express/TypeScript, Zod versus
JSON parsing, errors, and temporary storage.
SQL reading, filters, sorting, and limits introduced on the existing board table;
controlled write practice and transactions remain.

Implemented: local health and metadata CRUD backed by PostgreSQL; Map is only
an HTTP-test fixture. Guest canvas still saves independently in IndexedDB.
Portable PostgreSQL 18.6 is initialized in ignored `.postgres/`, port 5433,
credentials in ignored `.env`; no Windows autostart. Check status after reboot.
Run guide: `docs/postgresql.md`. Implementation committed as `156afec`; no push.

Verified: 109 fast tests, four real DB tests, typecheck, both builds, 17 Postman
requests / 51 assertions, and actual API/database restarts. No Prisma or cloud
canvas storage yet.

Product: free guest IndexedDB use; optional login for cloud/cross-device saves.
Keep local editing and explicit guest-upload choice. PWA manifest/offline loading
are pending.

Docker: WSL 2 and Docker Desktop installed; Linux engine 29.8.1 and Compose
5.5.1 verified running. CLI is installed per-user under
`%LOCALAPPDATA%/Programs/DockerDesktop/resources/bin`; reopen terminals if PATH
is stale. Images, containers, volumes, and host/container ports introduced.
PostgreSQL-only `compose.yaml` prepared and config validation passed: official
18.6-bookworm image, loopback port 5434, persistent volume, readiness check,
and initialization SQL for a normal app role. Separate generated credentials
are in ignored `.env.docker`; portable `.env` is unchanged. Guide: `docs/docker.md`.
Image downloaded and container started with approval; healthy on port 5434.
Authenticated Windows app connection verified PostgreSQL 18.6 and the normal
`scribble` role; named volume mounted. Existing migration applied with approval
using a process-scoped Docker connection. Verified both tables, all four board
columns and migration version 1. Express connected with approval through new
`npm run dev:server:docker` (loads `.env.docker`); API port 3001, Docker DB port 5434.
Added Docker-specific migration and database-test commands. Four real DB tests
passed; HTTP POST/GET and direct Docker SQL matched `Docker connection demo`.
Demo board remains for inspection. Actual database-process restart testing is pending.
Portable `.env`, database, and records are preserved; no data import.
Frontend slice: React now reads `GET /api/boards` through the existing Vite proxy.
`src/api/boards.ts` fetches and validates id/title metadata; `ServerBoards` renders
a collapsible, read-only title list with loading/empty/error and Refresh/Retry.
The effect aborts stale requests on cleanup. It sits beside the canvas in App,
without changing guest stores or adding server-board opening/saving behavior.
Build passed. Browser verified real demo title, refresh, mocked empty/HTTP/network/
malformed responses, retry, responsive layout, keyboard isolation, and guest
IndexedDB note persistence after autosave/reload. TanStack Query is not added yet.
This chat needed Docker's bin directory added to the process PATH for its
credential helper; no permanent PATH change.

Storage design: proposed relational `boards` metadata plus one JSONB document
per board in `board_documents`. Use an ordered object array for transport and
adapt to/from the editor map; preserve guest IndexedDB format. Separate document
schema version from save revision; use atomic revision checks, committed snapshots,
and separate durable assets. First local proof excludes images until asset storage
exists. Migration and local document API are now implemented; cloud UI/upload is
still proposed.
Detailed comparison, fields, save/conflict flow, and verification sequence:
`docs/canvas-document-storage.md`.

Implemented storage slice: strict version-1 validator and detached ordered-array/
editor-map adapters, all five non-image types, legacy rendering defaults,
duplicate/reference/unknown-field checks and explicit image rejection. No app
wiring or guest-format/store changes. Verified 117 targeted tests (103 new),
frontend build/type checks and server type check. Details and inspection path:
`docs/canvas-document-storage.md`, implemented validator/adapters section.

Migration slice: added `db/002_create_board_documents.sql` and an ordered,
transactional runner for versions 1/2; migration 1 is unchanged. Covered primary/
foreign keys, cascade, format versus save counters, JSONB shape/NULL checks,
timestamp defaults, and migration rollback. Verified 11 real Docker DB tests in
isolated schemas, server type check/build. Applied to normal Docker DB on port
5434: ledger 1/2, five columns/constraints, zero documents; existing board metadata
unchanged. Portable DB not migrated. Walkthrough: storage design doc.

Document API slice: implemented GET/PUT /api/boards/:id/document using pg and one
shared strict schema. Covered parent-row locks, conditional insert/update,
expectedRevision conflicts, and atomic document/metadata timestamps. Rejects
images, invalid formats/content, and JSONB-incompatible strings; separate 1 MiB
document parser preserves 16 KiB metadata limits. Guest stores/UI are unchanged.
Verified 236 fast tests, 25 real Docker DB tests, server type check and both builds;
published Scribble API collection passed 40 requests/127 assertions. An actual
API restart retained all five object types, order, revision, and timestamps.
Temporary proof boards removed; original Docker demo metadata unchanged.
Migration and endpoint slices are included in the authorized end-of-day delivery.

Google-only authentication slice: implemented backend OAuth code flow with
state/nonce/PKCE, verified ID tokens, users and hashed PostgreSQL sessions, me/
logout, and optional React account UI. Migration 3 applied to normal Docker DB;
portable DB unchanged. Guest login navigation waits for existing IndexedDB saves.
Verified 279 fast checks, 34 DB checks, three browser scenarios, server type check
and both builds. Live Google login remains pending OAuth web-client credentials;
none are configured locally. Setup/inspection: docs/authentication.md.
Published Scribble API collection passed 46 requests/145 assertions.
Current preference: implementation only for now; Google sign-in only, no passwords.

Ownership slice (2026-10-04): session-required board/document routes, database
owner filters, mutation origin/header checks, migration 4 and account-aware list.
Verified 297 fast tests, 39 Docker DB tests, four private-list browser scenarios
plus three account scenarios, server typecheck, both builds and the verified
cloud Postman copy (69 requests / 228 assertions). Existing Postman IDs/scripts
and normal Docker demo preserved. Guest IndexedDB is unchanged; unowned legacy
rows are hidden, never claimed.

Live Google verification (2026-10-04): credentials configured locally; the user
verified real Chrome sign-in, persistence after reload, and sign-out. Configuration
presence and matching callback/frontend URLs checked without exposing secrets.
No auth code changed and no credentials are committed.

Account board save/open milestone (2026-10-04): explicit upload and new/open/
rename/delete controls use the existing protected APIs. Committed edits autosave
serially with expected revisions; failures retain local drafts, and uncertain
saves reconcile the submitted snapshot before retry. Conflicts never overwrite
automatically. Reload preserves a recoverable previous draft; save-as-new creates
a separate board. Guest `current-board` storage/schema remain compatible, with
owner/board-scoped account drafts and save markers added to the existing store.
Opening resets selection/history and restores a local viewport. Logout/expiry
preserve account edits before returning to the guest board. Image uploads are
rejected before creation; locally inserted images remain recoverable in drafts.
On mobile, choosing a canvas tool collapses the board panel to keep drawing clear.
Verified 360 fast tests, 39 real Docker DB checks in isolated schemas, 32 browser
checks (including 12 new account scenarios), frontend/server typechecks and both
builds. Account browser HTTP responses are mocked; the existing actual DB/API
contracts passed separately. The user has now confirmed completed live Google
account save/open verification. This milestone is committed as `7449241`.
No API/schema/dependency changes or Postman update were needed for that milestone.

TanStack Query milestone (2026-10-04, implementation only): added
`@tanstack/react-query` v5 and one app QueryClient/provider. Metadata lists use
30-second freshness, five-minute inactive caching, one bounded retry for network/
5xx errors, retained cached titles on refresh failure, and explicit Refresh/Retry.
Stale focus and reconnect refresh only server snapshots. Documents are cached
but always read freshly before open, reload or pending-save reconciliation.
The existing queue executes mutations through MutationObserver with retries
disabled and prompt offline failure; accepted responses update/invalidate owner
caches and cancel older reads. Auth transitions cancel/remove private queries
and mutation records; late responses cannot restore them. Guest persistence,
explicit uploads, local draft recovery, revision safety and Zustand editor state
are preserved. No endpoint/schema changes or Postman update were needed.
Verified 382 fast tests (22 new query cases), 39 real Docker DB checks in isolated
schemas, 37 browser scenarios (five new refresh/recovery cases), server typecheck
and both production builds. Browser HTTP remains mocked; live Google save/open
is recorded as user-verified, not an automated real browser/API/DB proof.

Prisma milestone (2026-10-05): integrated and verified; see the current handoff
and `docs/prisma.md`. Review Prisma, then sharing and roles. Other implementation
items are in `docs/implementation-status.md`; keep SQL as the only migration
authority. Private board/document access is enforced.
Ask permission to verify actual database-process restart persistence;
ask separately before importing portable data. React/Express stay
on npm initially. Ask before file edits, execution, installation, switching or
stopping databases. Preserve portable data/credentials until a switch is approved.
An unanswered question is not permission. Prior updates committed as `c2ca442`.
Commit future changes only after explicit user authorization, separately for each
commit. The user prefers reviewing implementation before authorizing a commit.
Another session may create a root Markdown file; leave unrelated work untouched.
Phase 2: Prisma, document modeling and the local API proof are implemented.
Phase 3: Google-only auth implemented; live login/reload/logout user-verified.
Phase 4: ownership and sharing/roles are implemented; manual two-account verification remains.
Phase 6: backend ImageKit assets implemented; frontend integration and deployment remain pending.

Milestone summaries only, no Q&A logging. Guide: `learning-plan.md`; progress: `learning-progress.md`.
