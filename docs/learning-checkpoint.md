# Scribble: resume here

Updated: 2026-10-02. Read once per new project session.

Learn product engineering through Scribble, one concept and small slice at a
time. General study/DSA remain separate.

Covered: Phase 1 backend foundations — backend purpose, browser/server
separation, Node.js, Express, TypeScript, HTTP requests/responses, endpoints,
Zod runtime validation, JSON parsing, errors, and temporary in-memory storage.

Implemented: local API with health and board metadata create/list/read/rename/delete,
now backed by PostgreSQL. The Map remains only as an HTTP-test fixture. Run the
project-local database (port 5433), `npm run db:migrate`, then `npm run dev:server`
separately from `npm run dev`. API metadata survives restarts; the guest canvas
still saves independently in IndexedDB. Setup/run guide: `postgresql.md`.

Latest slice: SQL table/constraints, versioned transactional migration,
parameterized CRUD with pg, async routes, pool lifecycle, ignored credentials
and database files. Verified 109 fast tests, four real PostgreSQL tests, backend
typecheck, frontend/backend builds, 17 Postman requests / 51 assertions, and an actual API plus
database process restart. PostgreSQL 18.6 initialized locally; database currently
running, no Windows autostart. No Prisma or cloud canvas storage yet.

Product direction: free guest use keeps IndexedDB persistence without login.
PWA installation/offline loading remain to implement (no manifest/service worker
configured). Login will enable optional cloud storage and cross-device access;
keep local editing available. Do not silently upload guest boards on login.

Next: learn Docker images, containers, volumes, and Compose; explain Windows
installation first. The user wants PostgreSQL in Docker. Ask before commands,
file changes, installation, or switching database setups; an unanswered question
is not permission. Ask about committing after meaningful changes.
Phase 2 remains in progress: SQL practice, canvas document model, and Prisma
remain. Authentication and ownership follow before cloud saves.

Keep milestone summaries only; do not log individual questions/answers or update
docs after every exchange. Guide: `learning-plan.md`; progress: `learning-progress.md`.
