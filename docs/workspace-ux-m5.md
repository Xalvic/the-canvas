# Workspace UX M5: retry-safe image uploads

Verified locally 2026-10-06. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`.
Next: **M6 only**, account lifecycle and workspace navigation. M4/M5 are uncommitted.

## Contract

New callers send raw JPEG/PNG/WebP bytes to `POST /api/boards/:id/assets` with
`X-Scribble-Upload-Request: <stable UUID>` and the existing `X-Scribble-Request: 1`.
Persist the UUID and immutable source intent **before** dispatch. Reuse the same
account, destination, UUID, MIME and original bytes after an unknown response.
Never fall back to legacy upload or manufacture another UUID on an error.

The request identity is unique per uploader/destination/UUID. Its SHA-256 hash
covers the declared MIME, a zero separator, and the **original** image bytes;
different originals that normalize to the same image still conflict. Both new
routes normalize board/request UUIDs. Changed content returns HTTP 409
`ASSET_UPLOAD_REQUEST_CONFLICT` before a new reservation or provider write.

Ready POST responses use HTTP 200, pending POST responses HTTP 202. `Location`
points to `/api/boards/:id/asset-uploads/:requestId`. All responses are no-store.
The envelope is:

```json
{
  "upload": {
    "requestId": "11111111-1111-4111-8111-111111111111",
    "boardId": "22222222-2222-4222-8222-222222222222",
    "assetId": "33333333-3333-4333-8333-333333333333",
    "state": "pending",
    "canRetry": true,
    "retryAfterMs": 5000,
    "asset": null
  }
}
```

Ready state has `canRetry: false`, `retryAfterMs: null`, and the existing public
asset metadata in `asset`. It contains no signed URL, provider ID/path, content
hash, account ID or lease token. Status/replay consumes no signing/bandwidth budget.

`GET /api/boards/:id/asset-uploads/:requestId` returns HTTP 200 with this envelope.
It may reconcile an existing provider file and finalize the original reservation,
but **never sends image bytes or creates a provider file**. A missing request or
another actor's request returns 404 `ASSET_UPLOAD_NOT_FOUND`. Both POST and GET
require the original actor's **current edit access**; viewers receive 403, missing,
private/deleted/revoked boards 404. Finalization and write admission recheck access
after provider reads. The existing session, mutation-origin checks, production
proxy and durable read/write/IP admission protect these routes before parsing.

Pending is uncertainty, not confirmed absence or failure. `canRetry` permits a
later POST with the same bytes/identity. Honor `retryAfterMs` and HTTP `Retry-After`;
these range from 1 ms to 90 seconds. After three admitted provider writes,
pending has `canRetry: false`; bounded status reads can still recover a delayed
write. Stop sending bytes, preserve the source, and surface recovery to the user.
Adapters perform one HTTP request, with cancellation and a 90-second deadline.
They do not poll, retry, create intent IDs or silently fall back.

Cleanup produces terminal `failed` status with the original `assetId`, null asset/
delay and `canRetry: false`; a deleting reservation is already terminal for replay.
POST returns 410 `ASSET_UPLOAD_EXPIRED`. Retain that request identity indefinitely;
an old intent cannot allocate another asset or resurrect a cleaned upload. A user
may explicitly start a separate new intent after acknowledging this terminal state.
Do not silently replace the original request identity.

Without the new header, legacy clients still get `201 {asset}`. The existing
manual UI/session upload path remains on this legacy contract until M8. Completed
local-to-cloud mappings, IndexedDB v4 journals, documents, undo and guest use are
unchanged. New adapters are `uploadBoardAssetRequest` and `getBoardAssetUpload` in
`src/api/assets.ts`; M7/M8 own durable intent and automatic upload orchestration.

## Persistence and reconciliation

Migration **11**, `db/011_add_asset_upload_identity.sql`, adds nullable request ID,
content hash, lease token/expiry and a bounded attempt counter to `board_assets`.
Legacy rows default to null identities/leases and zero attempts. A unique
uploader/scope-board/request key survives board deletion through the existing
scope ID. Existing rows and provider identities remain unchanged. PostgreSQL
checks enforce paired identity/hash, 64 lowercase hex digits, 0-3 attempts, and
a lease expiry whenever a token exists. SQL owns migration history; Prisma maps
the additive fields/index and startup checks require the new columns.

Reservation/replay, lease acquisition, provider-write admission and finalization
use short transactions with the existing storage-then-board lock order. Replay
resolves the existing row **before** storage/hourly/daily quota admission. No DB
transaction spans a provider call. A 90-second database-clock lease fences API
processes; only its current token can admit a write or finalize. Releasing a stale
token cannot release a newer lease. Completed attempts have a durable five-second
cooldown. API crashes recover after lease expiry, using the persisted original path.

Every keyed provider attempt first looks up that exact path. A known file is
validated/finalized without upload. Lookup errors keep the reservation pending;
they never count as absence. Confirmed absence permits a bounded same-path upload,
with the attempt counter committed beforehand. An uncertain upload triggers at
most one additional lookup in that request. Uncertain DB finalization likewise
keeps its file and reserved bytes for later reconciliation. Metadata mismatches
return 502; permission failures retain their 403/404; provider/DB details stay private.

The ImageKit adapter already disables SDK retries, unique filenames, overwrites
and public files. Duplicate-path rejection prevents a delayed write and retry
from creating two files; the follow-up lookup recovers the original file. This
depends on the provider's create-at-exact-path guarantee, verified against
[ImageKit's official upload options](https://imagekit.io/docs/integration/javascript).
Provider network timeout remains 30 seconds. No real provider settings/files
were mutated during M5; tests use a separate controlled loopback provider.

All existing upload/storage/signing allowances remain. Replay reserves no second
slot or bytes. The independent pre-decode process gate still bounds request count
and memory, so repeated POSTs may receive 429; use bounded status lookup to resolve
an existing request. Production HTTP admission remains independent of asset quotas.

Cleanup excludes active leases and recently reconciled keyed pending rows. After
24 hours of inactivity it claims only unfinished uploads; it releases storage
only after confirmed deletion/absence. Ready assets, including unreferenced
draft/undo assets and previously referenced assets after document removal or board
deletion, remain retained. Failed rows retain their immutable request identity.

Release order: migrations 9-11 -> compatible backend -> M7/M8 frontend. Keep
additive columns and retained identities on rollback; an old backend must not
clean active keyed uploads. No normal/production migration, provider change,
commit, push or deployment was performed. Next unused migration: **12**.

## Verification

170 focused client/HTTP/image/session cases passed:

```text
npm test -- server/imageAssets.test.ts server/imageKit.test.ts src/api/assets.test.ts server/imageValidation.test.ts src/persistence/accountBoardSession.test.ts server/app.test.ts server/boardAccess.test.ts server/production.test.ts
```

141 distinct real PostgreSQL cases passed in two focused batches. First batch:
assets 19, migrations 9 (plus the initial 19-case upload run). Final batch: uploads
22, workspace 21, page creation 11, boards 6, auth 9, sharing 16, documents 14,
collaboration 14. Run a recorded batch using:

```powershell
$m5Tests = @'
import { spawnSync } from 'node:child_process';
const files = ['server/postgresAssetUploads.test.ts','server/postgresAssets.test.ts','server/migrations.test.ts'];
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs','run',...files], {
  stdio:'inherit', windowsHide:true,
  env:{...process.env, TEST_DATABASE_URL:process.env.DATABASE_URL},
});
process.exitCode = result.status ?? 1;
'@
node --env-file=.env.docker --input-type=module -e $m5Tests
```

Change `files` for the final batch listed above. The new suite is also included
in `scripts/test-database.mjs`. It runs real HTTP handlers and Prisma/PostgreSQL
with a controlled immutable-path provider. Two independent API processes race
the same request, then reconcile discarded responses after restart. A separate
case kills the API after the provider stores bytes and before it returns; the
restart respects the active lease and recovers the file after expiry. Tests move
disposable lease timestamps forward rather than waiting 90 seconds.

Other gates cover changed original bytes, temporarily empty lookup/existing-path
rejection, provider lookup failure, path/size mismatch, three-attempt exhaustion,
stale-token fencing, revocation before/after I/O, actor/board isolation, full quotas,
cleanup/terminal identities, ready retention, legacy uploads, reservation and
finalization rollback, migration rollback/defaults/constraints and SQL/Prisma
no-drift. Parser/session/proxy/durable HTTP-admission checks precede provider work.

`npm run build`, `npm run build:server`, Prisma generation/validation, strict
typechecks of touched tests/fixtures and `git diff --check` pass. The frontend build
retains its existing Zod annotation and chunk-size warnings. No dependency change.
`../workspace-ux-evidence/m5-database-isolation.json` records identical definition/
data fingerprints for all 12 normal public tables/14 rows and zero disposable
schemas before/after. The reusable audit script is beside that JSON. Docker 5434
remains running. Browser UI integration, real-provider acceptance, physical-device
checks and deployment are later milestone/release gates.
