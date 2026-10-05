# Local PostgreSQL and Express Docker setup

Current status (2026-10-05): the API container and SQL migrations 1–8 are
implemented. Thirty-six actual disposable restart/recreation checks pass;
normal data and volumes and portable PostgreSQL on 5433 are preserved. See
[Express container](#express-container-2026-10-05) for current commands and
[production preparation](production.md) for the separate pending hosting setup.
The dated setup slices below record earlier learning stages.

Status (2026-10-02): image downloaded and PostgreSQL started with approval.
The container is healthy; an authenticated Windows connection to port 5434
confirmed database `scribble`, PostgreSQL 18.6, and a normal `scribble` app role
without superuser, database-creation, or role-creation privileges. The named
volume is mounted. The existing migration was applied with approval to Docker
port 5434 as `scribble`. Verified `boards` and `schema_migrations`, all four board
columns and migration version 1. Express now runs through `dev:server:docker`
at `http://127.0.0.1:3001`, using Docker PostgreSQL on port 5434. Four real database
tests passed. An HTTP POST created `Docker connection demo`; GET and a direct SQL
query confirmed the same record. That demo row remains for inspection.
Actual database-process restart persistence testing remains pending.
React and Express continue to run on npm. The portable database and its `.env`
stay separate; existing portable records have not been imported.

Document migration slice (2026-10-02): migration 2 is now applied to the normal
Docker schema on port 5434. `board_documents` has five verified columns, a
primary/foreign key with cascade, positive version/revision checks, a JSONB shape
check, and timestamp default. Ledger versions are 1/2; there are zero document
rows, and the existing board metadata is unchanged. Eleven real database tests
passed in isolated schemas. No document API was included in that slice; portable
database not migrated. Walkthrough: [document migration SQL](canvas-document-storage.md#migration-2-and-sql-walkthrough).

Document API slice: local GET/PUT now save non-image snapshots with revision
checks and atomic timestamps. All 25 real DB tests and the published Postman run
(40 requests/127 assertions) passed. Five-type content survived an actual API
process restart. Temporary proof boards were removed; existing demo metadata is
unchanged. Server save/load UI and actual Docker DB process restart remain pending.
Walkthrough: [document request SQL](canvas-document-storage.md#document-request-and-sql-walkthrough).

Google-only authentication now adds migration 3 (users, auth_sessions,
google_auth_flows), applied to Docker; ledger versions 1/2/3. Auth and document
tests total 34 real DB checks. OAuth credentials are not configured locally, so
Google sign-in remains disabled while guest editing works. Setup:
[authentication](authentication.md). Existing demo metadata and portable DB are preserved.

## Follow the connection

An image is the packaged PostgreSQL software. A container runs that image.
The named volume stores database files independently of the container.

```text
Express on Windows -> 127.0.0.1:5434 -> PostgreSQL container:5432
                                              |
                                     postgres-data volume
```

`compose.yaml` pins the official `postgres:18.6-bookworm` image. The port mapping
publishes it on Windows loopback only. Portable PostgreSQL uses port 5433, so
these are separate databases. Docker starts with a fresh database; it does not
import portable boards automatically.

For PostgreSQL 18, the volume mounts at `/var/lib/postgresql`, with database files
under its version-specific directory. Compose names this volume
`scribble-local_postgres-data`. Stopping or replacing the container retains it.

`docker/postgres/001_create_app_role.sql` runs on the first initialization of an
empty volume. It creates the normal `scribble` login and transfers ownership of
the `scribble` database to it. The API does not use the administrator role.
The existing migration has now created the application tables. Its connection
was scoped to `.env.docker` for that process, without changing the portable `.env`.

## Credentials and configuration validation

On this machine, `.env.docker` contains separate generated administrator and app
passwords. Git already ignores it via `/.env.*`. The portable `.env` is unchanged.
For a fresh checkout, copy `docker.env.example` to `.env.docker` and replace the
placeholders. Its app password must match the password in `DATABASE_URL`.

Run from the project root:

```powershell
docker compose --env-file .env.docker config --quiet
```

This validates configuration without starting a container. Omit neither
`--env-file` nor `--quiet`: the former selects Docker credentials; the latter
avoids displaying resolved credentials in the configuration output.
The healthcheck checks whether PostgreSQL accepts connections on its TCP port;
it does not verify the API password or application migrations.

If an older terminal cannot find `docker`, reopen it to pick up the installed
PATH. On this machine the CLI is also available at
`$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe`.
For this chat's shell, adding that directory to the process PATH also lets Docker
find its `docker-credential-desktop` helper when pulling images. No permanent
PATH change was needed.

## Start and check

These commands downloaded the image and started the database with approval:

```powershell
docker compose --env-file .env.docker up -d --wait postgres
docker compose --env-file .env.docker ps
```

The app login and migration have been verified. In the container's Exec terminal,
run `psql -U scribble -d scribble`, then `\dt` to see all three tables and `\d boards`
to see the board columns and constraints. `\d board_documents` shows document
storage. `SELECT version FROM schema_migrations ORDER BY version;`
shows versions 1 and 2. Exit psql with `\q`.

## Connect Express to Docker

Run these commands from the project root:

```powershell
npm run db:migrate:docker
npm run dev:server:docker
```

The Docker scripts require `.env.docker`. `dev:server:docker` loads its
`DATABASE_URL` and runs the existing `server/index.ts`; its `pg` connection pool
then connects to `127.0.0.1:5434/scribble`. The HTTP API stays on port 3001.
No route or SQL-store rewrite was needed: the existing backend already accepts
its database address through configuration.

`dev:server` and `db:migrate` still load the portable `.env`. Choose the Docker
commands for this setup and run only one API process on port 3001. Exported
environment variables take precedence over Node's env files; the verified run
had no exported database or API-port overrides.

Run `npm run test:database:docker` for the four real database tests. They use and
remove a random test schema without changing the ordinary `boards` table.

For a visible check, open `http://127.0.0.1:3001/api/boards` to see the API's JSON.
In the Docker psql session, run:

```sql
SELECT id, title FROM boards;
```

Both should show `Docker connection demo`, proving that a request to Express
stored a row in Docker PostgreSQL. API board metadata remains independent of
guest canvas documents in IndexedDB.

## Read the API from React

With the Docker API running, start Vite in another terminal:

```powershell
npm run dev
```

Open the printed `/scribble/` URL. The Server boards panel shows titles from
`GET /api/boards`, including `Docker connection demo`. Refresh reads the latest
list; Retry is available after a failed request. Collapse the panel by selecting
its heading. It displays metadata only; it does not open a stored drawing.

`src/App.tsx` mounts the panel beside the canvas. The effect in
`src/components/ServerBoards/ServerBoards.tsx` calls `src/api/boards.ts`, which
fetches `/api/boards`, checks HTTP success, and validates the JSON's id/title
fields. The existing Vite proxy forwards this request to Express on port 3001.
The component renders loading, empty, error, or list content. Cleanup aborts
stale requests; the panel's state stays separate from canvas/IndexedDB stores.

In browser DevTools, open Network, filter for `boards`, and select Refresh.
Inspect the GET request and its JSON response. The development Strict Mode
cleanup may cancel an initial request before a fresh one completes.
The proxy is a Vite development feature; a deployed frontend will need its own
API routing configuration later.

Next, ask permission to test actual database-process restart persistence.
Importing existing portable data needs a separate explicit decision.

When approved to stop the Docker database, `docker compose --env-file .env.docker
stop postgres` retains its container and volume. `down` removes containers and
the network but retains the named volume. **`down -v` deletes the database volume**.
Changing initialization passwords or SQL files does not reconfigure an existing
volume; change an existing database explicitly rather than deleting its data.

References: [official PostgreSQL image](https://hub.docker.com/_/postgres),
[Docker volumes](https://docs.docker.com/engine/storage/volumes/),
[Compose networking](https://docs.docker.com/compose/how-tos/networking/),
[psql variables](https://www.postgresql.org/docs/18/app-psql.html).

## Express container (2026-10-05)

The optional Compose `api` profile packages Express, Prisma's generated client,
the image decoder and the SQL migration runner. PostgreSQL's existing service,
loopback port 5434, initialization credentials and `postgres-data` volume remain
the same. Without `--profile api` (or explicitly targeting `api`), Compose still
runs the existing PostgreSQL-only setup. React continues to run through Vite or
the existing Cloudflare deployment.

The Dockerfile builds on the pinned official Node 24.21.0 Bookworm slim image,
generates Prisma from the checked-in mapping, compiles the server and removes
development dependencies. The final container runs as the `node` user, with a
read-only filesystem and a small temporary filesystem. The build allowlist in
`.dockerignore` excludes `.env` files, local databases, IndexedDB/browser test
artifacts, frontend files and host-generated Prisma code. Backend secrets are
provided at runtime by `.env.docker`; they never enter an image layer.

Inside Compose, `API_HOST=0.0.0.0` binds the container network interface while
`127.0.0.1:3001:3001` exposes the API only on this computer. Host npm commands
still bind to `127.0.0.1` by default. The container entrypoint rewrites only the
host/port of the existing `DATABASE_URL` to `postgres:5432`, retaining its
username, URL-encoded password, database and query options. It does not rewrite
`.env.docker` or the portable `.env`; Windows npm commands continue to connect
to port 5434. Google and ImageKit variables are backend-only runtime settings.
Their existing callback/frontend URLs can remain unchanged for this local
loopback deployment.

Build and migrate explicitly before starting the API:

```powershell
docker compose --env-file .env.docker --profile api config --quiet
docker compose --env-file .env.docker --profile api build api
docker compose --env-file .env.docker up -d --wait postgres
docker compose --env-file .env.docker --profile api run --rm api migrate
docker compose --env-file .env.docker --profile api up -d --wait api
docker compose --env-file .env.docker --profile api ps
```

Ensure only one API process owns port 3001: the npm API and the container API use
the same browser/Vite proxy address. SQL remains the migration authority; the
container never runs Prisma migrations or resets the database on startup.
One-off `migrate` commands are transactional and retain all existing data.
The API healthcheck reads `/health`; authenticated board/document checks verify
the actual database-backed application path separately.

The explicit abandoned-asset cleanup command is available in the same image:

```powershell
docker compose --env-file .env.docker --profile api run --rm api cleanup
```

Its policy only deletes confirmed abandoned unfinished uploads.
All completed assets, including those used by drafts/recovery/undo, remain
retained. This command has no automatic schedule in the local Compose setup.

For persistence verification, prefer a disposable Compose project with a unique
project name, separate port overrides and its own newly created volume. Record
a board/document and database migration ledger through that project's API;
restart its database container, wait for database health, then restart its API
and verify the same board/document/revision and ledger through actual requests.
Replacing the API container also leaves PostgreSQL data intact. Retain proof
results and delete only the disposable project's named resources afterward.
Do not use `down -v` against `scribble-local`: that deletes the user's existing
database volume. Portable PostgreSQL on port 5433 stays outside this workflow.

For the existing project, an explicitly authorized sequential restart uses:

```powershell
docker compose --env-file .env.docker restart postgres
docker compose --env-file .env.docker up -d --wait postgres
docker compose --env-file .env.docker --profile api restart api
docker compose --env-file .env.docker --profile api up -d --wait api
```

Verification (2026-10-05): the image built successfully with Prisma generation
and the server build. A runtime smoke check ran as UID 1000, loaded the generated
client, encoded a PNG through Sharp and confirmed no `.env.docker` in the image.
The reusable proof below passed 36 checks against a new isolated Compose project:
authenticated API reads, preserved row/revision/JSON/ledger fingerprints after
an API restart, an actual PostgreSQL container restart, and `down`/`up` container
recreation while retaining that project's volume. Unauthenticated reads stayed
blocked throughout. The proof verified the normal app role, used no ImageKit
settings and removed only the exact disposable project's resources after
checking its volume labels. The existing project/volume and portable database
were not restarted or modified.

```powershell
node scripts/docker-persistence-proof.mjs
```

Build `scribble-api:local` before running the proof. The script allocates random
loopback ports, an ignored temporary credential file and a new project/volume;
it never reads existing credentials into its test stack or prints passwords or
connection URLs. Its cleanup preserves every other Docker project. A local
container proof does not verify production deployment or Google OAuth redirects
from a deployed API.
Image guidance: [official Node images](https://github.com/nodejs/docker-node),
[Node container practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md).
