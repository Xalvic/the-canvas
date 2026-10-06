# Workspace UX M4: workspace state and initialization

Verified locally 2026-10-06. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`.
Next: **M5 only**, retry-safe image uploads. M4 is local and uncommitted.

## API contract

All three routes require the existing account session, return HTTP 200 with
`Cache-Control: no-store`, and use the existing error envelope. Mutations require
JSON and `X-Scribble-Request: 1`, with the established same-origin checks. Production
proxy/IP and durable user read/write budgets run before the 16 KB metadata parser.
Private request logs classify these routes as `workspace` without bodies or IDs.

`GET /api/workspace` returns only the authenticated account's state:

```json
{"workspace":{"initialized":false,"lastOpenedBoardId":null}}
```

An account with no state row is uninitialized. GET never inserts state, initializes,
creates a page, or clears a stored preference. An inaccessible last-opened ID is
masked as null; board deletion clears it through the FK. Lists still use
`GET /api/boards`. A service/list failure must never be interpreted as emptiness.

`PATCH /api/workspace` accepts the strict shape below, with a UUID or null:

```json
{"lastOpenedBoardId":"22222222-2222-4222-8222-222222222222"}
```

It returns `{workspace}` and validates current owner/editor/viewer access under
the parent-board lock. Missing, ownerless, private, deleted or revoked destinations
return 404 `BOARD_NOT_FOUND` without changing the preference. Clearing with null
is allowed. A preference may be stored before initialization; this alone never
marks the account initialized. The last successful committed update wins across
devices. M6 must call this after successful opening and must not navigate the
current editor because another device changed the preference.

`POST /api/workspace/initialize` accepts a caller-owned stable UUID and mode:

```json
{
  "requestId":"11111111-1111-4111-8111-111111111111",
  "createInitialPage":true
}
```

```json
{
  "workspace":{"initialized":true,"lastOpenedBoardId":null},
  "board":{
    "id":"22222222-2222-4222-8222-222222222222",
    "title":"Untitled",
    "role":"owner",
    "createdAt":1790000000000,
    "updatedAt":1790000000000
  },
  "initialization":{
    "requestId":"11111111-1111-4111-8111-111111111111",
    "replayed":false,
    "initializedNow":true
  }
}
```

The first committed initialization creates one blank version-one document at
revision 1 only when `createInitialPage` is true and no accessible page exists.
Existing pages, including shared-only access, prevent default creation. Pending
invitations and ownerless legacy rows do not count. Mode false permanently
initializes without making a blank page, for the later explicit guest transfer.
Concurrent modes use the first committed initialization; subsequent requests
cannot upgrade false into automatic default creation.

`board` is a **current opening candidate**, nullable for an intentionally empty
workspace. Prefer the currently accessible last-opened page; otherwise choose
owned pages before shared pages, ordered by creation time then UUID. Initialization
does not mark that candidate opened. `initializedNow` is true only for the first
committed initialization; `replayed` identifies reuse of this actor/request UUID.
Different UUIDs after initialization return current state without another default.
Same UUID with a changed mode returns 409 `WORKSPACE_INITIALIZATION_CONFLICT`.

Replay returns current metadata/access, never the initial document or an assurance
that the original candidate still exists. Always fetch the current document before
editing. After final deletion, even an old initialization request returns an empty
workspace instead of recreating content. This differs from M3's page-creation
receipt, which identifies a particular destination and has terminal 410 responses.

Schemas reject incomplete/extra fields and normalize request/preference UUIDs to
lowercase. Existing 400 validation/parser, 401 session, 403 origin/proxy, 413 size,
415 media and 429 rate errors apply. A metadata-only application fixture without
the durable workspace store returns 503 `WORKSPACE_UNAVAILABLE`; clients never
fall back to legacy creation or manufacture a new request ID on error.

## Persistence and client boundary

Migration **10**, `db/010_create_workspace_state.sql`, adds `workspace_states`
(user PK, nullable initialization timestamp, nullable last-page FK) and compact
`workspace_initialization_receipts` (actor/request PK, boolean mode, database
creation timestamp). Last-page deletion uses SET NULL and retains initialization;
user deletion cascades both tables. A partial index supports last-page deletion.
Receipts contain no drawing data and have no expiry; retained local intents remain
recognized indefinitely, including payload conflicts after deletion. Do not clear
initialization state or remove receipt identities during rollback/cleanup.

One transaction serializes initialization, explicit M3 page creation, and preference
writes using the same actor-row `FOR NO KEY UPDATE` lock. It permits foreign-key
KEY SHARE checks from board-locked sharing transactions. Blank-page insertion is
shared with M3 and runs inside the caller's transaction, with no nested transaction
or provider call. Workspace board reads use shared parent locks and recheck current
membership after waiting; existing mutation locks retain their exclusive behavior.
This prevents sharing/FK and crossed revoked-preference lock cycles.

`server/postgresWorkspace.ts` implements the store; `server/app.ts` mounts the
routes and `server/index.ts` supplies it. Prisma mappings match SQL. Typed adapters
in `src/api/workspace.ts` validate inputs, request echoes, current-state consistency
and HTTP acknowledgements, preserve AbortSignal and session/service distinctions,
and perform no automatic retries. M6/M7 will persist intents and wire navigation;
the current UI, guest storage, canvas, images and Google flow are unchanged.

Release order: migration 10 -> compatible backend -> future workspace frontend.
Keep M3's migration/receipt compatibility and retain additive tables on rollback.
No normal/production database migration, provider change, commit, push or deployment
was performed. Next unused migration number: **11**.

## Local validation

171 focused HTTP/client cases passed:

```text
npm test -- server/workspace.test.ts src/api/workspace.test.ts server/pageCreation.test.ts server/app.test.ts server/boardAccess.test.ts server/production.test.ts src/api/boards.test.ts
```

119 distinct real PostgreSQL cases passed in focused batches: workspace 21,
migrations 9, page creation 11, boards 6, authentication 9, sharing 16, documents 14,
collaboration 14 and assets 19. Reusable command; change `files` for a recorded batch:

```powershell
$m4DatabaseTests = @'
import { spawnSync } from 'node:child_process';
const files = ['server/postgresWorkspace.test.ts'];
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL },
});
process.exitCode = result.status ?? 1;
'@
node --env-file=.env.docker --input-type=module -e $m4DatabaseTests
```

Batches: workspace/migrations/page-creation/boards/auth/sharing; final shared-read
workspace/page-creation/sharing/documents/collaboration; corrected collaboration/
assets; final workspace. Older auth/sharing fixture teardown includes new FK tables;
ledger assertions include version 10. An initial new ledger comparison incorrectly
assumed JSON sorting preserved numeric version order; its corrected pass validates
migration rollback, existing data/creation receipts and workspace constraints.

Coverage includes different/identical/mixed-mode concurrent requests, independent
clients, actor isolation, aged receipts, no-blank import, ownerless/invitation
exclusion, viewer/editor preferences, revocation, fallback, intentional final
emptiness, rollback at document/state/receipt insertion and lock-order regressions.
Two actual API processes initialize concurrently; ignored-response reconciliation,
persisted preference and deletion are checked through two further process restarts.
SQL/Prisma no-drift passes in a disposable schema through the M3 creation test.

Both production builds, Prisma generation/validation, server typecheck, strict
typechecks of touched server tests/process fixtures and diff validation pass.
`../workspace-ux-evidence/m4-database-isolation.json` records identical definitions/
data fingerprints for all 12 normal public tables/14 rows and zero disposable
schemas before/after. Docker 5434 remains running. This is local API/database
evidence; browser navigation and physical/production acceptance remain later gates.
