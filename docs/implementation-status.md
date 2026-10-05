# Scribble implementation status

Updated: 2026-10-05. Implementation only; lesson topics are excluded.

## Completed milestones

- Backend cloud-image assets: ImageKit private immutable uploads, validated static
  JPEG/PNG/WebP, board-scoped access and five-minute signed reads; SQL migration 6
  and Prisma asset/budget mappings. Ready same-board image references participate
  in revision-checked saves. Failed saves roll retention back; upload failures
  preserve reservations for delayed cleanup. Saved-once files are retained
  indefinitely, including after image removal or board deletion. Never-saved
  assets become cleanup candidates after 24 hours; provider deletion/absence must
  be confirmed before releasing quota. Guide: [cloud-images.md](cloud-images.md).
- Migration 6 applied to Docker PostgreSQL on 5434; pre-existing row, column,
  constraint and index fingerprints unchanged. Prisma reports no drift. Portable
  PostgreSQL is unchanged. Provider credentials remain backend-only in ignored
  `.env.docker`. The restricted key actually passed upload/read/delete/signing;
  signed delivery returned 200, unsigned and expired delivery 401. No subscription
  change; the active free-plan dashboard remains independently unverified.

Backend asset validation: 438 fast tests, 76 isolated-schema PostgreSQL tests,
server typecheck and both builds passed. Tests cover permission downgrade/
revocation, invalid uploads, pending/missing/cross-board references, concurrent
quota/signing limits, cleanup/save races and forced save rollback. A separate
real HTTP/Prisma/PostgreSQL/ImageKit proof passed owner/editor uploads, viewer
read/upload denial, image save/read and revocation; its two files were deleted.
Provider adapter proofs used five tiny disposable files, all deleted; the
existing user image was preserved. Frontend browser tests were not rerun here.
The maintained cloud Scribble API collection passes 138 requests / 466
assertions against the real Express/Prisma/PostgreSQL paths with fake provider
storage in an isolated schema. Its fetched-back v3 mirror lints 138 requests
without issues. All 208 pre-existing folder/request/example IDs and 100 unrelated
request/script/example payloads are preserved. Compiled startup/health and
private-asset route checks passed; built frontend files contain no backend secrets.

- Sharing and roles: explicit Google-email invitations, acceptance/decline,
  owner-managed role changes/removal and pending-invite cancellation. Owners
  alone manage sharing/deletion; editors edit/rename; viewers read. Links are
  copied by the owner; no email service. Shared boards include the caller role.
- SQL migration 5 applied to Docker PostgreSQL and mapped in Prisma. All original
  rows, constraints and indexes match their pre-migration fingerprints; no
  existing users were granted access and portable PostgreSQL is unchanged.
- Permission changes and saves use the same parent lock, rechecking access before
  revision disclosure or writes. Viewer canvas guards cover creation, keyboard,
  paste, editing, drag/resize, title and undo/redo. Focus/30-second access checks
  preserve drafts; opening as viewer backs up old editable drafts. See
  [sharing.md](sharing.md). Prisma committed as `c092b74`; sharing and backend
  assets are included in the combined commit authorized on 2026-10-05.

Sharing validation: 386 fast tests, 57 isolated-schema real PostgreSQL tests,
41 browser scenarios across full/targeted runs, typechecks, both builds and
Prisma schema equality. The API collection verifies 101 requests / 325 assertions
against the compiled API with temporary accounts/schemas; its v3 mirror lints
101 requests without issues. The fetched-back cloud copy passes the same run;
all existing request/example IDs and tests are preserved. Browser account APIs
remain mocked; two real Google
accounts have not manually exercised the new sharing flow.

- Prisma Client 7.10.0 against the existing PostgreSQL schema. Typed model
  queries handle routine board/auth operations; parameterized SQL inside Prisma
  retains locks, revision checks, database-clock expiry and exact timestamps.
  One client reuses the existing bounded pool. SQL migrations remain the only
  schema-change authority, with no new migration or data rewrite. Client
  generation, schema validation and read-only drift checks are documented in
  [prisma.md](prisma.md). Normal data/constraints/index fingerprints match.

- TanStack Query v5 for owner-scoped account metadata/document queries and
  mutations, with one app QueryClient/provider. Lists stay fresh for 30 seconds,
  retain cached titles through refresh failures, and refresh on stale focus or
  reconnect. One automatic retry is limited to network/5xx read failures;
  permanent/auth errors do not retry. Refresh/Retry remains explicit.
- The existing serial save/draft queue runs mutations through MutationObserver;
  writes fail promptly offline and never replay automatically. Accepted writes
  update/invalidate caches and cancel older reads. Logout/expiry/account changes
  remove private query/mutation caches and ignore late responses. Document open,
  reload and uncertain-save reconciliation always read a fresh server revision;
  background refresh never replaces the Zustand editor or durable local drafts.
- Account save/open is committed as `7449241`; the user confirmed completed live
  Google account save/open verification on 2026-10-04 against the local backend.
- Account board save/open UI against the existing local API: explicit upload,
  blank creation, open/rename/delete, serial autosave, save status and retry.
  Login never uploads a board. Guest `current-board` IndexedDB storage remains
  separate from owner/board-scoped account drafts, including pending-save markers.
- Safe switching waits for local saves and clears selection/history; account
  drafts survive reload and sign-out/session expiry. Lost save responses are
  reconciled against the submitted snapshot before retry. Conflicts require
  reload with a recoverable draft backup or an explicit save as a new board.
  Images fail before upload; image-containing local account drafts still reopen.
- Desktop/mobile board controls verified. Choosing a canvas tool on mobile
  collapses the panel so it cannot intercept drawing. No new dependencies,
  endpoints, schema migrations or collection changes were needed for this UI.
- Private board ownership for metadata CRUD and document GET/PUT. Every board
  route requires a persisted session; creation takes its owner from that session.
- Owner/membership filters inside PostgreSQL reads. Document saves check editing
  permission while locking the parent row before checking/disclosing revisions.
- Mutation protection through `X-Scribble-Request: 1`, origin checks and browser
  fetch metadata. Public health and Google sign-in routes remain available.
- Migration 4 applied to Docker PostgreSQL on port 5434. The existing demo board
  is preserved with a NULL owner and hidden from all account queries. It is not
  automatically assigned on login. Portable PostgreSQL is unchanged.
- Account-aware board panel: guest sign-in prompt, list cleared on logout,
  pending requests cancelled, and account recheck after a board-session expiry.
  Guest IndexedDB, document history and editor interactions retain their existing
  behavior. Login never uploads a local board.
- Google OAuth credentials configured in ignored `.env.docker`. On 2026-10-04
  the user verified real Chrome sign-in, staying logged in after reload and
  successful sign-out at `http://127.0.0.1:5173/scribble/`. Configuration presence
  and matching URLs were checked without printing credentials; secrets stay
  untracked. No authentication code change was needed.
- Updated the cloud Scribble API collection through the Postman plugin while
  preserving all existing request/example IDs and scripts. The verified cloud
  copy passes lint and 69 local requests / 228 assertions with zero failures.
  Verification sessions/accounts live only in a temporary random DB schema;
  the environment file and schema are removed after the run.

Prisma validation: 382 fast tests, 41 real Docker PostgreSQL tests (two new
integration cases plus stronger timestamp-precision assertions), server
typecheck, both production builds, clean npm install/client generation, and
69 Postman requests / 228 assertions passed. Development and compiled API
entrypoints passed startup/health/private-route checks. Existing 37 browser
scenarios were last verified for TanStack Query and were not rerun for this
backend-only change.
Account browser scenarios use mocked HTTP; database/API contracts run separately
in isolated schemas. Live Google sign-in/reload/sign-out and account save/open
were user-verified; an automated real browser/API/DB fixture remains pending. Setup:
[authentication.md](authentication.md).

## Pending implementation queue

1. **Frontend cloud image assets:** explicit upload from guest/account drafts,
   cloud-reference adapters, pending/failure/retry UI, expiring signed-image
   refresh and meaningful browser verification. Backend support is implemented.
   Saved-asset reclamation and a scheduled deployment cleanup job remain pending;
   saved assets currently retain storage even after board deletion.
2. **Real-time collaboration:** authorized connections, presence/cursors,
   synchronized edits, reconnect handling and tested concurrent-edit behavior.
3. **PWA and local reliability:** installation/offline loading and cross-tab
   coordination for local saves; preserve stored guest data compatibility.
4. **Repeatable Docker setup:** containerize the API alongside PostgreSQL,
   document fresh setup, and verify an actual Docker database-process restart.
5. **Production delivery:** frontend already runs through a Cloudflare Worker
   at `https://milanputhukkudy.com/scribble/`; deploy the local Express API and
   PostgreSQL (Neon planned), connect the frontend, and add CI checks,
   HTTPS/configuration, logs/error monitoring, deployment
    rate limiting, backups, restore verification and operational runbooks.
6. **End-to-end cloud validation:** automate a real browser/API/DB fixture beyond
   the completed user live-Google account save/open verification, then repeat on
   deployment. Sharing/assets/collaboration paths follow as those features
   become available.

Next session: frontend cloud-image integration. The backend is local and ready;
API/Neon deployment, scheduled cleanup and actual CDN usage monitoring remain
pending. ImageKit budgets limit application storage and URL issuance; reused
signed URLs can consume additional bandwidth during their five-minute validity.
Preserve guest use and explicit upload. Sharing and backend assets are included
in the combined commit authorized on 2026-10-05; check `git log` for its revision.
Future commits need fresh approval. No push or deployment is authorized.
