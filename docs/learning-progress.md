# Scribble learning progress

Updated: 2026-10-02. Record milestones and substantial implementation changes
only. No individual questions, answers, or understanding assessments.

Start with [the compact checkpoint](learning-checkpoint.md). Use relevant
sections of [the learning plan](learning-plan.md) when needed.

## Covered

Phase 1 backend foundations: why a backend is needed, browser/server separation,
Node.js, Express, TypeScript, HTTP methods/endpoints/request-response flow,
JSON parsing versus Zod runtime validation, error responses, and in-memory
storage. This records coverage; it does not claim every planned endpoint exists.

## Implementation roadmap

| Milestone | Current implementation |
| --- | --- |
| Local editor foundation | Custom React/TypeScript/Vite/Zustand canvas, history, selection, IndexedDB boards/assets |
| 1. Backend and HTTP | Prototype metadata CRUD complete: health, create/list/read/rename/delete, validation, configuration, errors, tests |
| 2. PostgreSQL persistence | In progress: local PostgreSQL, durable metadata CRUD, SQL migration/constraints and real DB tests; canvas document model and Prisma remain |
| 3. Authentication | Not started |
| 4. Authorization/sharing | Not started |
| 5. TanStack Query/server state | First read-only API list via fetch/effect; TanStack Query pending |
| 6. Cloud assets | Local image storage exists; cloud storage not started |
| 7. Real-time collaboration | Not started |
| 8. Docker | Express connected to Docker PostgreSQL; actual DB restart checks pending |
| 9. Testing | Existing editor tests plus HTTP/config tests |
| 10. Production engineering | Frontend/backend builds exist; deployment/CI/operations not configured in the repository |

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

Trace INSERT/SELECT and practice table queries, then compare canvas document
models and introduce Prisma after SQL. Authentication and ownership follow
before connecting cloud document saves to the canvas. Phase 2 remains in progress.
Explain and build in small slices at the user's pace.
