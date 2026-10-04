# Scribble implementation status

Updated: 2026-10-04. Implementation only; lesson topics are excluded.

## Completed in this milestone

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
- Updated the cloud Scribble API collection through the Postman plugin while
  preserving all existing request/example IDs and scripts. The verified cloud
  copy passes lint and 69 local requests / 228 assertions with zero failures.
  Verification sessions/accounts live only in a temporary random DB schema;
  the environment file and schema are removed after the run.

Validation: 297 fast tests, 39 real Docker PostgreSQL tests, four private-list
browser scenarios plus three account scenarios, server typecheck, and both
production builds. These checks cover controlled sessions; live Google consent/
login still needs the user's OAuth client settings. Setup:
[authentication.md](authentication.md).

## Pending implementation queue

1. **Live Google sign-in:** configure the web-client credentials in ignored
   `.env.docker`, then verify consent, reload/session persistence and logout.
   Credentials are currently absent; do not store them in frontend code or Git.
2. **Account board save/open:** explicit upload of a local board, protected
   list/create/rename/delete UI, document save/load, save status, revision-conflict
   recovery and safe switching that preserves unsaved local work. Non-image
   documents can use the current API; image boards need the asset milestone.
3. **TanStack Query:** server metadata/document queries, mutations, caching,
   invalidation and error recovery; keep pointer/editor state in its current
   stores. This can be delivered with the account-board UI.
4. **Prisma:** integrate against the existing schema while preserving data,
   constraints, transaction behavior and a single migration authority.
5. **Sharing and roles:** owner/editor/viewer permissions and a user-facing
   sharing flow, with server enforcement on every read and mutation.
6. **Cloud image assets:** durable private storage, validated uploads, access
   checks, recoverable failures, deletion and orphan cleanup.
7. **Real-time collaboration:** authorized connections, presence/cursors,
   synchronized edits, reconnect handling and tested concurrent-edit behavior.
8. **PWA and local reliability:** installation/offline loading and cross-tab
   coordination for local saves; preserve stored guest data compatibility.
9. **Repeatable Docker setup:** containerize the API alongside PostgreSQL,
   document fresh setup, and verify an actual Docker database-process restart.
10. **Production delivery:** choose/configure hosting, deploy frontend/API/DB/
    assets, CI checks, HTTPS/configuration, logs/error monitoring, deployment
    rate limiting, backups, restore verification and operational runbooks.
11. **End-to-end cloud validation:** complete sign-in → board creation → drawing
    → save → refresh/reopen tests, followed by sharing/assets/collaboration paths
    as those features become available.

Next implementable milestone: account board save/open. Live Google setup can be
completed independently when the local credentials are available.
