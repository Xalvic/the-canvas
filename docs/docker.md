# PostgreSQL-only Docker setup

Status (2026-10-02): image downloaded and PostgreSQL started with approval.
The container is healthy; an authenticated Windows connection to port 5434
confirmed database `scribble`, PostgreSQL 18.6, and a normal `scribble` app role
without superuser, database-creation, or role-creation privileges. The named
volume is mounted. No application tables exist yet: migrations, restart
persistence testing, and API switching remain pending.
React and Express continue to run on npm. The portable database and its `.env`
stay separate.

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
The existing npm migration will create the application tables in a later step.

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

Next, ask permission to run migrations against the Docker connection and test
persistence. The app login has already been verified. The current npm scripts load the portable
`.env`; starting Compose alone does not switch them to `.env.docker`.
Database switching or importing existing data needs a separate explicit decision.

When approved to stop the Docker database, `docker compose --env-file .env.docker
stop postgres` retains its container and volume. `down` removes containers and
the network but retains the named volume. **`down -v` deletes the database volume**.
Changing initialization passwords or SQL files does not reconfigure an existing
volume; change an existing database explicitly rather than deleting its data.

References: [official PostgreSQL image](https://hub.docker.com/_/postgres),
[Docker volumes](https://docs.docker.com/engine/storage/volumes/),
[Compose networking](https://docs.docker.com/compose/how-tos/networking/),
[psql variables](https://www.postgresql.org/docs/18/app-psql.html).
