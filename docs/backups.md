# Encrypted PostgreSQL backups and restore drills

`scripts/backup.mjs` streams a consistent PostgreSQL custom-format dump directly
through AES-256-GCM. Only ciphertext is written to disk. Each archive uses a fresh
12-byte nonce and has a SHA-256/size manifest; the authentication tag detects
tampering or the wrong encryption key. Manifests contain format, creation time,
size and digest, without database URLs or row values. Archives are created
exclusively: an existing backup is never replaced.

Use a direct PostgreSQL connection for backups, rather than a transaction-pooler
endpoint. `DIRECT_DATABASE_URL` takes precedence over `DATABASE_URL`. Remote URLs
must specify `sslmode=verify-full`; system CA roots are the default. PostgreSQL 18
tools can dump PostgreSQL 18 or older supported servers, but not a newer major
version. Review the server/tools major version before changing a hosted database.
See the official [pg_dump documentation](https://www.postgresql.org/docs/18/app-pgdump.html)
and [TLS verification documentation](https://www.postgresql.org/docs/18/libpq-ssl.html).

## Secrets and storage

Generate a 32-byte random encryption key locally and store its 64 hexadecimal
characters as `BACKUP_ENCRYPTION_KEY` in a secret manager or a private, ignored
environment file. Do not paste keys or database URLs into chat, shell command
arguments, Git, manifests or logs. Keep a recoverable copy of the key separate
from the backup storage. Losing the key makes the archive unrecoverable.

Set these environment variables in the private environment file:

```text
DIRECT_DATABASE_URL=<direct PostgreSQL URL with sslmode=verify-full>
BACKUP_ENCRYPTION_KEY=<64 hexadecimal characters>
BACKUP_FILE=<unique absolute archive path>
```

The host utility requires Node, Docker and the built utility image below;
`node --env-file=<private file> scripts/backup.mjs` invokes the image's PostgreSQL
18.6 tools and installed CA roots in an ephemeral
container. PostgreSQL passwords reach tools through their environment, never
command arguments. Docker administrators can inspect container environment:
restrict Docker/host access. Tool diagnostics are suppressed because they can
contain private database values. Local loopback URLs need a reachable container
hostname/network; the proof supplies its isolated Docker network explicitly.

For a scheduled Linux job, build the dedicated utility image:

```sh
docker build -f docker/backups/Dockerfile -t scribble-backups:local .
```

Run `node /opt/scribble/backup.mjs` inside that image, with a private environment
file and a writable mounted backup directory. The image runs as the PostgreSQL
user, UID 999; grant only that user write access to the directory. Use a unique
timestamped `BACKUP_FILE` for each run. The utility emits only success/size or a
sanitized failure. The Docker database directory must never be mounted into this
utility. Schedule locally with a systemd timer or the host's scheduler; no job is
installed or external storage purchased by this implementation.

`scripts/scheduled-backup.mjs` supplies a timestamp/UUID archive name from
`BACKUP_DIRECTORY` and invokes the same backup path. The production systemd
template uses a private ignored `.env.backup` containing that directory, the
direct connection and encryption key. Build `scribble-backups:local` on the
scheduler host before enabling the job. A timer firing is not evidence of a
successful recoverable backup: inspect its exit status and repeat a restore
drill using the resulting archive and manifest.

A recommended initial operating target is a daily successful backup, a monthly
isolated restore drill, and retention of seven daily and four weekly copies.
These are proposed targets, not verified production RPO/RTO guarantees. Transfer
ciphertext plus its manifest to separate access-controlled storage and alert on
missed/failed backups. Retention deletion needs a deliberate storage policy;
these scripts never delete old backups. Hosted provider point-in-time recovery
can supplement this process, but should be tested independently.

## Restore into a new empty database

Restore never reads `DATABASE_URL` as its target. Configure `RESTORE_DATABASE_URL`
explicitly and set `RESTORE_EMPTY_TARGET=YES`. Prefer a new isolated database or
provider branch that the application cannot write to during the drill. Stop
other writers for the target. Restoring over a live or populated database is
intentionally unsupported.

```text
BACKUP_FILE=<absolute encrypted archive path>
BACKUP_ENCRYPTION_KEY=<the backup's original key>
RESTORE_DATABASE_URL=<new empty database URL with sslmode=verify-full>
RESTORE_EMPTY_TARGET=YES
```

Run `node --env-file=<private restore file> scripts/restore.mjs`, or execute
`node /opt/scribble/restore.mjs` in the utility image. It privately snapshots the
ciphertext, verifies the manifest, authenticates the entire archive, verifies
the PostgreSQL custom header and asks `pg_restore --list` to parse it before
connecting to the target. It refuses user tables, views, sequences, functions,
types, extra schemas and extensions. Plaintext remains in streamed memory.
Restoration uses `--single-transaction --exit-on-error --no-owner --no-acl`,
without destructive `--clean` or `--create`. Errors roll back the restore.
Only restore archives made by this project and trusted operators: database
archives contain executable SQL. See [pg_restore documentation](https://www.postgresql.org/docs/18/app-pgrestore.html).

Database roles and grants are not included. Provision the target migration and
application roles separately; the restore role owns restored objects. After a
successful drill, compare migration versions, table counts/fingerprints and
board revisions, then exercise authenticated reads in a separately configured
test API. Never switch production traffic merely because a dump restored.

## ImageKit and other recovery limits

A PostgreSQL dump contains image asset metadata and provider file IDs/paths,
not ImageKit binary files. Retain ImageKit originals while any board, local draft
or undo/recovery path may need them. A database restore cannot recover an image
already deleted from its provider. Maintain a separate provider export/retention
procedure with an access-controlled inventory that maps exported originals to
asset IDs and original provider paths; test a sample image recovery before
claiming full application recovery. No provider export or destructive image
cleanup is run by the database backup utility.

Browser IndexedDB guest boards and account drafts are device-local and are not
part of the server dump. Sessions and pending OAuth flow rows *are* present in
the encrypted dump: protect access to restored databases and do not expose a
drill instance publicly. Deployment artifacts, OAuth/ImageKit credentials,
encryption keys, DNS and configuration also need their own recovery procedure.

## Executed isolated proof

`node scripts/backup-restore-proof.mjs` creates two disposable PostgreSQL 18.6
containers on a uniquely labeled Docker network, independent labeled volumes,
and random loopback ports. It dynamically applies the repository's SQL
migrations and populates all current application tables, including auth,
sharing, assets, idempotent operation receipts and durable API admission
budgets. It never connects to portable PostgreSQL on 5433 or the application's
Docker database on 5434.

The executed proof passed 15 checks against 12 populated tables with migrations
1–8: short-key/unverified-remote-TLS refusal, encrypted backup success,
existing-output refusal, wrong-key rejection,
authenticated ciphertext-corruption rejection, unchanged empty targets after
both failures, explicit-target confirmation, exact restored table fingerprints
(including board revision 17), nonempty-target refusal, and an unchanged source.
Only ciphertext/manifests exist in its temporary directory. Cleanup verifies
each exact resource's unique proof label before removing those disposable
containers, volumes and network.

This is a local PostgreSQL restore proof. Actual hosted-network TLS, scheduled
job delivery, off-host storage, ImageKit restoration and production recovery
timings remain to be verified after the hosting configuration is chosen.
