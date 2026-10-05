# Real browser integration tests

Run `npm run test:e2e:integration` with the existing Docker PostgreSQL service
running on loopback port 5434 and its connection in ignored `.env.docker`.

Playwright starts a separate API on port 4301 and Vite on port 4174. The API uses
the real Express routes, validators, Prisma repositories and SQL migrations in
a random `scribble_browser_test_*` schema. Tests never reset the supplied
database or touch the portable PostgreSQL service on port 5433.

Google identity is supplied through a test-only session endpoint. Sessions are
created by the actual PostgreSQL authentication repository and use the same
HttpOnly cookie as the app. OAuth/Google network behavior remains outside this
suite. Test controls are available only in this standalone fixture, bind to
loopback and require an ephemeral header token. They are never added to the
production app.

Image normalization, authorization, quotas, metadata and document references
use the real backend. A controlled image provider holds uploaded bytes in
memory and returns signed, expiring URLs served through Vite. No API requests
are mocked in the browser, no ImageKit credentials are used, and no ImageKit
files are created or deleted. Vite's test mode permits only loopback HTTP image
URLs for this fixture; normal frontend modes require HTTPS.

The teardown endpoint drops only the fixture-owned schema before acknowledging
completion. Signal/startup-error cleanup provides the same scoped teardown.
Playwright waits for that acknowledgement before ending its child processes,
including on Windows.

The image scenarios cover explicit guest upload, fresh-device signed rendering,
failed upload and draft reload/retry, cross-board copy, save-as-new after a real
revision conflict, editor/viewer permissions and revocation, and signed access
refresh/retry. Screenshots and traces are retained for failures using the
existing Playwright output directory.

Two-context collaboration scenarios use the actual authorized SSE, presence and
operation routes. They verify simultaneous creates and independent edits,
object conflicts and recovery copies, undo with remote changes, cursor world
coordinates under pan/zoom, offline edits and reconnect, lost-response replay
after reload, and editor downgrade/removal without losing local drafts.

The bounded network control can drop one successful operation response after
the backend commits. PostgreSQL operation receipts are inspected to prove that
recovery replays the same operation without creating a second revision. This
control changes test transport only; the real API implementation handles the
request and durable mutation.

Same-device cross-tab scenarios verify guest takeover, one canonical account
draft writer, different-board editing, fresh permission reads and stale-writer
recovery/history cancellation. The sharing scenario uses actual owner invitation
UI, recipient acceptance, editor saves, owner downgrade/removal and private draft
preservation; membership is not injected by a fixture control in that case.

All 16 scenarios are locally verified. PWA/offline app loading is out of scope;
Google consent, actual ImageKit delivery and deployed hosting remain separate
checks. These fixtures never modify the normal database schema or existing images.

To typecheck fixture, configuration and browser test sources together:

```sh
node node_modules/typescript/bin/tsc -p e2e-integration/tsconfig.json
```
