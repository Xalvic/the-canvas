# Scribble: project handover for AI agents

Updated: 2026-10-08. This document is the broad entry point for a new agent
working in this repository. It summarizes the system and points to topic guides;
those guides and current source code remain authoritative for detailed behavior.

## Start here

1. Read the repository [AGENTS.md](../AGENTS.md). It defines the project workflow,
   product constraints, persistence and canvas invariants, and validation rules.
2. Read [learning-checkpoint.md](learning-checkpoint.md) for the accumulated
   implementation history and user preferences. It is historical in places.
3. Read the active [UI redesign implementation plan](../UI_REDESIGN_IMPLEMENTATION_PLAN.md)
   and [R7 handoff](ui-redesign-r7.md) for the most recent status. They supersede
   the checkpoint's older note that M11 was still pending. R0-R7 are recorded as
   locally verified; the external release and hands-on acceptance listed below
   remain separate.
4. Before editing, inspect `git status --short` and the relevant source/docs. This
   checkout already contains a large body of uncommitted application, test,
   migration, plan, and evidence changes. Preserve them. Do not reset, clean,
   overwrite, or assume that those changes belong to your task.
5. Work only on the user's current request. The active UI plan says to take one
   milestone per session, but all R0-R7 milestones are currently recorded complete.
   Do not restart them or invent another implementation milestone without a new
   user request.

## Product at a glance

Scribble is a React whiteboard with an infinite canvas. Guests can draw and edit
locally without signing in. Google sign-in enables optional online pages,
collaboration, and sharing. Guest and account data have separate storage and
explicit transitions: login never silently uploads a guest board. Pages shared
by link still require Google authentication. The link controls whether an
authenticated recipient has viewer or editor access.

The editor supports notes/cards, text, frames, connectors, freehand pen strokes,
images, selection, grouping, clipboard operations, zoom/pan, and undo/redo. The
app is a custom editor; it is not based on tldraw, Excalidraw, Yjs, or a hosted
canvas SDK.

## Current repository and release state

### Latest implementation

- The earlier workspace UX work M0-M11 and the later redesign R0-R7 are recorded
  as implemented and verified locally. Read [M11](workspace-ux-m11.md) for the
  inherited reliability work and [R7](ui-redesign-r7.md) for the newest combined
  acceptance, direct link-sharing behavior, migration, and handoff.
- R7 added authenticated reusable share links and a consistent grant/access
  model, plus a broad UI redesign. The local SQL migration is
  [`db/012_create_board_share_links.sql`](../db/012_create_board_share_links.sql).
  SQL files and the existing transactional runner are the schema authority;
  Prisma describes/validates the schema but does not apply migrations.
- Current local R7 evidence records: 868 fast checks, 176 PostgreSQL checks, 108
  standard browser checks (three historical baseline cases skipped), and 87
  distinct integrated browser/API/database cases across the full run and focused
  rechecks. Builds, type checks, Prisma validation, visual review, migration
  preservation, and fixture cleanup are also recorded in R7. These are saved
  results, not tests run by every future session.
- A stable local `SHARE_LINK_KEY` and SQL migration 12 were configured for the
  normal local Docker database as part of R7 setup, after an encrypted backup.
  R7 reports preservation of existing rows and schema, with the new link tables
  empty. Backup materials and credentials live in ignored local files; retain
  them and never print or commit secrets.

### Worktree and database caution

At the time this handover was written, `git status` showed extensive modified and
untracked files across `src/`, `server/`, tests, plans, docs, migration 12, and
visual evidence. This includes intended implementation work as well as the
handoffs. Do not infer that a dirty worktree is accidental, stage everything, or
discard changes. Inspect the exact diff before any edit, and keep changes limited
to the user-authorized scope. The normal local Docker PostgreSQL database has
also been intentionally migrated to version 12; do not reset, recreate, or import
data into it.

### Production and external release

R7 did not apply migration 12 to production, configure the production share-link
key, commit, push, or deploy the redesign. Previous release records describe a
Cloudflare Pages frontend and a Render API with manual deployment; however, the
latest R7 record explicitly says to recheck actual provider state before release.
Do not assume the current local API and frontend are deployed or that production
supports link sharing. Guest local drawing remains available if online features
are unavailable. Production SQL, credentials/provider changes, commit, push, and
deployment each require explicit authorization under the project instructions.

Before any future release, use R7's release checklist: confirm actual hosting and
database state, make a new encrypted backup and before-state audit, apply pending
additive SQL with the existing runner, configure a stable backend-only share key,
deploy a compatible backend before the frontend, then verify authenticated access
and revocation with controlled accounts. Keep earlier migration/data and recovery
records. See [production preparation](production.md), [release record](workspace-ux-release.md),
and R7's “Release preparation” and rollback sections for the precise sequence.

### Remaining human/provider acceptance

Automated browser simulations and screenshots do not establish acceptance on
physical devices or with live providers. R7 records these as outstanding:

- Physical pen pressure/palm rejection, mobile keyboard and IME behavior, actual
  browser chrome zoom, screen-reader traversal, and operating-system sleep/wake.
- Live Google and image-provider behavior, hosting/API integration, and provider
  failure handling after any authorized release.
- Cold Render reconnect and production sharing/permissions after the backend has
  actually been deployed.

Do not report these as verified based only on local fixtures. For hands-on pen
details, see [pen drawing validation](pen-drawing-validation.md). For the saved
R7 screenshots and exact automated gate evidence, see [R7](ui-redesign-r7.md).

## Architecture and source map

### Frontend

| Area | Main location | Responsibility |
| --- | --- | --- |
| App startup and shell | `src/main.tsx`, `src/App.tsx`, `src/components/` | Mount React, providers, account/page UI, menus, dialogs and workspace shell. |
| Canvas input and rendering | `src/canvas/` | Pointer/touch/pen input, viewport transforms, object/frame/connector/stroke layers. |
| Viewport math | `src/canvas/viewport/viewportMath.ts` | World/screen conversion. Pan and zoom must be included explicitly. |
| Editor stores | `src/store/` | Document, selection, interaction, viewport, tools, theme and collaboration state. |
| History and clipboard | `src/history/`, `src/clipboard/` | Atomic undo/redo operations and copy/paste commands. |
| Local/account persistence | `src/persistence/` | IndexedDB, local saves, account journals, navigation, guest transfer, tab ownership and recovery. |
| API clients | `src/api/` | Browser-side HTTP contracts for auth, pages, workspace, sharing, collaboration and assets. |
| Images | `src/assets/` | Import/decode, local Blob storage, and cloud image access. |
| UI styling | `src/styles.css`, `src/*-controls.css`, `src/ui-*.css`, `src/workspace-shell.css` | Imported style layers and the current token/primitives/shell/control styles. |

`CanvasViewport` coordinates input and rendering. `documentStore` owns durable
canvas objects and history; `selectionStore` owns selection separately. Pointer
movement previews live in refs/transient interaction state and commit at the end
of a user action. The editor stores objects in world coordinates; viewport math
converts to screen coordinates for display and pointer handling.

### Backend and storage

| Area | Main location | Responsibility |
| --- | --- | --- |
| Express composition | `server/index.ts`, `server/app.ts` | Configure dependencies, middleware, health/readiness, and API routes. |
| Auth | `server/auth.ts`, `server/authRoutes.ts`, `server/googleAuth.ts`, `server/postgresAuth.ts` | Google OAuth, sessions, and authenticated request context. |
| Pages and documents | `server/boards.ts`, `server/documents.ts`, `server/postgresBoards.ts`, `server/postgresDocuments.ts` | Metadata, ownership, access and revision-safe document saves. |
| Sharing and links | `server/sharing.ts`, `server/shareLinks.ts`, `server/shareLinkRoutes.ts`, `server/postgresSharing.ts`, `server/postgresShareLinks.ts` | Explicit membership/invitations and authenticated reusable link grants. |
| Collaboration | `server/collaboration*.ts`, `server/postgresCollaboration.ts` | Revisioned operations, receipts, presence and event streams. |
| Assets | `server/assets.ts`, `server/imageAssets.ts`, `server/postgresAssets.ts`, `server/imageKit.ts` | Validated image uploads, asset metadata, signing and cleanup paths. |
| Database | `db/*.sql`, `server/migrations.ts`, `server/migrate.ts`, `server/prisma.ts`, `prisma/schema.prisma` | Additive SQL migrations and typed PostgreSQL access. |
| Deployment | `deployment/`, `Dockerfile`, `compose.yaml` | API image/proxy/host examples, backup and scheduled-operation templates. |

The frontend is served below `/scribble/` in the configured Vite build. Vite's
proxy is for local development; it is not a production API server. The Express
API runs separately. `deployment/cloudflare/api-proxy.ts` is an integration
module for the existing Worker, not proof that external Worker source is tracked
or deployed.

## Non-negotiable behavior and design rules

These are summarized from [AGENTS.md](../AGENTS.md); read it before changing
related code.

- Keep guest editing and IndexedDB persistence available without login. Google is
  the only supported sign-in. Account access is optional; sign-in never triggers
  an automatic guest upload. Guest transfer must be an explicit, user-facing,
  recoverable action.
- Preserve compatibility with stored local data. IndexedDB is version 4 and the
  canvas document schema is version 1 in the R7 handoff. Add safe defaults or
  migrations when a schema change is truly required; do not casually change keys
  or formats.
- Keep world coordinates separate from viewport/screen coordinates. Consider
  pan, zoom, selection, drag, resize, drawing, and mobile layout together when
  touching canvas interactions.
- Do not duplicate selection state or move selection ownership into the document.
  High-frequency pointer paths should not cause avoidable React renders,
  allocations, persistence writes, or history entries.
- Drag/resize/draw previews stay transient while an interaction is in progress.
  Commit one durable operation at its established boundary. Undo/redo replay
  must not create new history entries; a visible action should remain atomic.
- Respect data ownership and authorization at both API and database query layers.
  Access through a shared link still requires Google auth; the signed link token
  is not anonymous authorization. A viewer cannot mutate or administer a page.
- Preserve recovery identities/receipts, account journals, pending uploads,
  conflict drafts and tab writer ownership. Unknown network outcomes must be
  reconciled safely; do not turn a failed read into an empty workspace or replay
  a non-idempotent write with a new identity.
- SQL files and the transactional SQL runner are the migration authority. Keep
  schema changes additive unless specifically planned and authorized. Do not
  reset normal local/production databases for test convenience.
- Stay within the user's free-tier requirement. PWA installation/offline app
  loading and Postman collection/tooling maintenance are out of scope. A future
  consolidated API list was deferred until project implementation is complete.

## Local development and useful commands

### Frontend only

```bash
npm install
npm run dev
```

Guest editing can be explored without the backend. The app's base path is
`/scribble/` (`vite.config.ts`).

### Full local stack

The exact database setup depends on the local environment and its ignored env
files. Read [PostgreSQL setup](postgresql.md), [Docker setup](docker.md),
[Prisma workflow](prisma.md), and [authentication setup](authentication.md)
before starting or migrating services. Do not print `.env`, `.env.docker`, OAuth,
database, ImageKit, proxy, or share-link secrets. The R7 handoff records a local
Docker database on port 5434 and a local app/API used for manual testing; inspect
service/process status before starting duplicates.

Common commands from `package.json`:

| Task | Command |
| --- | --- |
| Frontend development server | `npm run dev` |
| API development server with `.env` | `npm run dev:server` |
| API development server with Docker env | `npm run dev:server:docker` |
| Apply SQL using configured `.env` | `npm run db:migrate` |
| Apply SQL using `.env.docker` | `npm run db:migrate:docker` |
| Run unit/API tests | `npm test` |
| Run server tests | `npm run test:server` |
| Run PostgreSQL checks | `npm run test:database` or `npm run test:database:docker` |
| Run standard Playwright browser tests | `npm run test:e2e` |
| Run integrated browser/API/DB tests | `npm run test:e2e:integration` |
| Build frontend | `npm run build` |
| Check/build backend | `npm run typecheck:server`, `npm run build:server` |
| Validate Prisma schema | `npm run db:validate` |

Do not run a database migration, destructive database operation, provider action,
or broad acceptance gate without checking the user's task and the relevant guide.
Use disposable schemas/fixtures for integration tests. The R7 gate uses scripts
in `ui-redesign-evidence/`; consult its handoff before replaying those tests.

## Topic guide index

Read a focused guide when changing its behavior rather than loading every doc at
once.

| Topic | Guide |
| --- | --- |
| System overview and editor flow | [architecture](architecture.md) |
| Existing guest IndexedDB and save behavior | [persistence](persistence.md), [canvas document storage](canvas-document-storage.md) |
| Google-only OAuth and sessions | [authentication](authentication.md) |
| Page permissions and invitations | [sharing](sharing.md) |
| Collaborative edits, presence and conflicts | [collaboration](collaboration.md) |
| Cloud image upload/recovery/cleanup | [cloud images](cloud-images.md) |
| PostgreSQL setup and Docker | [PostgreSQL](postgresql.md), [Docker](docker.md), [Prisma](prisma.md) |
| Production topology and release preparation | [production](production.md), [workspace release record](workspace-ux-release.md), [R7 handoff](ui-redesign-r7.md) |
| Encrypted backup and restore | [backups](backups.md) |
| Cross-tab local save ownership | [local reliability](local-reliability.md) |
| Pen input and visual validation | [pen drawing validation](pen-drawing-validation.md) |
| Earlier workspace UX and recovery milestones | [M11](workspace-ux-m11.md), with M0-M10 guides linked there |
| Learning and implementation history | [learning progress](learning-progress.md), [learning plan](learning-plan.md), [implementation status](implementation-status.md) |

Historical docs can describe the product or deployment as it existed when they
were written. When they conflict, use this order: current user request and
`AGENTS.md`; the active implementation plan and latest R7 handoff; then focused
topic docs; then older learning/history notes. Confirm implementation claims in
current source before relying on old saved assumptions.

## Next-agent checklist

For a new task, identify the affected feature, read only its source and guides,
and make the smallest complete change. Keep changes scoped to the user's request.
Before finishing, inspect `git diff` and `git status` so the user can distinguish
your work from the existing dirty tree. Follow the requested validation scope;
project guidance calls for narrow checks first and says not to add or run tests
unless the user asks. Do not commit unless the user explicitly authorizes that
commit. Do not push or deploy based on old authorization.
