# Scribble implementation status

Updated: 2026-10-04. Implementation only; lesson topics are excluded.

## Completed milestones

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
- Owner filters inside PostgreSQL reads/writes. Document saves check ownership
  while locking the parent row, before checking or disclosing save revisions.
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

Validation: 382 fast tests (22 new query cases), 39 real Docker PostgreSQL tests,
and 37 browser scenarios (five new cache/refresh/recovery cases plus account,
authentication, private-list and canvas regressions), frontend/server typechecks
and both production builds.
Account browser scenarios use mocked HTTP; database/API contracts run separately
in isolated schemas. Live Google sign-in/reload/sign-out and account save/open
were user-verified; an automated real browser/API/DB fixture remains pending. Setup:
[authentication.md](authentication.md).

## Pending implementation queue

1. **Prisma:** integrate against the existing schema while preserving data,
   constraints, transaction behavior and a single migration authority.
2. **Sharing and roles:** owner/editor/viewer permissions and a user-facing
   sharing flow, with server enforcement on every read and mutation.
3. **Cloud image assets:** durable private storage, validated uploads, access
   checks, recoverable failures, deletion and orphan cleanup.
4. **Real-time collaboration:** authorized connections, presence/cursors,
   synchronized edits, reconnect handling and tested concurrent-edit behavior.
5. **PWA and local reliability:** installation/offline loading and cross-tab
   coordination for local saves; preserve stored guest data compatibility.
6. **Repeatable Docker setup:** containerize the API alongside PostgreSQL,
   document fresh setup, and verify an actual Docker database-process restart.
7. **Production delivery:** choose/configure hosting, deploy frontend/API/DB/
    assets, CI checks, HTTPS/configuration, logs/error monitoring, deployment
    rate limiting, backups, restore verification and operational runbooks.
8. **End-to-end cloud validation:** automate a real browser/API/DB fixture beyond
   the completed user live-Google account save/open verification, then repeat on
   deployment. Sharing/assets/collaboration paths follow as those features
   become available.

Next session: review TanStack Query, then Prisma. Non-image account
boards are implemented against local API/PostgreSQL; deployment and image assets
follow later. Preserve guest use and explicit upload.
