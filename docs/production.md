# Production delivery preparation

Status: prepared for review, not deployed. The current frontend is at
`https://milanputhukkudy.com/scribble/`; Express and PostgreSQL remain local.
PWA installation/offline app loading and Postman maintenance are out of scope.
No paid resource, ImageKit plan change, remote database or deployment was created.

## Configuration to enter locally

Copy `production.env.example` to ignored `.env.production`. Keep credentials out
of chat, Git, frontend variables and build artifacts. Choose an Express Docker
host and its HTTPS origin hostname (`API_ORIGIN_HOST`). The portable Compose
template uses Caddy for HTTPS and exposes no API port directly. Managed container
hosting can supply HTTPS instead; keep the same environment and origin guard.
Run one Express replica initially: durable edits and rate budgets support restart,
but presence currently lives in one process. Multiple replicas require shared
presence and connection routing before enabling them.

Configure these values together:

| Setting | Where to obtain/set it |
| --- | --- |
| `DATABASE_URL` | Neon pooled URL for the application, with `sslmode=verify-full` |
| `DIRECT_DATABASE_URL` | Neon direct URL for SQL migrations and backups, same database/role |
| `AUTH_FRONTEND_URL` | `https://milanputhukkudy.com/scribble/` |
| `GOOGLE_REDIRECT_URI` | `https://milanputhukkudy.com/api/auth/google/callback`, also registered in the Google Web OAuth client |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Existing Google Web OAuth client; retain local redirect too if local sign-in remains needed |
| `SCRIBBLE_PROXY_SECRET` | Generate at least 32 random bytes; set the same value in backend env and the existing Cloudflare Worker's secret store |
| `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_FOLDER` | Backend-only restricted ImageKit key/endpoint; production folder `scribble/production` |
| `SCRIBBLE_API_IMAGE` | Reviewed immutable image tag or digest |

Set `DEPLOYMENT_ENV=production` to enable fail-closed production guards. Secure
Google cookies use the public HTTPS origin. Never use `VITE_` for these settings,
disable certificate verification, or set `CONTAINER_DATABASE_HOST` for Neon.
Retain the ImageKit free plan; the app's storage/issuance limits are application
budgets, not a guarantee against CDN reuse charges. Inspect provider usage and
the actual plan before deployment; no automatic upgrade is configured.

Neon connection strings are not configured yet. Create/select an appropriate
project and least-privileged app role yourself without enabling paid resources.
Do not import the portable database or local guest boards automatically. SQL
migrations, rather than Prisma migrations, own schema changes. The application
pool is bounded at five connections. Use a direct connection for migrations,
`pg_dump` and restore; retain pooled application connections for normal requests.

## Cloudflare integration

`deployment/cloudflare/api-proxy.ts` is a reviewed integration module. Call it
before static/site routing in the **existing** personal-site Worker. It handles
root `/api/*`, `/health` and `/ready`; leave the current `/scribble/` frontend and
other site routes with their existing handler. The existing Worker source is
outside this repository, so its integration and route configuration need review
before deployment. `worker.example.ts` and `wrangler.example.jsonc` demonstrate a
standalone `/scribble/` asset handler; they must not replace the personal-site
Worker wholesale.

Set Worker `PUBLIC_ORIGIN=https://milanputhukkudy.com`, `API_ORIGIN=https://<chosen
origin host>` and secret `SCRIBBLE_PROXY_SECRET`. The proxy replaces identity
headers with Cloudflare's client IP and the private origin secret. It streams SSE
and image bodies, returns OAuth redirects/cookies without following them, and
never retries a mutation or caches API responses. Origin middleware rejects
direct API requests without the matching secret. Disable Cloudflare cache rules
for `/api/*`, `/ready` and authentication routes; no Service Worker is installed.

The backend preserves CSRF checks using the browser's public `Origin` and
`X-Scribble-Request: 1`; same-origin routing avoids cross-site session cookies.
Do not add permissive CORS to work around a routing error. Preview domains must
not use production Google credentials or production private sessions.

## Review, migrate and release

The checked-in CI workflow uses read-only repository permissions, pinned Actions,
Node 24, a disposable PostgreSQL service, both builds, unit/database/browser
checks and Docker restart proofs. It produces review artifacts; it never publishes
an image or deploys. CI execution on GitHub remains unverified until the files are
committed/pushed with separate approval. Review the repository's Actions quotas
before enabling hosted runs. Local test fixtures do not use real Google/ImageKit
credentials. Browser traces may contain private fixture content; do not publish
production traces.

After separate deployment approval, use a reviewed host checkout and immutable
image. These commands are preparation instructions, not actions already run:

```sh
docker build -t scribble-api:<reviewed-commit> .
docker compose --env-file .env.production -f deployment/compose.production.yaml config --quiet
docker compose --env-file .env.production -f deployment/compose.production.yaml run --rm --no-deps api migrate
docker compose --env-file .env.production -f deployment/compose.production.yaml up -d --wait
```

Take and verify an encrypted backup **before** migrating an existing production
database. The migration runner uses `DIRECT_DATABASE_URL` when configured,
transactional SQL and the existing migration ledger. It does not reset or seed
user content. Keep existing local `.env.docker`, volume and port 5434 unchanged.
The portable database on port 5433 is outside this workflow. Roll back application
code to the previous immutable image when compatible; do not blindly roll SQL
back or restore over a live/nonempty database. Restore into a new empty database
and validate before switching the application URL.

## Monitoring, cleanup and backups

`/health` is process liveness; `/ready` is bounded database readiness. Monitor the
public `/ready` through the Worker. Request logs contain generated request IDs,
method, route category, status and duration, with no cookies, query strings,
document bodies, email addresses or signed URLs. Preserve request IDs when
investigating errors. Production request budgets are durable across restarts;
429 responses include `Retry-After`. SSE and upload limits remain enforced.
Caddy's default error-log filter also removes request/header objects, including
OAuth query parameters and the custom proxy secret. Six actual Docker/Caddy
checks validate the configuration and a real upstream 502 with no private test
markers logged (`node scripts/proxy-log-proof.mjs`). Keep that filter when
adapting hosting; disabling access logs alone does not sanitize proxy errors.

Linux systemd templates in `deployment/systemd/` are prepared, not enabled.
Use checkout `/opt/scribble`, a service account able to run Docker, Node 24, and
locally protected files. Put direct backup URL, a 64-character hexadecimal key
representing 32 random bytes (`BACKUP_ENCRYPTION_KEY`), and `BACKUP_DIRECTORY` in ignored
`.env.backup`. Put `MONITOR_PUBLIC_ORIGIN=https://milanputhukkudy.com` and the same
backup directory in `.env.monitor`. Daily encrypted backups run at 02:15 UTC;
unfinished-upload cleanup runs at 03:15 UTC with jitter. Five-minute readiness and
backup freshness checks fail nonzero on outage or no backup within 36 hours.
Configure the host's service-failure notification destination before enabling
timers; no email/chat notification or external monitoring account is created here.

Cleanup only reclaims unfinished, confirmed-abandoned uploads. Every completed
asset stays retained for saved documents, drafts and undo, including removed
images/deleted boards. Reclamation of completed assets requires an explicit
recovery/history lease and discard policy; it is not implemented. Provider usage,
budget refusals and cleanup failures need operational review. See
[backup and restore](backups.md) for encrypted archives, separate key custody,
restore verification and ImageKit binary retention. Offsite backup export and
its storage destination remain user configuration; a host disk alone is not a
disaster-recovery copy. No existing backup is automatically deleted.

## Deployment verification still pending

After approved deployment: verify HTTPS/redirects and Secure/HttpOnly cookies,
real Google sign-in/reload/logout, unauthenticated and revoked access, two-user
collaboration/presence, signed image expiry/retry/copy/recovery, guest IndexedDB,
cross-tab ownership, readiness/429, cleanup and scheduled backup/restore. Confirm
API responses never enter edge/browser caches. Exercise rollback against the
chosen host and restore a production backup into an isolated Neon branch/database.
No local fixture result substitutes for these deployed checks.

References: [Cloudflare Request/redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/),
[Cloudflare fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/),
[GitHub workflow syntax and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[Neon connection pooling](https://neon.com/docs/connect/connection-pooling),
[PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).
