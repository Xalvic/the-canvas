# Google-only authentication

Status (2026-10-05): implemented local Google sign-in, PostgreSQL users/sessions,
current-user lookup, logout, and an optional React account section. No password
signup/login is implemented. Migrations 1–6 are applied to Docker PostgreSQL on port
5434; portable PostgreSQL/configuration is untouched. Google web-client settings
are configured in ignored `.env.docker`. On 2026-10-04 the user verified real
Google sign-in in Chrome at `http://127.0.0.1:5173/scribble/`, staying signed in
after reload, and successful sign-out. This is user-reported live verification;
automated tests use controlled sessions. Credentials remain outside Git.

Board/document routes require a valid session and enforce ownership or accepted
editor/viewer membership in SQL. Owners manage sharing/deletion, editors edit and
rename, and viewers read. See [sharing.md](sharing.md).
Signed-out/expired sessions return 401; unshared, unowned legacy and missing board
IDs return 404. Writes require `X-Scribble-Request: 1` and an allowed origin.
The API still binds to 127.0.0.1. Signing in does not upload, replace, or associate
the guest drawing. Unowned demo records are preserved and hidden from accounts.

## Configure the Google web client

Create/select your own project in the [Google Cloud console](https://console.cloud.google.com/).
In Google Auth Platform, configure the app's branding/support email and audience.
For an external app in Testing, add the Google accounts you will test with.
Create an OAuth client of type **Web application** and register this exact
authorized redirect URI:

```text
http://127.0.0.1:3001/api/auth/google/callback
```

Google allows HTTP/loopback IP redirect URIs for local development; other
deployments need HTTPS. The URI must exactly match the registered client value.
See [Google's web-server flow and redirect rules](https://developers.google.com/identity/protocols/oauth2/web-server).

Keep the existing DATABASE_URL in ignored `.env.docker`. Add these backend-only
values using your actual web-client ID/secret:

```dotenv
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_WEB_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://127.0.0.1:3001/api/auth/google/callback
AUTH_FRONTEND_URL=http://127.0.0.1:5173/scribble/
```

Do not prefix the secret with VITE_, put it in frontend code, Postman, or Git,
or paste it into chat. `.env.example` has commented setup entries. This server
redirect flow does not require a Google browser SDK or JavaScript-origin setting.
It requests only openid, email and profile, with no offline access/Drive scopes.

Use 127.0.0.1 consistently for both app and callback: cookies are scoped to a host,
so mixing localhost and 127.0.0.1 breaks the browser binding. Restart the local
API after configuring credentials; the proof API may already be running on port
3001, so stop that instance before starting a replacement:

```text
npm run dev:server:docker
npm run dev -- --port 5173 --strictPort
```

Open http://127.0.0.1:5173/scribble/. The account section in Server boards offers
**Sign in with Google** once the API reports configuration available. Sign in,
verify the displayed account, reload, sign out, and verify guest drawing remains.
Missing settings leave Google disabled while the guest canvas remains usable.
Partial/mismatched settings fail startup without exposing credential values.
Other frontend ports need a matching AUTH_FRONTEND_URL.

## Implemented request path

| Route | Behavior |
| --- | --- |
| GET /api/auth/google | 302 to Google with state, nonce and S256 PKCE; 503 GOOGLE_AUTH_NOT_CONFIGURED without credentials; repeated starts limited to 20 per IP/10 minutes |
| GET /api/auth/google/callback | Consume the browser-bound, unexpired flow once, verify Google, create/reuse user and session, then 303 to the configured frontend |
| GET /api/auth/me | 200 with `{ user: { id, email, displayName } }`; absent/invalid/expired sessions return 401 UNAUTHENTICATED and clear the cookie |
| POST /api/auth/logout | Revoke this session and clear cookies; idempotent 204. Requires X-Scribble-Request: 1, rejects hostile Origin/cross-site metadata |

The unauthenticated me response includes error.details.googleSignInEnabled so
the React account section can offer sign-in or show temporary unavailability.
Callback errors redirect with only authError=denied, invalid_state or failed.
They never expose provider errors, codes, or tokens. The frontend displays and
removes this query, including under React Strict Mode.

server/authConfig.ts validates fixed callback/frontend URLs. server/authRoutes.ts
creates fresh state, browser binding, nonce and PKCE verifier. Migration 3 stores
the short-lived flow in google_auth_flows; only state/browser hashes are retained.
An atomic conditional DELETE consumes a matching flow before code exchange, so
parallel/replayed callbacks cannot create duplicate sessions. Flows expire after
10 minutes. A failed exchange requires a fresh sign-in attempt.

server/googleAuth.ts uses Google's official google-auth-library to exchange the
authorization code with its verifier and verify the ID token's signature,
Google issuer, client audience and expiry. It also requires the expected nonce
and verified email. The stable Google sub identifies the local user, not email;
an email change updates the same user, while two subjects never merge by email.
See [Google OpenID Connect identity requirements](https://developers.google.com/identity/openid-connect/openid-connect).

server/postgresAuth.ts creates/updates the user, revokes this browser's previous
session, and inserts the new session in one transaction. PostgreSQL stores only
a SHA-256 hash of a random 256-bit session token. Google access/refresh/ID tokens
are not stored. sessions expire after seven days, checked by the database clock;
logout deletes the row. Expired sessions/flows are cleaned on new creation.
Session foreign keys and session/flow expiry constraints are in
db/003_create_google_auth.sql.

The session cookie is HttpOnly, SameSite=Lax, host-only, Path=/api. The flow cookie
uses Path=/api/auth/google. HTTPS settings enable Secure; HTTP is restricted to
loopback configuration. Tokens never enter localStorage/IndexedDB. Logout uses a
required non-simple header and no cross-origin CORS allowance, plus Origin and
fetch-metadata checks. SameSite is an additional protection, not the only check.
The start limiter is local/in-memory; shared rate limiting is a deployment task.
Reference: [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
and [CSRF protections](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Guest editing and verification

src/components/Account/Account.tsx owns account display only. It aborts stale
requests and supports retry/logout failures without mutating editor stores.
Before navigating to Google, waitForLocalBoardSave subscribes to the existing
board save status until IndexedDB has acknowledged the latest revision. It
does not issue a competing persistence write or change the guest format. Save
failure/timeout keeps the user on the canvas. Page navigation reloads the app
normally; selection/history remain session state rather than server content.

Verified: 279 fast checks, 34 real Docker database checks, three browser scenarios,
server type check/build and frontend type check/build. The same two Zod build
annotation warnings remain. Tests cover real RSA signatures and rejected
issuer/audience/expiry/nonce/email claims with Google network I/O stubbed; no
test sign-in bypass exists in the running API. PostgreSQL cases cover migration
upgrade/rollback, callback replay/races/expiry, Google subject identity, transaction
rollback, rotation/revocation/cascade and new connections/application instances.
Browser checks cover optional account state, cancellation in Strict Mode, logout
failure/retry, keyboard isolation, mobile layout and fresh guest-save navigation.

```text
npm test
npm run test:database:docker
npm run test:e2e -- e2e/authentication.spec.ts
npm run typecheck:server
npm run build:server
npm run build
```

The cloud Scribble API collection has Google authentication requests/examples/
assertions; its verified cloud copy passed lint (46 requests, no issues) and a
local run (46 requests, 145 assertions, zero failures), preserving existing items
and variables. Run with redirects disabled: postman collection run <local mirror>
--ignore-redirects --no-report-events. No configured live Google login is claimed
by its start/callback unavailable checks. Browser consent requires your client.

Ownership verification (2026-10-04): 297 fast tests, 39 real DB tests, four
private-list browser scenarios plus three account scenarios, server typecheck
and both builds passed. The updated cloud Postman collection preserves existing
IDs/scripts and its fetched-back copy passes lint and 69 requests / 228 assertions.
Supply session values only through a private local environment; no development
login route was added. Automated proofs create and remove isolated DB schemas/accounts.

Live Google setup is complete: the user verified sign-in, session persistence
after reload and sign-out in Chrome on 2026-10-04. Configuration validation also
confirmed Google credentials are present and the local callback/frontend URLs
match, without printing credentials.

Account save/open is implemented and committed as `7449241`. On 2026-10-04 the
user confirmed completed live Google account save/open verification against the
local backend. TanStack Query now caches account server state and clears private
snapshots on logout/expiry/account changes; draft recovery stays in IndexedDB and
canvas/editor state stays in Zustand. Automated account browser scenarios use
mocked HTTP; a real browser/API/DB fixture and deployment verification remain.
Prisma is integrated with SQL as the migration authority; see [prisma.md](prisma.md).
Sharing now adds accepted editor/viewer memberships, email-addressed invitations
and owner-only sharing/deletion. All routes still use the existing Google session
and mutation-origin checks. See [sharing.md](sharing.md). Backend cloud-image
storage is implemented; frontend image upload/loading and deployment remain
pending. See [cloud-images.md](cloud-images.md).
Queue: [implementation-status.md](implementation-status.md).
Keep the guest-upload choice explicit. The user authorized committing and pushing this
slice with the completed storage work at the end of 2026-10-02. Future commits
and pushes require fresh authorization.
