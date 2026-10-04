# Canvas document storage design

Status: validation/adapters and owner-protected local pg document GET/PUT
implemented, 2026-10-04. Migrations 1–4 are applied to Docker PostgreSQL on port 5434.
Revision conflicts, rollback, round trips, and an actual API process restart are
verified. Google-only authentication is implemented and configured locally;
live sign-in/reload/sign-out were user-verified in Chrome on 2026-10-04.
Board ownership is implemented. Prisma, frontend document save/load,
guest upload, and cloud deployment remain pending. Guest IndexedDB still saves
independently. See [authentication setup](authentication.md).

## Decision

Use relational board metadata plus one JSONB canvas snapshot per board. Retain
`boards` for IDs, titles, and timestamps. Add a separate `board_documents` table
through migration 2. A board can have metadata before its first
document save; the new row is created only by an explicit save.

This suits the first single-editor save/load feature. Object-level concurrent
editing and real-time collaboration will require another design slice.

## Compare the options

| Model | Queries and writes | Collaboration and permissions | Complexity and schema changes |
| --- | --- | --- | --- |
| Row per canvas object | Easy object queries and smaller individual writes; multi-object actions need transactions | Useful foundation for object operations, but merge/conflict rules still needed; could support object permissions | More tables or typed payloads, relationships, and save coordination |
| Whole board mainly in JSONB | Simple snapshot replacement; listing titles and ownership would mix relational concerns with document data | Whole-document conflicts; object permissions need application logic | Flexible object shapes, but explicit format versions and validation remain necessary |
| Relational metadata plus JSONB content | Fast metadata listing without loading drawings; content saves replace one snapshot | Start with board-level ownership and whole-document conflicts | Fits current editor snapshots while keeping future users/assets relational |

Choose the hybrid. Do not add JSONB indexes until a real query needs them. The
primary key is enough to load a document by board ID. Full snapshots cost bandwidth
and rewrite/lock a document row; keep writes off pointer-move paths and measure
large-board behavior before increasing limits. JSONB supports querying/indexing,
but changing a JSONB value still locks its whole row.
[PostgreSQL JSONB documentation](https://www.postgresql.org/docs/18/datatype-json.html)

## Current source and the save boundary

- `src/store/documentStore.ts`: `DocumentSnapshot` is a map from object ID to
  `CanvasObject`; past/future history is separate.
- `src/canvas/objects/types.ts`: card, text, frame, image, stroke, and connector
  shapes, including coordinates, sizes, zIndex, timestamps, and group IDs.
- `src/persistence/localBoardStorage.ts`: the guest record stores this map,
  local metadata, schema version 1, and viewport under `current-board`.
- `src/assets/assetStore.ts`: image Blobs are separate records referenced by
  `assetId`. Object URLs are temporary display resources.
- `src/persistence/useLocalBoardPersistence.ts`: existing local autosave uses a
  500 ms debounce and serialized saves. Preserve this guest path.

Persist committed document content: object identity/type, world positions and
sizes, zIndex, text/style, group membership, frame settings, connector references,
stroke points/dynamics, and eventual durable image asset references.

Keep selection, active tool, hover, pointer/drag/resize drafts, and undo/redo stacks
out of the server document. Pan/zoom are per-device preferences; preserve them
in local storage rather than making collaborators share a camera. Screen
coordinates are not document coordinates. Loading a document must not replay
edits or manufacture history entries.

## Proposed document format

For network/storage version 1, use `content: { objects: CanvasObject[] }`.
Serialize `Object.values(snapshot)` and rebuild the object map by ID on load.
Validate unique object IDs before rebuilding it; never silently overwrite a
duplicate. Preserve array order and each object's zIndex. JSONB does not preserve
object-key order, so the wire array avoids relying on the current map's key order.
This adapter does not change the guest IndexedDB schema.

Example content for one note:

```json
{
  "objects": [
    {
      "id": "note-1",
      "type": "card",
      "x": 100,
      "y": 80,
      "width": 248,
      "height": 172,
      "zIndex": 1,
      "title": "Ideas",
      "body": "First sketch",
      "createdAt": 1790930000000,
      "updatedAt": 1790930000000
    }
  ]
}
```

The example object ID is independent of the server board UUID. Keep the format
version in the document row/API envelope, rather than duplicating it inside
`content`. It is also independent of the existing guest-record schema version.

## Document table (migration 2)

| Column | Type / rule | Purpose |
| --- | --- | --- |
| `board_id` | UUID primary key; foreign key to `boards.id`, delete cascades | At most one current document per existing board |
| `schema_version` | Integer, required, positive | Meaning of the stored document shape; initially 1 |
| `revision` | Integer, required, positive | Server-controlled save counter; initially 1 |
| `content` | JSONB, required; object containing an `objects` array | Canvas snapshot |
| `updated_at` | timestamptz, required, server-generated | Last successful document write |

SQL validates the outer object/required array and relational constraints; the API
validates supported schema versions, all object variants, finite numbers, sizes,
opacity/pressure ranges, string/point limits, unique IDs, and connector references
to existing text/card nodes with valid anchors. Do not silently drop unknown
fields or object types and then save a reduced document. Define a canonical
schema with explicit optional defaults and reject unsupported formats.

Metadata fields remain in `boards`; a document save cannot rename a board from
an older snapshot. Update `boards.updated_at` and the document row together in
the same transaction after a successful save. Do not use client timestamps as
the revision/conflict authority.

## Implemented local API and conflicts

These routes work against the migrated local PostgreSQL database. The cloud
Scribble API collection now includes a verified Documents folder; its baseUrl
still points to the loopback API, not a deployed service.

- `GET /api/boards/:id/document`: return `{ document: ... }` with `boardId`,
  `schemaVersion`, `revision`, `content`, and server-generated `updatedAt`.
  Distinguish a missing board from metadata with no saved document; return 404
  with the appropriate error code. Do not imply missing content is a saved blank
  drawing.
- `PUT /api/boards/:id/document`: accept `schemaVersion`, `expectedRevision`,
  and `content`. The server owns the new revision. `expectedRevision: 0` means
  an explicit first save; create revision 1 atomically if no document exists.
  Subsequent saves must match the current revision and increment it by one.
  Return 201 for creation or 200 for an accepted replacement.
- Use an atomic conditional insert/update, with board existence checked inside
  the transaction. A revision mismatch returns 409 with the current revision;
  missing resources return 404, invalid content/version returns 400, and oversized
  requests return 413. Roll back all writes on failure.

Example: two clients read revision 3. One saves and receives revision 4. The
other's save with `expectedRevision: 3` is rejected; revision 4 is preserved.
This prevents silent last-writer-wins replacement. It does not merge edits.

Enforced limits: a route-specific 1 MiB JSON body limit, 5,000 objects, and
100,000 total stroke points; all limits apply, whichever is reached first.
These are starting limits to measure, not verified capacity guarantees.
The document routes precede the existing 16 KiB metadata parser; PUT has its own
1 MiB parser. Metadata limits are unchanged. expectedRevision accepts integers
from 0 through 2,147,483,646, leaving room for PostgreSQL's integer increment.
A document at revision 2,147,483,647 can still be read but needs a future counter
migration before another save; overflow is rejected during request validation.

## Frontend save flow

Keep guest IndexedDB saves free and independent. Account save/open is implemented
in `src/persistence/accountBoardSession.ts` and the Server boards panel, using
the existing protected API. It offers an explicit account-save/upload choice.
The local `current-board` identity must not become a server UUID or an owner ID
by assumption; create/select the server board and maintain a separate association.
Never upload the guest board merely because the user logged in.

For an opted-in server document, observe durable document changes, debounce after
committed actions, and keep at most one save in flight per editor. Capture the
snapshot and a local edit generation. On success, advance the server revision;
mark saved only if that generation is still current, otherwise save the newest
queued snapshot next. Pointer frames stay transient. Undo/redo changes the saved
content but does not create extra history entries through persistence.

Owner/board-scoped IndexedDB records retain the baseline revision/document/title
and any pending submitted snapshot. Startup opens the guest board; explicitly
opening an account board recovers its unsaved draft and checks the server revision.
Reload backs up the exact latest draft before adoption, repeating the backup if
edits arrive while it is writing. Restore previous draft and save-as-new are
explicit recovery actions. Account writes never replace the guest record.

On a network failure, retain edits and expose retry. A lost response leaves the
result uncertain: refetch and compare the canonical submitted snapshot before
retrying. If it matches, adopt the returned revision and continue; otherwise show
a conflict. Never automatically retry a conflicting full snapshot against a
newer revision. Initial conflict recovery offers retaining a local copy or
explicitly reloading the server copy, not silent overwrite. Confirm before
replacing unsaved local work on load. A browser closing mid-save is not guaranteed
to finish a network write; IndexedDB remains the local fallback.

## Images and ownership

Persist image `assetId` references, never Blobs/base64/object URLs in the JSONB
snapshot. Cloud images need a separate durable asset service and validated
board/user ownership. The first local backend proof supports non-image documents
only and explicitly rejects image-containing saves until assets are available;
do not silently omit images or accept unresolved device-local references.
Guest image editing/storage stays unchanged.

The document row inherits authorization through its board. No fabricated user
or client-supplied owner ID is trusted. Keep the first unauthenticated proof
loopback-only; authentication and board ownership precede public document routes
and account-save UI. Neon deployment remains a later slice.

## Small implementation sequence and verification

1. Define the document validator and array/map adapters. Verify all non-image
   types, reference consistency, order/zIndex, defaults, and unknown versions.
2. Migration 2 and the ordered runner are implemented, verified in isolated
   schemas, and applied to normal Docker PostgreSQL. Existing board metadata and
   migration 1 are preserved; no document rows are created.
3. Local document read/save using `pg` is implemented and tested for first save,
   replacement, invalid bodies, deletion, competing saves, response failure after
   commit, and rollback without damaging metadata.
4. All five supported types round-trip through HTTP/JSONB/adapters. An actual API
   restart retained content/revision/timestamps; the cloud Scribble Postman
   collection is updated and verified. Actual Docker database-process restart
   persistence remains to be checked in a separate controlled exercise.
5. Introduce Prisma after tracing this SQL; preserve constraints, API behavior,
   data, and a single clear migration authority. Auth/ownership and assets then
   enable explicit frontend account saves.

## Implemented validator and adapters

`server/contracts/canvasDocument.ts` defines the shared, pure version-1 envelope.
`src/persistence/canvasDocument.ts` re-exports it for the existing browser imports:
`{ schemaVersion: 1, content: { objects: [...] } }`. It validates all five
non-image types, rejects unknown fields/types/versions and images, checks finite
numbers, positive dimensions/widths, bounded appearance/dynamics, unique IDs,
and connector references. Both endpoints must target distinct existing cards or
text nodes; forward references are allowed because references are checked after
all objects are validated. Group IDs label groups and are not object references.

Limits: 5,000 objects, 100,000 total stroke points (at least one per stroke),
256 characters per nonblank object/group/reference ID, 100,000 characters per
text/title/body field, and 128 characters per nonempty color string. Colors
remain strings as in the editor; validation does not restrict them to the palette.
Coordinates and zIndex remain finite numbers without rounding or sorting;
timestamps must be finite and nonnegative. No text or IDs are trimmed/truncated.
The endpoint now enforces the 1 MiB HTTP body limit as well.
Strings reject NUL characters and unpaired Unicode surrogates before JSONB writes;
valid Unicode pairs (including emoji) are preserved. These restrictions match
[PostgreSQL JSONB Unicode requirements](https://www.postgresql.org/docs/18/datatype-json.html).

Missing text styles use the current legacy rendering defaults: color `#252622`,
font size 17, font weight **550**, left alignment, and opacity 1. Missing stroke
mode/opacity become `draw`/1. Explicit styles are preserved. Missing group IDs and
point pressure/widthRatio/velocity stay absent; inventing dynamics would change
legacy stroke appearance. Invalid/null values are rejected, not defaulted.

Trace the code path one step at a time:

1. `serializeDocumentSnapshot(snapshot)` in
   `src/persistence/canvasDocumentAdapters.ts` takes `Object.values(snapshot)`
   in map enumeration order. It validates the envelope and checks that each map
   key matches its object ID. The result is a detached, canonical document.
2. `canvasDocumentSchema.parse(value)` checks fields, then IDs/point totals and
   cross-object references. Failure throws a Zod error with issue paths;
   `safeParse` provides a result without throwing. Nothing is partially accepted.
3. `deserializeCanvasDocument(value)` validates the full envelope before
   rebuilding the map with `Object.fromEntries`. It returns data without calling
   `loadDocument` or changing editor, selection, history, viewport, or persistence.

JavaScript records enumerate array-index IDs numerically before other keys.
Incoming array orders that cannot survive that map conversion are explicitly
rejected rather than silently reordered. Current editor-generated UUIDs are
unaffected. Representable numeric-ID orders and special own-property IDs such
as `__proto__` round-trip safely.

Inspect `src/persistence/canvasDocument.test.ts` for JSON round trips of every
non-image field, legacy defaults, detached copies, rejection boundaries, and
guest-image/history/selection isolation. Run:

```text
npm test -- src/persistence/canvasDocument.test.ts src/persistence/localBoardStorage.test.ts src/store/documentStore.test.ts
npm run build
npm run typecheck:server
```

Verified: 117 tests (103 new validator/adapter cases), frontend type checking and
production build, and server type checking. Vite emitted two dependency-comment
annotation warnings from Zod; the build passed. No existing persistence/store
code, dependency, database, or endpoint changed. The validator/adapters are not
wired into the app yet.

The following endpoint slice shares this canonical schema with Node; the browser
adapters remain unwired to the editor.

## Migration 2 and SQL walkthrough

`db/002_create_board_documents.sql` creates the table. Migration 1 is unchanged.
`server/migrations.ts` uses an explicit ordered list of pending versions. This
slice added version 2; the later Google authentication slice adds version 3
through the same runner:

```text
BEGIN -> acquire existing transaction advisory lock -> ensure migration ledger
      -> read applied versions -> apply each missing SQL file in order
      -> record each version -> COMMIT
Any failure -> ROLLBACK -> release connection
```

Both the table change and its ledger entry commit together. On a fresh database,
versions 1 and 2 are one transaction; on an existing version-1 database, only 2 is
pending. The lock makes a concurrent runner wait and then reread the ledger.
Rerunning skips applied versions and preserves records. A conflicting existing
table makes the migration fail rather than silently accepting an unknown shape.

Read the SQL one rule at a time:

1. `board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE` uses the
   board's existing identity as the document key. The primary key enforces
   uniqueness/non-nullness and supplies the lookup index. The foreign key rejects
   documents without a board; cascade deletes that board's document when its
   metadata is deleted. This models **zero or one document per board**. The
   migration creates no document rows, so metadata-only boards stay metadata-only.
2. `schema_version integer NOT NULL ... CHECK (schema_version > 0)` describes
   the document format. `revision` has the same numeric constraints but tracks
   accepted saves. They have no defaults: the save operation must supply
   both explicitly. SQL permits positive future format versions; API validation
   determines which versions the application supports. Revision checks and
   incrementing live in the save SQL, not a trigger or feature of this migration.
3. `content jsonb NOT NULL` holds `{ "objects": [...] }`, without duplicating
   schema version or storing history, selection, or viewport. The shape constraint
   requires an outer JSON object whose `objects` member is an array. SQL guards
   that structure; the canonical Zod validator handles individual object fields,
   IDs, references, unknown fields, limits, and image rejection in the API slice.
4. The shape expression ends in `IS TRUE`. A missing JSON member evaluates to
   SQL NULL, and a bare `CHECK` accepts NULL. `IS TRUE` makes the missing member
   fail. `{}`, JSON `null`, SQL NULL, and non-array `objects` are rejected;
   `{ "objects": [] }` is accepted as an explicitly saved blank document.
   See [PostgreSQL check constraints](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS)
   and [JSON extraction/type functions](https://www.postgresql.org/docs/18/functions-json.html).
5. `updated_at timestamptz NOT NULL DEFAULT now()` supplies a database timestamp
   on INSERT when omitted. A default does not run on UPDATE: save SQL must
   update this timestamp and `boards.updated_at` together in its transaction.

Once version 2 is applied, these are read-only inspection queries in psql:

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version;
\d board_documents
SELECT board_id, schema_version, revision, jsonb_array_length(content -> 'objects')
  AS object_count, updated_at FROM board_documents;
```

The last query returning zero rows immediately after migration is expected.
Do not add a fake document to each existing board just to populate the table.

Validation: `npm run test:database:docker` passed 11 real tests, including seven
new migration cases. They create/drop only new randomly named schemas, never
reset the ordinary `boards` table. Covered fresh/concurrent install, upgrade with
metadata/timestamp preservation, no automatic document rows, repeated runs with
saved content, rollback/retry on both fresh and version-1 schemas, all five column
types, foreign key/primary key/cascade rules, explicit positive integer counters,
null/JSON shape rejection on INSERT/UPDATE, and preserved JSON array order.
Server type checking and server build passed. Migration 2 is applied to the normal
Docker schema on port 5434: ledger versions 1/2, all five columns/defaults and
constraints inspected, zero document rows. A before/after comparison verified
the existing board's ID/title/timestamps are unchanged. Actual Docker
database-process restart testing remains pending.

Applied with `npm run db:migrate:docker` under the migration-slice authorization.
The portable database uses separate `.env`/port 5433 and was not migrated; do not run
`db:migrate` against it by assumption. No endpoint or guest-persistence change is
part of this migration slice.

## Document request and SQL walkthrough

Start with `server/app.ts`, then follow `server/documents.ts` and
`server/postgresDocuments.ts`. The shared contract lives under `server/contracts`
so the server build emits it without importing editor/store code. The browser
re-export retains the adapter import paths. No dependency or build configuration
change was needed.

A first explicit save can store an empty drawing:

```json
{
  "schemaVersion": 1,
  "expectedRevision": 0,
  "content": { "objects": [] }
}
```

PUT returns 201 with a Location header and `{ document: { boardId, schemaVersion,
revision: 1, content, updatedAt } }`. A later PUT supplies the revision it loaded
and returns 200 with the incremented revision. The envelope adds server metadata;
extract `{ schemaVersion, content }` before calling the strict browser adapter.

Trace one save through the SQL:

1. Express parses up to 1 MiB of JSON. Zod checks the board UUID, expectedRevision,
   and the entire non-image document before calling the store. Unsupported formats,
   duplicates, invalid references, malformed fields, and unknown fields return 400;
   non-JSON input returns 415 and oversized input returns 413. No partial save occurs.
2. The store checks out one pg connection, starts BEGIN, and runs
   `SELECT id FROM boards WHERE id = $1 FOR UPDATE`. This locks the parent board
   before the document, matching the order of board rename/delete operations.
   Competing saves wait here; a deleted/missing board returns BOARD_NOT_FOUND/404.
3. expectedRevision 0 uses INSERT with revision 1 and
   `ON CONFLICT (board_id) DO NOTHING RETURNING ...`. Other revisions use
   `UPDATE ... SET revision = revision + 1 ... WHERE board_id = $1 AND revision = $4
   RETURNING ...`. Values are parameters, including the JSONB content. The
   conditional write protects against a stale snapshot even after the parent lock
   serializes requests.
4. If no document row is returned, read its current revision under the same lock
   and ROLLBACK. Return REVISION_CONFLICT/409 with
   `error.details.currentRevision`; 0 means that board has no document yet.
   Do not retry against a new revision automatically.
5. An accepted write uses the greatest of the database clock and existing
   timestamps to keep time from moving backwards. Copy that exact SQL timestamp
   to boards.updated_at, without changing its title or created_at. Validate the
   returned document and COMMIT. Any failure before commit rolls back both rows;
   the connection is always released. API timestamps are epoch milliseconds,
   while the stored timestamps retain PostgreSQL precision.

For GET, one LEFT JOIN starts from boards. No board row means BOARD_NOT_FOUND/404;
a board with a null joined document means DOCUMENT_NOT_FOUND/404. Otherwise the
store validates the stored format before returning it. Unsupported or invalid
stored content returns INVALID_STORED_DOCUMENT/500 without dropping fields,
returning a partial drawing, or rewriting the row.

The response-failure test simulates an error after commit: GET recovers the
accepted canonical snapshot/revision, and repeating expectedRevision 0 conflicts.
This establishes the server behavior needed for later client reconciliation; no
frontend retry/reconciliation flow has been wired yet.

Verification:

- `npm test`: 236 passed; the 25 real database tests are skipped without a test URL.
- `npm run test:database:docker`: all 25 real tests passed in new isolated schemas,
  including 14 document cases. Covered all supported fields, first/stale/competing
  saves, unchanged rows on invalid input, transaction rollback with injected
  metadata-write failures, new connections/app instances, save/delete races,
  response failure after commit, invalid stored formats, and integer limits.
- Exact HTTP body boundaries: 1 MiB accepted, 1 MiB + 1 byte rejected; metadata
  remains limited to 16 KiB. Unicode rejection and valid text round trips passed.
- Server type checking/build and frontend type checking/build passed. The same
  two Zod dependency-comment annotation warnings remain in the successful Vite build.
- The published Scribble API collection passed lint (40 requests, zero issues)
  and a local run (40 requests, 127 assertions, zero failures). Existing request,
  script, and example IDs/content are preserved. Variable values remain configurable;
  their existing guidance is retained in the collection description because the
  connector's variable PATCH accepts key/value fields only. Local mirrors/logs
  stay under ignored postman paths.
- Saved and replaced a five-type document on a separate proof board, restarted
  the owned API process, and verified the identical envelope plus board timestamp.
  The proof lifecycle passed 7 requests/24 assertions and deleted its own board.
  Final normal Docker DB: ledger 1/2, zero documents, original demo board metadata
  fingerprint unchanged. The database process was not restarted; portable DB
  files/configuration were untouched and no portable migration/import occurred.

Ownership update (2026-10-04): board/document routes require persisted sessions;
reads and writes filter by the session owner. Saves check ownership in the locked
parent-row query before revision conflict checks. Mutation requests require the
Scribble header and a permitted origin. Migration 4 preserves unowned demo data
but hides it from all accounts. Guest stores and document format are unchanged.

Account save/open is implemented and committed as `7449241`; the user confirmed
completed live Google account save/open verification on 2026-10-04. TanStack
Query now owns account server snapshots and mutations. Documents always fetch
a fresh revision for opening/reloading/uncertain-save reconciliation; writes do
not retry automatically. Accepted responses update/invalidate owner caches;
auth transitions remove private caches. The existing serial queue, explicit
upload, guest IndexedDB, recoverable drafts and safe conflicts remain intact.
Background server refresh never replaces the Zustand canvas/editor state.
Next: Prisma must retain constraints/API behavior with one migration authority.
Actual Docker database-process restart verification remains pending. Durable
image assets and deployment remain later milestones.
