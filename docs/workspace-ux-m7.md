# Workspace UX M7: deliberate Google sign-in and resumable guest transfer

Verified locally 2026-10-07. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`.
Next: **M8 only**, automatic workspace document/title/image saving. M7 is
uncommitted; commits, pushes and deployment need separate authorization.

## Sign-in and consent

The existing Account surface continues directly to Google after the local save
boundary for an empty drawing. Existing content adds one initially unchecked
“Bring this drawing into my workspace” choice, explaining that images are included
and the original remains on this device. Declining opens the ordinary workspace.
Account also offers the same consent for a later import of the retained drawing.
Previously authorized transfers have Resume; interrupted transfers have Retry or
Pause and open workspace. Invitation acceptance remains an independent choice.

`WorkspaceController.prepareGoogleSignIn` waits for hydration, blocks native
composition, commits text/pointers, flushes the serial local queue, and captures
the source before redirect. Closing Account cancels preparation. Source snapshots
and original image bytes are immutable throughout transfer; later guest edits stay
in the original drawing and never change the staged snapshot.

## Durable transfer and retry

`src/persistence/guestTransfer.ts` stores version-one `guest-transfer:<flow UUID>`
records in the existing IndexedDB v4 **boards** store. These are separate records,
not `current-board`, account drafts or editor journals. No schema upgrade or change
to existing keys/formats is needed. Each record contains its detached source and
viewport, image blobs, creation/upload UUIDs, account binding, destination, mappings,
retry delays and eventual document operation. All identities persist before dispatch.
Namespaced records and sources remain retained, including canceled/failed attempts.

Before OAuth the record is awaiting authentication. A tab-scoped flow pointer and
ten-minute consent window must match `authFlow` on a successful callback before an
account can bind it. Ordinary restoration, mismatched/expired callbacks and later
unrelated sign-ins cannot bind that source. Failed/denied callbacks pause the old
attempt without deleting it; a new sign-in supersedes unbound intent explicitly.
Bound pending records are read only for their original account. Logout, expiry and
account switching pause uncommitted transfers; resuming a paused transfer is explicit.

Entry initializes without a blank page, creates one initialized destination through
M3's durable receipt, reads current access/document, uploads images through M5's
stable requests, and persists each confirmed mapping. Unknown upload responses
reconcile via status before sending bytes again. Pending/failed/exhausted uploads
preserve the source and surface a bounded, explicit retry. Server retry delays and
numeric HTTP Retry-After are retained. No polling loop or new identity on error.

The initial document is one persisted collaboration operation at base revision 1,
containing inserts from the staged snapshot. Its existing durable receipt confirms
lost responses, even if the page has subsequently been edited. A retry never PUTs
the initial snapshot over newer work. A destination edited before initial dispatch
is preserved and requires attention. Deleted/expired destinations remain terminal.
Web Locks serialize an intent across tabs when available; server receipts and
transactional local mutations also protect concurrent replay.

Confirmation marks the intent **committed** before opening. Opening rereads the
current document/role, restores the source viewport unless that page already has
its own draft viewport, and preserves M6 selection/history boundaries. Only a
successful open marks **complete**. Reload after a failed opening therefore opens
the same confirmed destination without another import. The preparing destination
stays hidden/inert. Explicit page URLs and invitations defer transfer until Resume.

## Compatible backend and release

Google start accepts optional `clientFlow=<UUID>`. A short-lived HttpOnly, Lax,
callback-path cookie pairs it with the existing browser flow. Only a verified
successful callback echoes `authFlow`; ordinary starts, failure and logout clear
the cookie. Existing OAuth state/nonce/PKCE and session handling remain unchanged.

`GET /api/auth/me` advertises `{capabilities:{guestTransfer:1}}` when signed in;
guest error details add `guestTransferEnabled:true`. Older responses still retain
identity and ordinary guest/workspace use, but cannot enable new transfers.
All transfer creation/upload/status/operation/access/document requests carry
`X-Scribble-Account:<bound UUID>`. The authenticated middleware rejects a changed
or malformed actor with **409 ACCOUNT_CHANGED**, before body parsing or storage.
This fences a cookie change immediately before dispatch, including the final
document read, while retaining the original account's intent.

Release order: existing SQL migrations 9–11 -> M7-compatible backend -> frontend.
No new SQL, Prisma, package or real provider changes. Next SQL remains **12**.
Rollback preserves the v4 opener, receipt tables and namespaced transfer records;
an older frontend ignores these records. Routine manual save/copy/image controls
remain until M8/M9. Automatic uploads outside this explicit transfer remain M8.

## Verification

233 focused client/controller/session/auth/access cases passed, including 19 durable
transfer cases. 26 standard account/UX browser regressions passed. 26 distinct actual
browser/API/Prisma/PostgreSQL cases passed across focused runs: 16 M7 journeys and
10 M6 navigation regressions. The transfer suite covers empty/selected/declined,
later import, three failed/canceled auth returns, lost create/upload/document
responses, newer edits, invitation/page priority, account switching including
dispatch-time cookie replacement and the final read, canceled local preparation,
keyboard/mobile consent, and failed local intent storage. Early fixture
synchronization/redirect interception errors were corrected
and the affected journeys rerun successfully.

```text
npm test -- src/api/auth.test.ts src/persistence/guestTransfer.test.ts src/api/boards.test.ts src/api/assets.test.ts src/persistence/workspaceController.test.ts src/persistence/accountBoardSession.test.ts server/authRoutes.test.ts server/boardAccess.test.ts
npm run test:e2e -- e2e/ux-simplification.spec.ts e2e/account-boards.spec.ts --output=test-results/m7-browser-verified
npm run test:e2e:integration -- e2e-integration/guest-transfer.spec.ts --output=test-results/m7-transfer-verified
npm run test:e2e:integration -- e2e-integration/guest-transfer.spec.ts e2e-integration/workspace-navigation.spec.ts --output=test-results/m7-integration-final
npm run build
npm run build:server
npx tsc -p e2e-integration/tsconfig.json
npx tsc --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution Bundler --jsx react-jsx --lib ES2023,DOM --types vite/client,node src/persistence/guestTransfer.test.ts src/persistence/workspaceController.test.ts src/persistence/accountBoardSession.test.ts src/api/auth.test.ts src/api/boards.test.ts server/authRoutes.test.ts server/boardAccess.test.ts
git diff --check
```

Both builds and strict touched-test/fixture typechecks pass. Mobile consent screenshot:
`../workspace-ux-evidence/m7-mobile-consent.png`. Definition/data fingerprints for
all 12 normal tables/14 rows match before/after; zero disposable schemas remain:
`../workspace-ux-evidence/m7-database-isolation.json`. Docker Desktop and the existing
5434 PostgreSQL container were stopped initially and started for these checks;
they are left running. No normal/production migration, commit, push or deployment.

The OAuth provider and image storage are controlled fixtures; the auth router,
cookies, API, Prisma and PostgreSQL are real local code. **Real Google/provider
acceptance is pending**: verify empty, selected drawing/images, declined, canceled,
invitation-priority and sign-out restoration using the configured Google account
and compatible backend after a separate release decision. Physical native IME,
sleep/device acceptance and the full integrated release matrix remain M11.
