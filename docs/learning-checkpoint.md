# Scribble: resume here

Updated: 2026-10-02. Read once per new project session.

Learn through small Scribble slices; general study/DSA remain separate.

Covered: Phase 1 backend/HTTP foundations, Node/Express/TypeScript, Zod versus
JSON parsing, errors, and temporary storage.

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
columns, migration version 1, and zero board rows. Restart persistence testing
and API database switching have not been performed.
This chat needed Docker's bin directory added to the process PATH for its
credential helper; no permanent PATH change.

Next: inspect `boards` in psql and explain the existing migration path one step
at a time. Ask permission to verify restart persistence and switch the API;
ask separately before importing portable data. React/Express stay
on npm initially. Ask before file edits, execution, installation, switching or
stopping databases. Preserve portable data/credentials until a switch is approved.
An unanswered question is not permission. Ask about committing after updates.
Another session may create a root Markdown file; leave unrelated work untouched.
Phase 2: SQL practice, document modeling, Prisma remain. Auth/ownership precede cloud saves.

Milestone summaries only, no Q&A logging. Guide: `learning-plan.md`; progress: `learning-progress.md`.
