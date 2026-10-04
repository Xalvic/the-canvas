# Scribble: resume here

Updated: 2026-10-04. Read once per new project session.

## Current handoff

The user requested implementing pending items one by one, without lessons.
Board ownership/protected metadata and documents are now implemented and tested.
Next: account board save/open with explicit local upload and safe save conflicts;
see `docs/implementation-status.md` for the implementation queue.
Live Google login still needs local OAuth settings in ignored `.env.docker`;
see `docs/authentication.md`. Docker PostgreSQL uses port 5434 with migrations
1/2/3/4 applied; its original demo board is preserved and hidden as unowned.
Portable PostgreSQL on 5433 is preserved. Check service status after reboot.
Google-only sign-in and guest IndexedDB use remain the product choices.
The user authorized committing this ownership milestone on 2026-10-04; check
git log for its revision. No push is authorized. Future commits need fresh approval.

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

Next: account board save/open; configure/test the live Google client separately.
Prisma and other implementation items are in `docs/implementation-status.md`;
keep one migration authority. Private board/document access is now enforced.
Ask permission to verify actual database-process restart persistence;
ask separately before importing portable data. React/Express stay
on npm initially. Ask before file edits, execution, installation, switching or
stopping databases. Preserve portable data/credentials until a switch is approved.
An unanswered question is not permission. Prior updates committed as `c2ca442`.
Commit future changes only after explicit user authorization, separately for each
commit. The user prefers reviewing implementation before authorizing a commit.
Another session may create a root Markdown file; leave unrelated work untouched.
Phase 2: Prisma remains; document modeling and the local API proof are implemented.
Phase 3: Google-only auth implemented/tested locally; real Google credentials/login
pending. Phase 4: ownership is implemented; sharing/roles remain pending.

Milestone summaries only, no Q&A logging. Guide: `learning-plan.md`; progress: `learning-progress.md`.
