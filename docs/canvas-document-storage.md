# Canvas document storage design

Status: validation and serialization slice implemented, 2026-10-02. The database
and API design below remains proposed. No migration, document API, Prisma
integration, guest upload, or cloud save is implemented.

## Decision

Use relational board metadata plus one JSONB canvas snapshot per board. Retain
`boards` for IDs, titles, and timestamps. Add a separate `board_documents` table
when implementation is approved. A board can have metadata before its first
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

## Proposed table

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

## Proposed local API and conflicts

These are planned contracts, not working requests or Postman collection entries.

- `GET /api/boards/:id/document`: return a document envelope with `boardId`,
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

Initially propose a route-specific 1 MiB JSON body limit, 5,000 objects, and
100,000 total stroke points; all limits apply, whichever is reached first.
These are starting limits to measure, not verified capacity guarantees.
The existing metadata parser is limited to 16 KiB; document routing/parser setup
must accept the larger document body without changing metadata limits.

## Later frontend save flow

Keep guest IndexedDB saves free and independent. The current Server boards panel
remains a read-only metadata list until a separate integration slice is approved.
After authentication and ownership, offer an explicit account-save/upload choice.
The local `current-board` identity must not become a server UUID or an owner ID
by assumption; create/select the server board and maintain a separate association.
Never upload the guest board merely because the user logged in.

For an opted-in server document, observe durable document changes, debounce after
committed actions, and keep at most one save in flight per editor. Capture the
snapshot and a local edit generation. On success, advance the server revision;
mark saved only if that generation is still current, otherwise save the newest
queued snapshot next. Pointer frames stay transient. Undo/redo changes the saved
content but does not create extra history entries through persistence.

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
2. Add a new numbered migration for `board_documents`; extend the current runner,
   which currently only knows version 1. Preserve existing boards and migration 1.
3. Implement local document read/save with revision checks using `pg` first.
   Verify first save, replacement, invalid bodies, deletion, competing saves,
   lost-response reconciliation, and rollback without damaging metadata.
4. Round-trip a note/stroke/connector document and verify content after API and
   database restarts. Preserve guest/history behavior. Update the cloud Scribble
   Postman collection only when these endpoints actually work.
5. Introduce Prisma after tracing this SQL; preserve constraints, API behavior,
   data, and a single clear migration authority. Auth/ownership and assets then
   enable explicit frontend account saves.

## Implemented validator and adapters

`src/persistence/canvasDocument.ts` defines the strict version-1 envelope:
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
The proposed 1 MiB HTTP body limit remains for the endpoint slice.

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

Next slice: the numbered document migration, followed separately by local `pg`
document save/load with atomic revision checks. Resolve shared-module/build
placement when integrating the validator into Node; keep one canonical schema.
