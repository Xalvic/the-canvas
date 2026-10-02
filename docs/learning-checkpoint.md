# Scribble: resume here

Updated: 2026-10-02. Read once per new project session.

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
exists. Database/API design remains proposed; no new migration, API, or upload.
Detailed comparison, fields, save/conflict flow, and verification sequence:
`docs/canvas-document-storage.md`.

Implemented storage slice: strict version-1 validator and detached ordered-array/
editor-map adapters, all five non-image types, legacy rendering defaults,
duplicate/reference/unknown-field checks and explicit image rejection. No app
wiring or guest-format/store changes. Verified 117 targeted tests (103 new),
frontend build/type checks and server type check. Details and inspection path:
`docs/canvas-document-storage.md`, implemented validator/adapters section.

Next: review this code path one concept at a time; add the numbered document
migration and then local pg save/load in later slices, with SQL practice alongside
them. Introduce Prisma
after tracing that SQL; auth and ownership precede account-based cloud saves.
Ask permission to verify actual database-process restart persistence;
ask separately before importing portable data. React/Express stay
on npm initially. Ask before file edits, execution, installation, switching or
stopping databases. Preserve portable data/credentials until a switch is approved.
An unanswered question is not permission. Prior updates committed as `c2ca442`.
Commit future changes only after explicit user authorization, separately for each
commit. The user prefers reviewing implementation before authorizing a commit.
Another session may create a root Markdown file; leave unrelated work untouched.
Phase 2: SQL practice, document modeling, Prisma remain. Auth/ownership precede cloud saves.

Milestone summaries only, no Q&A logging. Guide: `learning-plan.md`; progress: `learning-progress.md`.
