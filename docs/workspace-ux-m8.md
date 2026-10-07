# Workspace UX M8: automatic workspace saving

Verified locally 2026-10-07. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`.
Stop after M8; the next milestone is
**M9 only**, the guest/workspace navigation presentation. M7/M8 are uncommitted.

## Behavior and consent

Committed document and title edits save through the existing serial account queue.
New supported image inserts, drops and pastes authorize their upload as part of
that action. Loading a draft, signing in, merging remote content, undo and redo
never create upload consent. Guest editing and its retained drawing remain local.
Images from older drafts without an upload intent show one review notice. Cancel
keeps them local; confirming the existing Upload and save dialog authorizes those
files once. Reload retains that consent. Missing, unsupported or oversized files
stay recoverable and require attention; cloud limits remain JPEG/PNG/WebP, 5 MiB.

The insertion boundary is `documentStore.addObjects`, covering file drop/paste
and the internal object clipboard. Upload metadata stays outside editor history.
An insertion undone before saving starts no upload. A completed in-flight upload
keeps its mapping even when the image was undone; redo reuses it. Cross-page cloud
pastes download authorized source bytes and upload a distinct destination asset.
Async file decoding checks the originating page session before inserting.

## Durable identity and confirmation

`src/persistence/accountImageUploads.ts` uses M5's keyed upload/status adapters.
Each account editor journal's existing `account` link gains optional `imageUploads`
and `pendingTitle` fields. No IndexedDB version, object store, existing key, SQL,
Prisma or package change is needed. Old drafts parse without these optional fields;
an absent upload intent means absent consent. The parser validates own map keys,
including `__proto__`, and preserves Blob bytes through IndexedDB structured clone.

An image intent retains its UUID, immutable original Blob, optional source cloud
reference, dispatch marker, confirmed-pending state, retry permission, terminal
failure and next-attempt time. The serial device queue must confirm intent/bytes
and dispatch markers before POST. Unknown outcomes use GET status before another
POST; retries use the same bytes/account/page/UUID. Confirmed asset mappings and
sources remain retained for drafts/history; this milestone deletes no assets.

Document operations retain the existing durable receipts and merge newer edits
on replay. Opening an unconflicted pending operation resumes its confirmation.
Title PATCH first persists the submitted and previous title. A lost response reads
fresh metadata: an accepted title is confirmed without another PATCH, an unchanged
previous title can retry, and a different newer title becomes a conflict. This is
conservative recovery, not a new server title CAS contract.

Image upload/status/source-signing, document read/write/operation and title requests
carry `X-Scribble-Account`. M7's backend fence rejects dispatch-time cookie changes.
Late save acknowledgements preserve newly authorized uploads instead of replacing
their metadata. Viewer/revoked access cancels retries while preserving the draft;
cancellation cannot replace read-only status with a generic save error.

## Status and retry bounds

Saved means the current title, document and referenced images are confirmed by
the remote API. Unuploaded images cannot appear saved. Pending distinguishes
offline/retry work from permanent errors; a device fallback is claimed only when
the local queue reports a confirmed write. Live hints cannot mark a pending title
saved or prevent its autosave.

Offline edits on an already loaded page remain journaled and resume on the online
event. Network errors, HTTP 408/429/5xx and retryable pending uploads receive at
most **three automatic retries** after the initial attempt, with exponential
backoff and server Retry-After/upload delays. Exhaustion presents one Retry action.
Authentication, permissions, conflicts, validation, explicit cancellation, tab
ownership loss and terminal uploads stop automatic retries. An exhausted provider
attempt may still be checked manually for a delayed ready result; it never receives
new bytes or another UUID. Each HTTP upload is bounded by M5's 90-second deadline.

## Verification

807 fast tests and 26 standard account/UX browser cases passed. Targeted tests
cover marker persistence failure, legacy consent/history replay, immutable request
bytes, lost responses/reload, pending delays, upload attempt exhaustion, late
mapping/authorization races, offline reconnect, title conflicts and cancellation
on an access downgrade. Frontend/backend builds and strict touched-test/fixture
typechecks pass. **41 distinct actual browser/API/Prisma/PostgreSQL cases** passed
across focused runs: 15 M8 saving cases, 10 M6 navigation regressions and 16 M7
transfer regressions. Evidence includes a real pen action under pan/zoom, all three
supported image formats, offline reconnect, lost upload/document/title responses,
legacy consent, bounded retries/Retry-After, role changes, cross-page cloud paste
and dispatch-time account replacement for uploads and operations. The normal
database's 12 tables/14 rows and definitions are unchanged; zero disposable schemas
remain: `../workspace-ux-evidence/m8-database-isolation.json`.
Screenshot: `../workspace-ux-evidence/m8-offline-pending.png`.

Initial runs exposed the read-only cancellation status bug, corrected above.
Old manual-retry assertions were adapted to automatic recovery. A combined run's
late cases read a null fixture account while development modules were being hot
reloaded; restarting the test servers resolved those fixture failures. The final
clean-server run passed all 25 M8/navigation cases. The final 26-case
standard browser run also passed. 151 opt-in PostgreSQL unit cases are skipped in
`npm test`; the 41 integration cases are the actual database proof for this slice.

```text
npm test
npm test -- src/api/assets.test.ts src/persistence/accountBoardSession.test.ts
npm run test:e2e -- e2e/account-boards.spec.ts e2e/ux-simplification.spec.ts --output=test-results/m8-browser-final
npm run test:e2e:integration -- e2e-integration/workspace-saving.spec.ts e2e-integration/workspace-navigation.spec.ts --output=test-results/m8-saving-final
npm run test:e2e:integration -- e2e-integration/workspace-saving.spec.ts e2e-integration/guest-transfer.spec.ts e2e-integration/workspace-navigation.spec.ts --output=test-results/m8-integration-final
npm run build
npm run build:server
npx tsc -p e2e-integration/tsconfig.json
npx tsc --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution Bundler --jsx react-jsx --lib ES2023,DOM --types vite/client,node src/persistence/accountBoardSession.test.ts src/persistence/workspaceController.test.ts src/persistence/localBoardStorage.test.ts src/components/SaveStatus.test.ts src/api/boards.test.ts src/api/assets.test.ts
node --env-file=.env.docker workspace-ux-evidence/m8-database-audit.mjs before
node --env-file=.env.docker workspace-ux-evidence/m8-database-audit.mjs after
git diff --check
```

The API/database fixture uses real local auth, permissions, Prisma and PostgreSQL
with controlled Google/image providers. Real provider acceptance and physical
IME/sleep/device acceptance remain release/M11 checks. Release requires existing
SQL 9–11 and the M7-compatible backend before this frontend. Next SQL stays 12.
Rollback must keep a v4 opener/parser that understands M8's optional account-link
fields; older strict parsers may refuse these drafts, which must be preserved.
Manual creation/copy controls remain until M9; their legacy metadata creation
still requires inspecting the account list after an unknown creation response.
No commit, push, deployment, normal/production migration or provider mutation.
