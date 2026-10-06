# Workspace UX M3: retry-safe page creation

Verified locally 2026-10-06. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`.
M4 is next. M0-M3 work is included in the user-authorized local commit.

## Request and response

`POST /api/boards` accepts either legacy `{title}` or the new strict shape:

```json
{
  "title": "Untitled",
  "requestId": "11111111-1111-4111-8111-111111111111",
  "initializeDocument": true
}
```

The new path atomically creates metadata, a version-one blank document
`{objects: []}` at revision 1, and a durable receipt. It returns HTTP 201 on first
creation and HTTP 200 on replay, with the existing metadata Location and no-store:

```json
{
  "board": {
    "id": "22222222-2222-4222-8222-222222222222",
    "title": "Untitled",
    "role": "owner",
    "createdAt": 1790000000000,
    "updatedAt": 1790000000000
  },
  "creation": {
    "requestId": "11111111-1111-4111-8111-111111111111",
    "documentRevision": 1,
    "replayed": false,
    "expiresAt": 1797776000000
  }
}
```

Titles are trimmed; request UUIDs are lowercase. New fields must be supplied
together; `initializeDocument` must be `true`. Rename remains strict `{title}`.
Legacy creation still returns 201 with `{board}`, creates metadata only, and
allows its first document save with `expectedRevision: 0`. Repeated legacy requests
still create independent boards. Existing auth, CSRF, proxy and rate guards apply.

**Replay acknowledges the original creation, not the current document.** Its
`documentRevision` is always the original revision 1; current title/role metadata
is returned, and later document edits are never reset. Controllers must read the
current document before enabling a recovered destination or submitting content.
Use existing CAS/operation APIs; revision-zero saves on initialized pages conflict.

## SQL, errors and retention

Migration **9**, `db/009_create_board_creation_receipts.sql`, adds only
`board_creation_receipts`. Its primary key is actor/request UUID; SHA-256 binds
canonical `{version: 1, title, initializeDocument}`. The transaction locks the
actor's user row before resolving/creating the receipt. All connections/processes
share this lock; no external network work runs inside it.

Receipts store actor/request, payload hash, nullable board FK, original revision,
creation time and expiry. The FK uses `ON DELETE SET NULL`, with a partial index
for live destinations. Page deletion retains identity; actor deletion cascades it.

| Status/code | Meaning |
| --- | --- |
| 400 `VALIDATION_ERROR` | Invalid/incomplete fields or creation fields on rename |
| 409 `CREATION_REQUEST_CONFLICT` | Same actor/request, different canonical payload |
| 410 `CREATION_DESTINATION_GONE` | Original destination was deleted |
| 410 `CREATION_REQUEST_EXPIRED` | The 90-day replay window ended |
| 404 `BOARD_NOT_FOUND` | Actor no longer has access to an existing destination |
| 503 `PAGE_CREATION_UNAVAILABLE` | Metadata-only fixture/store lacks atomic creation |

Errors retain the existing `{error: {code, message}}` envelope and auth/parser/rate
codes. Replay is supported for 90 days using the database clock. Compact identity
records remain indefinitely after expiry/deletion, with no TTL that treats an old
request as new. They contain no source drawing or copied document. This is needed
because local recovery intents have no age limit. Preserve local content on 410;
never automatically replace a terminal request with a new UUID. Any future cleanup
must retain identities and terminal behavior.

## Client and release boundary

`src/api/boards.ts` adds typed `createServerPage(input, signal)`, validates the
caller-owned identity and echoed receipt, and checks the 201/200 acknowledgement.
It performs no automatic retries or legacy fallback. Existing `createServerBoard`
and the current UI remain unchanged. M6/M7 will persist intent before dispatch.
No workspace navigation, guest transfer, image-provider change or UI redesign is
included. M4 starts with workspace state/read/update/initialization APIs; reuse
the actor lock in one transaction, without calling another `createPage` transaction
while already holding that lock. Next unused SQL migration number: **10**.

Release order remains migration -> compatible backend -> future frontend.
Old clients retain `{title}` compatibility. New clients must not silently downgrade
after unsupported/invalid responses. On rollback retain migration 9 and receipts;
older backend code ignores the additive table, and a compatible backend can later
resume new requests. No normal/production migration, push or deployment. The user
authorized one local commit of all current updates on 2026-10-06; future commits
require fresh approval.

## Validation

120 distinct focused HTTP/client cases pass across these files, run in focused
batches with affected files rerun after fixes:

```text
npm test -- server/pageCreation.test.ts server/app.test.ts server/boardAccess.test.ts server/production.test.ts src/api/boards.test.ts
```

83 distinct real PostgreSQL cases pass: creation 11, migrations 8, boards 6,
authentication 9, assets 19, sharing 16, collaboration 14. Each creates/drops only
a random schema. Reusable command (change `files` to the recorded batch):

```powershell
$m3DatabaseTests = @'
import { spawnSync } from 'node:child_process';
const files = ['server/postgresPageCreation.test.ts'];
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL },
});
process.exitCode = result.status ?? 1;
'@
node --env-file=.env.docker --input-type=module -e $m3DatabaseTests
```

Batches: creation/migrations/boards; corrected creation; auth/assets; corrected
auth/sharing; collaboration. Corrected fixture SQL casts UUIDs explicitly and
includes the new FK-dependent table when simulating older schemas.

Creation tests cover 12 concurrent retries across independent clients, mismatch,
actor isolation, current permissions, deletion/expiry, rollback, revision-one CAS,
and legacy behavior. Three **actual API processes** prove that an ignored creation
response is reconciled after restart and that deletion/restart never recreates it.
This is HTTP/API/PostgreSQL evidence; no browser or real Google journey is claimed.

Migration tests preserve populated legacy tables: owned/ownerless boards,
documents, users/auth flows/sessions, sharing, images, operation receipts and
budgets. Migration-9 failure rolls back and retries. SQL/Prisma migration diff
reports no drift in a disposable schema.

Passed: Prisma generation/validation, server typecheck/build, frontend build,
strict typecheck of touched server tests/process fixture, and `git diff --check`.
`workspace-ux-evidence/m3-database-isolation.json` records unchanged hashes/counts
for all 12 normal public tables (14 rows including the ledger), and zero disposable
schemas before/after. Initial fixture failures and corrected passes are recorded.
The existing Docker service remains running. Full integrated/physical acceptance
remains M11.
