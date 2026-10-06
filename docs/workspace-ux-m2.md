# Workspace UX M2: guest handoff and account editor journals

Verified locally 2026-10-06. Status authority:
`../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`. M3 is next; no M3 implementation began.
M0 evidence and the M1 wake-recovery guide remain historical records.

## Guest ownership contract

Guests retain one `boards/current-board` record and one guarded writer. A passive
tab follows committed snapshots without presenting an error. Focus, visibility,
pageshow or an edit attempt requests ownership; an explicit **Continue editing
here** action retries it. Acquisition waits up to two seconds in 75 ms steps.
Automatic failure leaves a passive view; an unsuccessful explicit attempt shows
that the other tab is finishing its edit.

The current writer commits visible ink/text and pan, flushes the existing serial
device-save queue, blocks further edits, then releases. Active drag/resize waits
for the normal interaction boundary. Text composition defers handoff until
compositionend and the final input commit. The new owner loads the durable
document, viewport and clean history before enabling mutations. Passive snapshot
updates preserve that view's viewport and clear selection/history when document
content changes. Returning to an owned session after a storage outage renews its
retained token without replacing pending edits or history.

Signals use BroadcastChannel `scribble-board-tabs-v1` plus localStorage key
`scribble:board-tab-signal-v1`, with `{type,id,source,nonce}` identities only.
`claimed`, `released`, `snapshot` and `handoff` carry no document payload. Passive
views also poll IndexedDB every 1.5 seconds. Missing BroadcastChannel uses storage
signals; missing Web Locks uses atomic durable leases. If both transports fail,
snapshots still poll and continuation can acquire after release/exit. An actual
held Web Lock is never stolen because its heartbeat expired. Fallback crash
recovery waits for the previous 20-second lease to expire. Every canonical write
still checks/extends the token in the same transaction as its data write.

## Account journal and compatibility contract

IndexedDB version **4** adds `editor-journals` with keyPath `id`; the existing
`boards`, `assets` and `board-leases` stores remain intact. Local board record
schemaVersion stays 1. Each document runtime gets a fresh UUID editor identity,
including duplicated tabs. A journal wraps the existing logical board record:

```typescript
{
  id: `${accountBoardStorageId}:editor:${journalUUID}`, // optional :recovery suffix
  journalVersion: 1,
  editorId: editorUUID,
  board: LocalBoardRecord,
  legacySource?: string
}
```

Logical account/board IDs, URLs, image blobs, asset mappings, pending-save markers
and operation IDs stay unchanged. Each journal and its backup use that journal's
own guarded lease/transaction. Different live editors can write simultaneously
through the existing operation receipts, revisions and SSE collaboration.

A fresh editor checks legacy work under the old canonical lease before adopting
an inactive journal. Uncopied dirty legacy work gets a separate journal even if
another journal already exists; `legacySource` identifies the exact copied title,
objects and account metadata so the unchanged source is not repeatedly imported.
Busy legacy records are left intact for a later fresh editor to inspect. Original
keys and recovery copies are retained, including asset bytes and completed maps.

Recovery adopts only a journal whose lease can be acquired, then rereads it under
that lease. Dirty journals precede clean ones; timestamps never authorize deletion.
Save details lists other pending editor drafts. Recovery flushes the current
draft, rereads current permission, reserves the source, verifies the canvas/session
is unchanged, then selects and applies the draft synchronously. Existing pending
operation IDs replay unchanged. Independent unacknowledged edits merge through
the established three-way document merge; same-object conflicts retain the local
draft and the confirmed remote version. No journal is deleted by recovery.

No API, SQL migration, Prisma mapping or dependency changed. Rolling back this
frontend must retain a version-4-capable IndexedDB opener: an old version-3 opener
cannot open an upgraded database. Do not delete or downgrade user storage.

## Validation and reusable commands

- **72 focused unit tests**: independent journals, legacy copies and later legacy
  discovery, crash operation identity, older pending drafts, backups/account
  isolation, atomic ownership, role restrictions, local storage and status.
- **14 browser cases**: seven guest handoff/snapshot/fallback/input cases plus the
  seven M1 wake/loading/storage cases. Interrupted ink commits once; composition
  retains final text; returning editors load fresh data and cannot undo old edits.
- **8 actual browser/API/PostgreSQL cases**: guest handoff; concurrent same-account
  editors, different pages and selective undo; changed-token rejection; lost
  operation response/reload; two crashed pending journals and explicit recovery;
  duplicate identities without coordination APIs; same-object conflict; legacy
  pending replay with an existing journal, unchanged original key and image bytes.
- Production build, focused workspace/integration-spec typecheck and diff check
  passed. Existing dependency-annotation and bundle-size build warnings remain.

```powershell
npm test -- src/persistence/accountEditorJournals.test.ts src/persistence/boardTabCoordinator.test.ts src/persistence/accountBoardSession.test.ts src/persistence/localBoardStorage.test.ts src/persistence/waitForLocalBoardSave.test.ts src/components/SaveStatus.test.ts src/store/boardStore.test.ts

npm run test:e2e -- e2e/workspace-tabs.spec.ts e2e/workspace-wake.spec.ts --output=test-results/m2-browser

npm run test:e2e:integration -- e2e-integration/cross-tab.spec.ts e2e-integration/workspace-journals.spec.ts --output=test-results/m2-integration

npm run build
```

Use separate Playwright output directories when running browser and integration
suites concurrently. Typecheck the workspace specs and integration config files
with the TypeScript program command in the M1 guide, including
`e2e/workspace-tabs.spec.ts` and `...config.fileNames` in the program's roots.

Integration used existing loopback Docker PostgreSQL on 5434 with disposable
`scribble_browser_test_*` schemas and app/API ports 4174/4301. Zero fixture schemas
existed before and after validation; the existing database was left running.
Standard browser checks used 4173, mocked account HTTP and real browser IndexedDB.
No Google or ImageKit requests, production changes, commits or pushes occurred.

Lifecycle/focus, composition and expiry checks are deterministic browser-event
tests. Physical device suspension, native IME behavior and full acceptance remain
M11 work. Start M3 with section 5's page-creation receipt/transaction contract and
the M3 block; retain these ownership and recovery boundaries.
