# Existing local persistence

## Records and assets

[`database.ts`](../src/persistence/database.ts) opens IndexedDB database
`the-canvas`, version 2, with `boards` and `assets` object stores.
[`localBoardStorage.ts`](../src/persistence/localBoardStorage.ts) uses board ID
`current-board` and board schema version 1. One record contains title, object map,
viewport, and numeric created/updated timestamps. Loading checks the stored shape
at runtime and rejects unsupported data. No existing key or format was changed
for the backend learning slice.

Images reference an `assetId`; their original Blobs live in the asset store.
[`imageDecoder.ts`](../src/assets/imageDecoder.ts) checks supported formats,
the 20 MB limit, and successful decoding. Paste/drop prepares and saves the asset
before adding its object. [`ImageObject`](../src/canvas/objects/ImageObject.tsx)
loads the Blob, creates a temporary object URL, and revokes it on cleanup. A
missing asset renders `Image unavailable`. This is browser storage, not a cloud
upload system.

## Save lifecycle and guarantees

`useLocalBoardPersistence` first loads the record into document, viewport, and
metadata stores. It clears selection and document history. A new browser board
starts with an empty document.

Committed object changes, settled viewport changes, and title changes reset a
500 ms timer. When it fires, the hook captures a snapshot and chains its write
onto a Promise queue. Writes from this hook execute in order. A local revision
counter prevents an older save completion from marking a newer edit as saved.
Neither selection changes nor pointer previews trigger a board write.

Failures set an error message. A subsequent edit can schedule another attempt;
there is no autonomous retry loop. `pagehide` and hiding the tab flush a pending
timer, but asynchronous writes during abrupt termination are still best effort.
This queue and revision counter do not coordinate different tabs or clients.
Cross-tab conflict handling has not been implemented or tested in this slice.

## Backend boundary

The new API stores metadata only, in memory. Creating an API board does not
create or save a canvas document. Backend restart loses its records, while the
independent IndexedDB board remains in the browser.

PostgreSQL storage, JSONB versus per-object versus hybrid modeling, network save
ordering, retry UI, and document migration will be evaluated in Phase 2. No board
storage decision or remote-save guarantee has been made yet.
