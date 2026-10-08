# Workspace UX M11: integrated validation and release handoff

2026-10-07. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`, M11 only.
Verified locally. Learning documents are left unchanged at the user's request.

## Implementation fixes

Confirmed pending image uploads now wait for their recorded deadline and retry
the original POST directly. A status GET acquires a reconciliation lease; doing
GET immediately before POST renewed the cooldown and prevented the upload from
finishing. Unknown responses still use GET before any further bytes. The original
account, destination, upload UUID, immutable bytes, retry limits and terminal
recovery remain intact. Both account autosave and explicit guest transfer use
this sequence. Real API tests verify provider failure, reload, one reservation,
one destination and preserved guest source.

A transient background collaboration read now enters the established bounded
save retry queue. Previously a read interrupted by going offline could leave an
editable draft in an error state that reconnect never resumed. Offline edits
remain local; reconnect uses the existing operation/revision and access checks.
Conflicts, terminal failures and permission removal retain their recovery paths.

Browser fixtures now assert the completed workspace flows: Drawing/Page title,
automatic saving, retained-drawing consent, image-upload review, invitation
acceptance and actionable notices. Historical manual-save controls are no longer
test expectations. The SSE connection-limit test keeps eight clients actively
draining before checking the ninth is rejected. The database test command now
includes the 21 workspace PostgreSQL tests it previously omitted.
The encrypted restore fixture also populates creation/initialization receipts,
workspace preference and a pending upload lease, alongside a legacy ready image.

## Acceptance matrix

| Coverage | Evidence |
| --- | --- |
| Guest, unavailable API, local title/objects/images/viewport, reload | authentication, compatibility, private-server-boards, workspace-wake, responsive and workspace-ui |
| Empty Google entry, concurrent initialization, selected/declined/canceled transfer, lost responses, account fencing | guest-transfer, workspace-navigation, workspace PostgreSQL and controller tests |
| Page creation/rename/deletion/final deletion, navigation/direct links/Back/Forward, edit boundaries | workspace-navigation, workspace-ui, account-boards and journal tests |
| Autosave, offline/reconnect, bounded retries, slow responses, image insert/paste/drop/undo/redo, legacy consent | workspace-saving, cloud-images, account session and guest-transfer tests |
| Two guest tabs, hidden/crashed writer, account journals, separate pages | cross-tab, workspace-journals, workspace-tabs and workspace-wake |
| Two browsers, independent edits, conflicts, receipts, selective undo, presence with pan/zoom | collaboration and PostgreSQL operation tests |
| Owner/editor/viewer/revocation, invitation acceptance, account switch/logout/expiry, private image reads | sharing, cloud-images, private-server-boards and account-boards |
| Older local drafts, retained blobs/mappings/pending operations, additive migrations and constraints | workspace-journals, compatibility and database tests |
| Desktop/mobile/light/dark, keyboard/focus, layout zoom, safe areas, reduced visual viewport/IME simulation | ux-layout, responsive, usability and workspace-ui |
| Pan/zoom/draw/drag/resize, interruption, coordinate/history boundaries, pen/touch input | ux-layout, pen-input, usability and viewport/stroke unit tests |

Fixtures exercise the actual local browser/API/Prisma/PostgreSQL path. Google
identity and image-provider behavior are controlled locally. These results do
not establish physical-device, screen-reader or live-provider acceptance.

## Final contracts and compatibility

No M11 API, SQL, Prisma, dependency, document schema or IndexedDB format changes.
The existing document schema is version 1; IndexedDB remains version 4. Guest
`boards/current-board`, account editor journals and namespaced transfer records
remain compatible. Pointer movement, selection ownership and atomic interaction
history boundaries are unchanged.

| API | Contract retained |
| --- | --- |
| `POST /api/boards` | Legacy `{title}` returns metadata-only 201. `{title,requestId,initializeDocument:true}` atomically creates a blank revision-one page and receipt; 201 first creation, 200 replay. Replay never resets later document edits. |
| `GET /api/workspace` | Read-only `{workspace:{initialized,lastOpenedBoardId}}`; inaccessible preference is null. Failed reads/lists never mean an empty workspace. |
| `PATCH /api/workspace` | Strict `{lastOpenedBoardId:UUID|null}`; current access required; changes preference after successful opening. |
| `POST /api/workspace/initialize` | Stable `{requestId,createInitialPage:boolean}`; transactional account initialization and at most one automatic first page across devices. |
| `POST /api/boards/:id/assets` | Stable `X-Scribble-Upload-Request` with immutable raw JPEG/PNG/WebP bytes. 200 ready or 202 pending; `{upload}` carries original asset identity, state, retry permission and delay. Legacy no-header upload remains available. |
| `GET /api/boards/:id/asset-uploads/:requestId` | Reconciles unknown outcomes without uploading bytes; current edit access and original actor required. Pending deadlines, HTTP Retry-After and terminal limits remain enforced. |
| Auth and transferred/account requests | Signed-in `capabilities.guestTransfer:1`, guest `guestTransferEnabled:true`; bound `X-Scribble-Account` rejects cookie/account changes before storage. Explicit consent required; no automatic guest upload on login. |
| Documents/operations/sharing/images | Existing revision checks, operation receipts, selective undo, permissions, authorized signing and revoke/expiry behavior remain in force. |

Detailed contracts: `workspace-ux-m3.md`, `workspace-ux-m4.md`,
`workspace-ux-m5.md`, `workspace-ux-m7.md`, `workspace-ux-m8.md`.
SQL migrations 9 (page creation receipts), 10 (workspace state/initialization
receipts), and 11 (upload reservations/leases) are additive. Next unused SQL
number remains 12. M11 adds no migration.

## Gate results and isolation

- Fast tests: **813 passed**; 151 opt-in database cases run separately.
- PostgreSQL tests: **151 passed**, including workspace initialization and all
  existing migration, ownership, document, sharing, image, operation and budget
  checks.
- Standard browser tests: **89 passed**; three opt-in historical baseline captures
  remain skipped. The separate physical/production pen spec is outside this gate.
- Actual browser/API/Prisma/PostgreSQL journeys: **72 passed**, no skips.
- Docker build and restart/recreation persistence: **36 checks passed**.
- Encrypted backup/restore: **16 checks passed**, all 15 current tables populated,
  exact restored row fingerprints, and unchanged source.
- Actual Caddy error-log privacy proof: **6 checks passed**.
- Frontend/server builds, server/deployment strict typechecks, all browser and
  fixture strict typechecks, and Prisma validation pass.
- Diff checks pass. Normal local database: **12 tables/14 rows unchanged**, including
  definitions, and **zero disposable schemas** after teardown. Evidence:
  `../workspace-ux-evidence/m11-database-isolation.json`.
- Representative desktop, mobile, dark and safe-area screenshots were inspected:
  `m11-owner-1440-light.png`, `m11-owner-390-dark.png`, `m11-live-mobile.png`,
  `m11-safe-area.png` in `../workspace-ux-evidence/`. Remaining `m11-*.png` captures
  cover guest/owner themes, keyboard-constrained dialogs, consent and pending work.

The audit baseline captures every row plus columns, constraints and indexes in
the normal local database. Disposable browser schemas use random names on the
existing loopback Docker database; teardown drops only the fixture schema.
Interrupted validation's own schema was checked and cleaned before rerunning.
Normal databases, production data and existing Docker volumes are never reset.
Disposable Docker proof containers, networks and volumes were removed after their
checks; the existing local database service remains running.

```text
npm test
npm run test:database:docker
npm run build
npm run typecheck:server
npm run build:server
npx tsc -p deployment/tsconfig.json
npx tsc -p workspace-ux-evidence/m11-typecheck.json
npm run db:validate
npm run test:e2e -- --output=test-results/m11-standard-final
npm run test:e2e:integration -- --output=test-results/m11-integration-final
docker build --tag scribble-api:local .
node scripts/docker-persistence-proof.mjs
docker build --file docker/backups/Dockerfile --tag scribble-backups:local .
node scripts/backup-restore-proof.mjs
node scripts/proxy-log-proof.mjs
node --env-file=.env.docker workspace-ux-evidence/m11-database-audit.mjs after
git -c core.safecrlf=false diff --check
```

Use a fresh Vite process for the final browser gate. A reused development
process with a hot-updated module graph can give test-side dynamic imports a
different store instance from the UI. The final run restarts that process; it
does not change canvas code or weaken the assertions.

## Release order, current deployment and rollback

Release order is migrations 9-11, compatible backend, then frontend. M11's retry
fixes require no additional backend release or database migration. Preserve
additive SQL and all recovery/receipt identities when rolling back. Any frontend
rollback must retain an M8-aware v4 parser/opener so pending upload/title intent,
editor journals and guest-transfer records remain readable.

The earlier M0-M10 release is already pushed at `11ea3e0` and Cloudflare Pages
deployment succeeded. Neon migrations 9-11 were already applied with an encrypted
backup and unchanged existing data, as recorded in `workspace-ux-release.md`.
The user chose manual Render deployment. A read-only M11 production probe still
finds readiness 200, `/api/workspace` 404 and no guest transfer capability, so
live signed-in workspace acceptance awaits that backend deployment. Guest local
editing remains available; the frontend does not substitute a legacy automatic
upload when capabilities are absent. Workspace API errors retain the draft and
offer retry, without interpreting failure as an empty account.

The old `11ea3e0` hosted CI run failed at stale browser expectations. Local M11
fixes will be validated by hosted CI after a separately authorized commit/push.
No M11 commit, push, production write or deployment is part of this local gate.

After releasing, verify the same-origin API advertises guest transfer, workspace
returns 401 for a guest, and real Google sign-in/explicit image transfer/new page/
automatic save/two-account sharing work on the intended devices. Keep physical
pen pressure/palm rejection, mobile keyboard/IME, real browser chrome zoom,
screen-reader traversal, operating-system sleep/wake, provider failure handling
and cold Render reconnect as remaining human/provider checks. Controlled local
simulations and screenshots do not claim those checks. Stop after M11.
