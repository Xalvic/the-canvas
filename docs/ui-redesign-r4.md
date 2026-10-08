# UI redesign R4: authenticated reusable links

2026-10-07 (Asia/Calcutta). **Verified locally.** Authority:
[UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md), R4 only.

## Contract and implementation decisions

Migration 12 adds `board_share_links`, `board_share_link_grants`, and
`board_share_link_receipts`. Existing pages have no link row and default to
disabled, viewer, generation 0, version 0. No document or IndexedDB format changes.

| Endpoint | Contract |
| --- | --- |
| GET `/api/boards/:id/share-link` | Owner only, `{settings:{enabled,role,generation,version}}`; never activates or returns secrets. |
| POST `/api/boards/:id/share-link/copy` | Owner only; `{requestId,expectedVersion}`. Enables a fresh generation or reuses the active token. Returns `{settings,token,requestId,replayed}`. |
| PATCH `/api/boards/:id/share-link` | Owner only; `{requestId,expectedVersion,role}` or `{requestId,expectedVersion,enabled:false}`. Every accepted settings intent increments version, including a repeated Stop. Returns nonsecret settings and request identity. |
| POST `/api/share-links/open` | Authenticated Google account; `{token}`. Idempotently records that account's current-generation grant and returns `{board}` with its effective role. |

The client constructs the URL using its origin and Vite BASE_URL, with only
`#share=<43-character base64url token>`. This module supplies the typed API boundary;
Share/settings/sign-in/navigation UI remains R5. No public board routes.

Owner mutations serialize on the parent board, using the same lock as writes,
uploads, deletion and explicit sharing. A dedicated durable receipt binds the
board, actor, request ID and exact intent. Replay checks current ownership and
current settings before returning material. A superseded receipt returns
`SHARE_LINK_REQUEST_SUPERSEDED`, never an old token or a new activation. A stale
version returns `SHARE_LINK_VERSION_CONFLICT` with current nonsecret settings.
Clients retain the original request identity after uncertain transport outcomes;
they never generate a replacement retry or silently rebase settings.

Tokens use existing `randomToken`/`hashToken` (32 random bytes / SHA-256). Recoverable
material uses Node AES-256-GCM with a random 12-byte IV and a 16-byte authentication
tag, authenticated with board ID and generation using the
[Node authenticated-encryption API](https://nodejs.org/api/crypto.html#ciphersetaadbuffer-options).
Only encrypted material and its
verification digest enter PostgreSQL. `SHARE_LINK_KEY` is an optional backend-only
64-hex-character (32-byte) key; never use a VITE prefix. Keep the same key across
restarts and replicas. Missing key disables the advertised capability and all
link endpoints; bad configuration fails without printing the value. Key loss or
rotation makes Copy unavailable for existing active links. With a replacement key
configured, Stop remains possible, then Copy creates a fresh generation using that
key. With no configured key, all link endpoints remain unavailable. There is no automatic
key rotation or secret fallback to OAuth/proxy credentials.

Permission resolution gives owner priority, then the greater of explicit
membership and a grant whose generation matches an enabled link. The link's
current role applies dynamically. Stop clears recoverable material/digest;
re-enable increments generation. Old grants remain inert until the new URL is
opened. Direct board IDs never create grants. Shared lists, workspace selection,
documents, operations/replay, assets/uploads and collaboration state use the same
permission helpers. Explicit invitations/membership remain independent.

Routes use existing session, CSRF/origin and expected-account checks, bounded body
parsing, and per-account admission. Production uses durable IP/user budgets plus
a specific link budget; development uses a bounded in-memory link budget. Owner
mutation receipts also have a transactionally checked hourly actor limit.
Unavailable tokens use one privacy-preserving error; request logs contain only a
route category and never tokens, bodies or titles.

## Release and limits

Rollout order: SQL 12 -> compatible backend with SHARE_LINK_KEY -> R5 frontend.
SQL remains the migration authority; Prisma only maps it. Never apply SQL 12 to
production during this milestone. Older frontends retain explicit sharing.
Older backends advertise no link capability and ignore grants, safely closing
link access while retaining additive rows and explicit membership. Keep SQL 12
on rollback; do not drop grants/receipts or roll back unrelated journal support.

Live SSE rechecks session and effective access every second by default. Downgrade
sends the viewer role; revocation sends an access event and closes the stream.
Already downloaded content cannot be recalled. ImageKit signed URLs last 300
seconds; protected API responses use no-store. No new URL is signed after a
request observes revocation. Existing image signing stays synchronous after
current authorization; in-flight reads retain the established boundary.

## Validation

| Gate | Result |
| --- | --- |
| Fast checks | **844 passed**. Includes 16 new server crypto/route checks, 13 new client checks and two capability-version checks, plus inherited editor/session/persistence regressions. Database cases are skipped in this gate and run separately. |
| Real PostgreSQL | **176 passed** across 13 suites, including **25 R4 cases**. Existing auth, explicit sharing, documents, workspace, images, upload receipts, operations and SQL/Prisma alignment pass. |
| Link behavior | Multi-account reuse, idempotent join, viewer/editor/owner limits, greater-permission membership, legacy invitations, direct-ID privacy, revocation and fresh generations verified through actual SQL and Express routes. |
| Race/recovery | Concurrent copies/settings/open, waiting save/redemption behind a committed downgrade/Stop, request reuse/supersession, persistent admission and safe key replacement pass. A real API process commits Copy, deliberately drops the response, exits, then a new process reconciles the same request and returns the same active token. |
| Images/live | Reads/signing, ready-upload replay/status, original-actor fencing, viewer downgrade, revocation and finalization after provider I/O are covered. Live HTTP SSE emits viewer role and ends after Stop/logout within a 3-second test deadline per access change; its production default poll remains 1 second. |
| Builds/types | Frontend build, backend build/typecheck, Prisma validation and strict fixture/client-aware TypeScript pass. The inherited SQL/Prisma comparison runs on a disposable migrated schema. |
| Normal local DB | **15 tables / 32 rows unchanged**, including row, column, constraint and index hashes. Normal migration ledger stays at **11**; zero disposable test schemas remain. |
| Inherited work | **201 protected entries unchanged** by SHA-256/Git status. Learning documents and R0-R3 evidence unchanged; old-plan deletion preserved. Only authorized R4 files changed; diff checks pass. |

Reproduce from the repository root:

```text
npm run db:generate
node --env-file=.env.docker ui-redesign-evidence/r4-validate.mjs
npx tsc -p ui-redesign-evidence/r4-typecheck.json
npm run typecheck:server
npm run build:server
npm run build
npm run db:validate
node ui-redesign-evidence/r4-check-preservation.mjs
git -c core.safecrlf=false diff --check
```

The validation runner enforces a loopback database connection and uses new random
schemas. The ordinary database runner now includes R4 as well. Old migration
fixtures were adjusted only to retain/add ledger entry 12 and remove its additive
tables when intentionally reconstructing an older schema.

Evidence: [fast report](../ui-redesign-evidence/r4-fast-results.json),
[database report](../ui-redesign-evidence/r4-database-results.json),
[normal database fingerprints](../ui-redesign-evidence/r4-database-isolation.json),
[preservation result](../ui-redesign-evidence/r4-preservation.json), and
[inherited baseline](../ui-redesign-evidence/r4-inherited-work.json).

Sessions are disposable test identities. Image checks use local test storage;
no Google/ImageKit/provider or production data was changed. No new dependencies,
normal-database migration, local secret configuration, commit, push or deployment.

R4 is complete. Next is R5: wire the direct Share action, Link settings and
recipient/sign-in/workspace intent flows into the existing application lifecycle.
Preserve original mutation IDs across unknown outcomes and respect capability
version 1. Keep guest drawing and explicit transfer consent independent. Local
or release activation requires SQL 12 and a stable backend SHARE_LINK_KEY; both
remain unapplied to the normal local database/provider environment here.
