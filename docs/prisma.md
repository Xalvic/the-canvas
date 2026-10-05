# Prisma in Scribble

Implemented and verified on 2026-10-05. Prisma Client, its PostgreSQL adapter,
and the CLI are pinned to 7.10.0. Prisma 7 remains supported; the npm latest tag
was Prisma 8's release candidate when this integration was performed.

## What it does

PostgreSQL stores our boards, documents, users and sessions. Prisma is the
backend library we use to query those tables from TypeScript. Its schema maps
database tables/columns to models/fields; generating the client turns that map
into typed query methods and result types. For example, the `Board` model maps
to `boards`, and `ownerId` maps to `owner_id`.

The [official Prisma 7 overview](https://www.prisma.io/docs/orm/v7) explains the
schema and generated client. The practical benefit here is autocomplete and
compile-time checking for ordinary database operations, with less manual SQL
and fewer separately maintained row types. Runtime request/document validation
still uses Zod, and PostgreSQL still enforces its constraints.

## One path: opening the account board list

```text
React / TanStack Query
  -> GET /api/boards
  -> Express verifies the session
  -> BoardStore.list(session.user.id)
  -> Prisma builds a PostgreSQL query
  -> PostgreSQL returns the owner's boards
  -> the store converts dates to API timestamps
  -> React displays the list
```

`server/postgresBoards.ts` now uses:

```ts
const rows = await prisma.board.findMany({
  where: { ownerId },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: { id: true, title: true, createdAt: true, updatedAt: true },
});
```

`findMany` asks for rows, `where` filters them, `orderBy` sorts them, and `select`
chooses the returned fields. TypeScript checks these fields against the generated
model. Authorization still depends on passing the verified session's owner ID;
Prisma does not add permissions automatically.

TanStack Query manages server data in the browser. Prisma queries the database
on the server. Zustand continues to hold the live canvas, and guest documents
continue to save in IndexedDB.

## Safe saves

`server/postgresDocuments.ts` uses Prisma's interactive `$transaction` API.
PostgreSQL locks the parent board and rechecks ownership, checks the expected
revision, writes the snapshot, and updates the metadata timestamp in the same
transaction. For example, two saves expecting revision 4 cannot both replace it:
one succeeds at revision 5, and the other receives the existing 409 conflict.

If the metadata update fails, the document write rolls back too. The transaction
callback's result is returned only after commit. Read committed isolation is
explicit, with a five-second acquisition wait and a ten-second transaction limit;
failures propagate to the existing draft/reconciliation flow without automatic
write retries. See [Prisma transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

We retain tagged, parameterized SQL through `$queryRaw` / `$executeRaw` for
row locks, conditional revision writes, atomic OAuth flow consumption,
database-clock expiry checks, and exact monotonic timestamps. This preserves
PostgreSQL's microsecond precision rather than round-tripping timestamps through
JavaScript's millisecond dates. Ordinary board operations, user upserts, session
creation/revocation and flow creation use typed model methods.

## One migration authority

The existing `db/*.sql` files and `server/migrations.ts` remain the only authority
for changing database structure. `schema_migrations` stays at versions 1/2/3/4;
its mapped model is excluded from Prisma Client. No new migration or Prisma
migration ledger was created by this integration.

Prisma's schema describes the existing UUIDs, JSONB, timestamp precision,
defaults, foreign keys, delete/update actions and partial owner index. The
`partialIndexes` preview feature is used to describe that existing index.
SQL CHECK constraints remain in the SQL migrations and PostgreSQL; Prisma does
not fully describe them. Do not use `prisma db push`, `migrate dev`, `migrate
reset` or `migrate deploy` in this repository while SQL owns migrations.

For a future schema change: add a numbered SQL migration and register it with
the existing runner, apply it to the chosen database, update the Prisma mapping,
regenerate the client, then validate the mapping and affected behavior.

## Files and commands

- `prisma/schema.prisma`: the model/table map.
- `prisma.config.ts`: CLI configuration; database commands load env files explicitly.
- `server/prisma.ts`: one client over the existing five-connection `pg` pool.
- `server/index.ts`: shares that client across stores and disconnects before closing the pool.
- `server/generated/prisma/`: generated TypeScript, ignored by Git and compiled into `dist-server`.

```text
npm ci                       # postinstall generates the client; no DB credentials needed
npm run db:generate          # regenerate after mapping changes
npm run db:validate          # validate the Prisma schema without accessing the DB
npm run db:check:docker      # read-only comparison against .env.docker
npm run db:migrate:docker    # existing SQL migration runner
npm run dev:server:docker    # existing API command, now using Prisma
```

`db:check` compares against `.env` instead. The comparison detects features
Prisma can represent; SQL constraints still need database tests. Its underlying
`migrate diff` command only compares, and does not apply migrations or alter data.
CLI transitive dependencies `deepmerge-ts` and `mysql2` have scoped overrides
to patched versions. Production dependency audit has zero reported vulnerabilities;
two pre-existing moderate Vitest development advisories remain outside this slice.

## Verification

382 fast tests, 41 real Docker PostgreSQL tests, server typecheck and both builds
passed. The cloud Postman collection was fetched unchanged and its 69 requests /
228 assertions passed locally against the compiled Prisma-backed API in a new
random schema; temporary accounts, schema and session environment were removed.
Development and compiled entrypoint startup/health/private-route checks passed,
and `npm ci` regenerated the client successfully without database credentials.

Read-only schema comparison reports no difference. Before/after fingerprints
match for every public board, document, user, session, OAuth flow and migration
row, plus all public constraints and indexes. Normal data and the portable
database were not modified. Browser tests were not rerun for this backend-only
change; live Google verification is the previously recorded user verification.
