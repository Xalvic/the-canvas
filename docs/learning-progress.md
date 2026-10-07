# Scribble learning progress

Updated: 2026-10-07. Record milestones and substantial implementation changes
only. No individual questions, answers, or understanding assessments.

Start with [the compact checkpoint](learning-checkpoint.md). Use relevant
sections of [the learning plan](learning-plan.md) when needed.

Workspace UX M0-M10 are implemented/verified locally; M10 completed 2026-10-07.
Implemented bottom drawing/history controls, left zoom, contextual desktop/mobile
styles, compact header spacing, keyboard-bounded drawer/dialogs, safe areas, dark
active-tool contrast, menu traversal, focus restoration and shortcut/clipboard
isolation. Layout remains separate from world coordinates; drag, resize, ink and
atomic history retain their established boundaries. Current layout/theme fixtures
are retargeted to Pages/app menus. Earlier guest/workspace navigation, roles,
sharing, persisted New page requests, consent, journals/assets and automatic saving
remain intact. M10 passes seven viewport-math tests, 38 standard browser cases,
four distinct actual browser/API/Prisma/PostgreSQL journeys, frontend build,
strict focused typecheck, inspected screenshots and diff checks. All 12 normal
tables/14 rows are unchanged; zero disposable schemas remain. Guide/commands:
`workspace-ux-m10.md`. No API/SQL/Prisma/package/IndexedDB-format change; next SQL
stays 12. All pending updates, including M7-M10 and the earlier local commits, are
included in the commit/push and normal Cloudflare deployment authorized 2026-10-07.
The combined checkout passes 811 fast tests and the backend build.
Rollback keeps the M8-aware v4 parser and
exceptional copy handling. Next: **M11 only**, historical manual-provider fixture
consolidation, integrated validation and release handoff. Physical/provider,
screen-reader, actual browser zoom and real keyboard/IME acceptance remain pending.
No normal/production migration was performed during milestone implementation.
The backend release was also authorized: production Neon database `scribble` now
has SQL 1-11, with an encrypted backup and unchanged existing application data.
The user chose a manual Render dashboard deployment; its live workspace API is
pending that deploy. Release record: `workspace-ux-release.md`.
This records implementation/validation, not individual assessments.

## Covered

Phase 1 backend foundations: why a backend is needed, browser/server separation,
Node.js, Express, TypeScript, HTTP methods/endpoints/request-response flow,
JSON parsing versus Zod runtime validation, error responses, and in-memory
storage. This records coverage; it does not claim every planned endpoint exists.

Prisma introduction: its role between Express and PostgreSQL, schema-to-client
generation, typed model queries and the purpose of transactions. SQL remains
the schema migration authority. No individual understanding assessments recorded.

## Implementation roadmap

| Milestone | Current implementation |
| --- | --- |
| Local editor foundation | Custom React/TypeScript/Vite/Zustand canvas, history, selection, IndexedDB boards/assets |
| 1. Backend and HTTP | Prototype metadata CRUD complete: health, create/list/read/rename/delete, validation, configuration, errors, tests |
| 2. PostgreSQL persistence | Metadata/documents/auth/sharing/assets persisted on Docker; Prisma maps SQL migrations 1–6; SQL practice remains |
| 3. Authentication | Google-only OAuth/session API and optional account UI implemented; live sign-in/reload/sign-out user-verified in Chrome |
| 4. Authorization/sharing | Owner/editor/viewer enforcement, Google-email invitations and explicit acceptance implemented |
| 5. TanStack Query/server state | Owner-scoped account queries/mutations, caching, invalidation, refresh/recovery implemented; editor stays in Zustand |
| 6. Cloud assets | ImageKit backend upload/read/signing, PostgreSQL metadata, document references, quotas and delayed cleanup implemented; frontend integration pending |
| 7. Real-time collaboration | Not started |
| 8. Docker | Express connected to Docker PostgreSQL; actual DB restart checks pending |
| 9. Testing | Existing editor tests plus HTTP/config tests |
| 10. Production engineering | Frontend deployed through Cloudflare Worker; Express/Neon deployment, CI and operations remain pending |

## Verification and limits

Latest slice checks: 109 fast tests plus four real PostgreSQL tests passed;
frontend/backend builds, backend typecheck, and 17 Postman requests / 51 assertions passed. A board
survived an actual API process and PostgreSQL process restart.
Earlier frontend build, eight targeted browser tests, and browser API checks
via Vite passed before this backend-only slice.
Implementation commit: `1489979`; no push performed in this chat.

Postman collection updated on 2026-10-02: six current endpoints with lifecycle
and failure examples, saved in the personal workspace. Local Postman files are
ignored by Git. Local run passed 17 requests and 51 assertions. Future API
changes update this same collection.

Rename/delete slice implemented: strict trimmed title validation, stable ID and
createdAt, updatedAt changes for a changed title, empty 204 on delete, and 400/404
failure handling. HTTP tests verify failed updates preserve records and deletion
preserves other boards. Explanation/practice of this slice remains next.

Product direction confirmed: free guest use with local persistence; optional
login for cloud saves and access across devices. Preserve local editing when
cloud features arrive. PWA manifest/service worker are not configured yet;
installation and offline loading are a separate pending feature. Guest-board
upload on login requires an explicit product flow.

PostgreSQL slice added: pg parameterized SQL CRUD, async HTTP handlers, a
versioned transactional migration and database constraints, pooled connections,
configuration and shutdown handling. PostgreSQL 18.6 runs project-locally on
loopback port 5433; generated credentials and data are ignored by Git. The
application role is not a superuser. SQL basics introduced; practice remains.

API metadata is durable in PostgreSQL and independent of the guest canvas's
IndexedDB document. No Prisma, remote canvas saves, authentication, or collaboration yet.
Cross-tab save coordination, physical stylus feel, and real deployment remain
unverified. Existing Vitest audit findings need a separate upgrade review.

## Next

Docker slice (2026-10-02): WSL 2, Docker Linux engine 29.8.1, and Compose 5.5.1
verified after installation. Introduced image/container/volume roles and
host/container port mapping. Prepared PostgreSQL-only Compose using
`postgres:18.6-bookworm`, port 5434, a persistent volume, readiness check, and
first-initialization SQL for a normal app role. Generated separate ignored
`.env.docker` credentials; the portable database and `.env` remain unchanged.
Compose config validation passed. With approval, downloaded the image and started
PostgreSQL; container healthy, named volume mounted. An authenticated Windows
connection on port 5434 verified PostgreSQL 18.6 and the normal `scribble` role
without superuser, database-creation, or role-creation privileges. The database
was then migrated with approval using the existing SQL and a process-scoped
Docker connection. Verified `boards`, `schema_migrations`, all four board columns,
migration version 1. Added Docker-specific npm commands for Express development,
migrations, and real database tests. Express started with `.env.docker` on API
port 3001 and database port 5434. Four real DB tests passed. A live HTTP POST/GET
and direct Docker SQL query matched `Docker connection demo`; that record remains
for inspection. Actual database-process restart persistence testing remains pending.
Portable data and `.env` remain preserved; no portable-data import.
Run guide: `docker.md`.

Next Docker step: compare the demo board in API JSON and psql, then trace the
Docker npm command through env configuration and the Express/pg path.
Ask permission to test actual database-process restart persistence; ask separately before data import;
preserve portable data and credentials. Leave unrelated session work untouched.
Current API implementation commit: `156afec`; Docker setup is a separate slice.
Earlier notes committed as `c2ca442`. Future implementation commits require
separate explicit user authorization after review.

Frontend API slice (2026-10-02): App now mounts a collapsible Server boards panel
beside the canvas. A typed fetch helper validates id/title metadata with Zod;
the component's effect uses abort cleanup, loading/error/success state, and
Refresh/Retry. The existing Vite proxy forwards `/api/boards` to Express.
Build passed. Browser smoke checks verified the real Docker demo title, refresh,
loading, empty, HTTP/network/malformed errors, retry, collapse, desktop/tablet/
mobile layout, keyboard isolation, and guest note persistence after autosave and
reload. No canvas stores, backend endpoints, or database schema changed.
This is a metadata-only view; server-board opening and canvas saving remain
unimplemented. TanStack Query, authentication, and ownership remain pending.
Next: practice SQL on `boards`, beginning with reading/filtering/sorting/limits,
then controlled CRUD and constraints/transactions. Compare canvas storage models,
design schema versions/revision conflicts and asset references, then introduce
Prisma against the existing database. Keep changes small and reviewable; auth and
ownership precede account-based cloud saves.

Document storage design slice: SQL reading/filtering/sorting/limits introduced;
write practice and transactions remain. Compared per-object rows, JSONB boards,
and relational metadata plus JSONB content. Proposed the hybrid, with an ordered
object array adapted to the existing editor map, independent format/save versions,
atomic revision checks, explicit guest-upload choice, and separate image assets.
Detailed design: `canvas-document-storage.md`. No document migration, API,
Prisma integration, or guest upload is implemented by this slice.

Document validation/adapter slice (2026-10-02): covered strict format validation,
map/ordered-array conversion, legacy defaults versus explicit values, and
cross-object reference checks. Implemented a detached version-1 validator and
adapters for every non-image type, preserving IDs/order/zIndex/world coordinates
and supported fields. Rejects duplicates, malformed/unknown content, invalid
connectors, images, and limits without partial acceptance. Numeric-ID orders the
editor map cannot preserve are rejected. Guest format/persistence, selection,
history, and server behavior are unchanged; no app wiring yet. Verified 117
targeted tests (103 new), frontend build/type checking and server type checking.
Inspection path and defaults: `canvas-document-storage.md`.

Document migration slice (2026-10-02): covered zero/one document relationships,
primary/foreign keys and cascade, JSONB shape versus application validation,
SQL NULL in CHECK, positive format/save counters, timestamp defaults, and
transactional migration rollback. Added migration 2 without changing migration 1;
runner applies missing versions in order under its existing lock/transaction.
Eleven real PostgreSQL tests passed in isolated Docker schemas (seven new), plus
server type checking/build. Existing metadata survives upgrade; the migration
creates no documents. Applied to normal Docker PostgreSQL on port 5434: versions
1/2 recorded, five columns/defaults and constraints verified, zero documents.
Before/after metadata comparison is unchanged. Portable DB was not migrated;
endpoints and guest/editor behavior are unchanged.
Walkthrough: `canvas-document-storage.md#migration-2-and-sql-walkthrough`.

Document API slice (2026-10-02): covered expectedRevision versus schemaVersion,
parent-row locks, conditional INSERT/UPDATE, transaction rollback, shared schema
placement, route-specific body limits, and response failure after commit.
Implemented local GET/PUT with pg, 201/200 saves, distinct missing-board/document
404s, 409 revision conflicts, atomic timestamps, and stored-format validation.
No frontend document loading/saving or guest changes. Verified 236 fast tests,
25 real Docker DB tests, server type check, both builds, and the published cloud
Postman collection (40 requests/127 assertions). Five-type content/revision/time
survived an actual API process restart; proof boards removed and original Docker
demo metadata unchanged. Actual Docker DB process restart remains unverified.
Both migration and endpoint slices are included in the end-of-day commit/push
authorized by the user on 2026-10-02.
Walkthrough: `canvas-document-storage.md#document-request-and-sql-walkthrough`.

Google authentication slice (2026-10-02): user chose implementation-only pacing
and Google sign-in only. Implemented OAuth authorization-code flow with state,
nonce and PKCE, official ID-token verification, Google-subject user identity,
hashed PostgreSQL sessions, me/logout and optional account UI. Migration 3 applied
to Docker with the original demo board preserved; portable DB untouched. Login
navigation awaits the existing guest autosave. Verified 279 fast checks, 34 real
DB checks, three browser scenarios, server type check and both builds. Published
Scribble API collection passed 46 requests/145 assertions. Live Google
login is unverified until the user supplies OAuth web-client settings locally.
No passwords, board ownership, or cloud canvas UI were added in this slice.
Setup and current limits: authentication.md. The user authorized an end-of-day
commit/push of the completed work; tomorrow's handoff is in learning-checkpoint.md.

Ownership milestone (2026-10-04): private board/document routes and SQL owner
filters, session-derived creation ownership, mutation CSRF checks, migration 4
and account-aware title list implemented. Unowned demo records are preserved and
hidden; guest IndexedDB and portable PostgreSQL are unchanged. Verified 297 fast
tests, 39 real DB tests, four private-list browser scenarios plus three account
scenarios, typecheck/both builds, and the fetched-back cloud Postman collection
(69 requests / 228 assertions).

Live Google verification (2026-10-04): the user configured OAuth credentials in
ignored `.env.docker` and verified Chrome sign-in, staying logged in after reload,
and sign-out on the local app. Configuration presence/URLs were checked without
printing secrets. No auth code changed; credentials remain untracked.

Account board save/open milestone (2026-10-04, implementation only): added
explicit guest upload, blank account boards, open/rename/delete, serial autosave,
revision conflicts and retry with lost-response reconciliation. Guest IndexedDB
is preserved; owner/board-scoped drafts retain edits through reload, switching
and sign-out/expiry. Reload backs up the latest draft for explicit restoration;
save-as-new preserves both versions. Opening clears selection/history and
restores the saved local viewport. Image uploads stay unsupported, while locally
inserted image drafts remain recoverable. Mobile tool selection collapses the
board panel. Verified 360 fast tests, 39 isolated-schema Docker DB checks,
32 browser checks, typechecks and both builds. Browser account APIs are mocked;
live Google account save/open is now user-verified. Committed as `7449241`.
Existing endpoints and the cloud Postman collection are unchanged. No lessons
or Q&A were recorded.

TanStack Query milestone (2026-10-04, implementation only): v5 provider and
owner-scoped metadata/document caches; 30-second list freshness, retained cached
titles through refresh failures, bounded transient read retry, Refresh/Retry,
stale-focus/reconnect refresh, and cache removal on logout/expiry/account change.
The existing draft/save queue executes mutations with retries disabled, updates
accepted snapshots and cancels stale reads. Documents are read freshly for open,
reload and uncertain-save reconciliation. Background reads do not replace the
editor; guest IndexedDB, explicit upload, local recovery, safe conflicts and
Zustand canvas state are preserved. Verified 382 fast tests, 39 real Docker DB
tests, 37 browser scenarios, typechecks and both builds. No endpoint/schema changes
or Postman update. The user confirmed completed live Google account save/open;
automated real browser/API/DB verification remains pending. No lessons recorded.

Prisma milestone (2026-10-05): generated Client 7.10.0 maps the existing SQL
schema, with routine metadata/auth queries using typed model methods. Saves
and sign-in use Prisma transactions; parameterized SQL preserves owner locks,
revision conflicts, database-clock expiry and exact microsecond timestamps.
The existing bounded pg pool is shared; SQL migrations remain the sole authority.
No normal rows, constraints, indexes, migration versions or portable data changed.
Verified 382 fast tests, 41 real DB checks, server typecheck, both builds,
69 Postman requests / 228 assertions, clean installation/client generation,
schema equality and both API entrypoint smoke checks. Browser tests were not
rerun for this backend-only change. Guide: [prisma.md](prisma.md).

Sharing and roles milestone (2026-10-05, implementation only): owner/editor/viewer
permissions on all metadata/document/sharing routes, explicit Google-email invites
and acceptance/decline, owner role management/removal and cancellation. Invitations
last seven days; owners copy links, with no email delivery service. SQL migration 5
and Prisma mappings preserve existing normal rows/constraints/indexes. Saves and
permission changes share a board lock, retaining atomic revision conflicts. Viewer
canvas guards block durable edits, title changes and history replay while allowing
navigation/selection/copy. Active access checks preserve drafts after downgrade or
removal; opening a viewer snapshot backs up an old editable draft. Guest IndexedDB
and explicit upload remain unchanged. Verified 386 fast tests, 57 real PostgreSQL
checks, 41 browser scenarios across full/targeted runs, typechecks, both builds and
Prisma schema equality. Browser account HTTP is mocked; manual two-account Google
sharing remains unverified. API collection: 101 requests / 325 assertions; v3 lint
101 requests without issues. Guide: [sharing.md](sharing.md). No lesson assessments
recorded. Prisma committed as `c092b74`; sharing is included in the combined
sharing/backend-image commit authorized on 2026-10-05.

Backend cloud-image milestone (2026-10-05, implementation only): ImageKit
private uploads and five-minute signed reads, Google-session board permissions,
fully decoded/normalized static JPEG/PNG/WebP validation, PostgreSQL asset
reservations and Prisma mappings. SQL migration 6 is applied to Docker 5434;
all existing rows/columns/constraints/indexes remain unchanged. Backend documents
accept ready same-board image references under the existing revision/permission
lock. Failed saves roll asset retention back; failed/uncertain uploads retain
cleanup metadata/quota. Saved-once assets are retained indefinitely; only
never-saved uploads can be cleaned after 24 hours and confirmed provider absence
or deletion. Storage/request/issuance budgets are conservative application limits,
not a strict cap on CDN reuse. The actual restricted key passed live upload,
read/signing and deletion; unsigned/expired delivery was blocked. A separate
isolated-schema live HTTP/DB/ImageKit proof passed; disposable files were deleted.
Verified 438 fast tests, 76 isolated real DB checks, typecheck, both builds and
Prisma equality. The fetched-back Postman collection passes 138 requests /
466 assertions with a clean v3 mirror, retaining all existing IDs/manual content.
Details: [implementation-status.md](implementation-status.md).
Browser code/tests were not changed for this backend-only milestone. Implementation
does not imply lesson coverage. Guide: [cloud-images.md](cloud-images.md).

Frontend cloud-image milestone (2026-10-05, implementation only): explicit uploads,
durable completed-asset mappings, cloud adapters, signed rendering/expiry refresh,
retry/reload/recovery and cross-board destination assets. Upload metadata stays
outside undo history; guest blobs and drafts remain compatible. Completed assets
are retained for offline drafts and undo, with unfinished-upload cleanup only.
Six real browser/API/Prisma/PostgreSQL cases pass with controlled image provider
fixtures and verified schema teardown. Builds and targeted API/cache/adapter/
draft checks pass. No live provider or deployed browser validation is claimed.

Real-time collaboration (2026-10-05, implementation): authorized SSE revision
hints/presence, world-space cursors, per-object atomic changes and durable retry
receipts, merge/reconnect and selective undo. Twelve real browser/API/DB cases
pass across images and collaboration. Migration 7 preserves normal Docker data.
Express container persistence passed 36 checks with disposable actual restarts.

Scope change: the user cancelled PWA and Postman maintenance. Their local project
tooling is removed. Cross-tab local save protection and production preparation
continue; consolidated API documentation can wait until project completion.

Cross-tab reliability and production preparation (2026-10-05, implementation):
atomic IndexedDB leases, role-composed tab read-only, fresh takeover and separate
recovery; upgrade preserves existing board/image bytes. Docker API persistence,
production auth/TLS/origin guards, durable admission, bounded readiness and safe
logs, CI/HTTPS/scheduler templates, encrypted backups and empty-target restore.
Verified 579 fast tests, 95 real DB checks, 41 standard browser cases and 16 real
browser/API/DB cases across full runs and affected-case repairs. Both builds and
typechecks pass. Actual disposable Docker restart checks: 36; restore: 15;
Caddy private-error-log checks: six. No existing data/images were deleted.
Implementation does not imply lesson coverage or deployment. PWA and Postman
remain cancelled. Next: local production configuration and external Worker review.

Current implementation queue is complete within the revised local scope; deployment remains
pending. Guest IndexedDB and explicit guest upload stay separate; login never
uploads a board. Sharing and backend assets are included in the combined commit
authorized on 2026-10-05; check `git log` for its revision. Future commits need
fresh approval. No push authorized.
Queue: [implementation-status.md](implementation-status.md).
