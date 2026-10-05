# Cloud image assets: backend milestone

Updated: 2026-10-05. Backend integration is implemented. Frontend image
upload/loading and backend/database deployment remain pending.

## How the pieces connect

Express accepts an authenticated upload for one board. It checks the current
owner/editor permission, validates and re-encodes the image, then reserves an
asset row in PostgreSQL. The ImageKit adapter uploads a private file at
`scribble/dev/<board UUID>/<asset UUID>.<extension>`. Only a confirmed upload
becomes a `ready` asset. The API returns its UUID and image metadata.

The board's JSONB document stores that UUID in an image object. It stores no
private key, ImageKit file identifier, signed URL, base64 data or local blob ID.
When the image must be displayed, a separate API checks the user's current
board permission and issues a URL valid for five minutes.

Prisma maps the metadata tables and runs the existing transaction/permission
logic. PostgreSQL holds board documents, asset metadata and durable request
budgets; ImageKit holds the image bytes. SQL remains the migration authority.
Migration `db/006_create_board_assets.sql` adds `board_assets` and
`asset_request_budgets`; Prisma maps them as `BoardAsset` and
`AssetRequestBudget`. Existing board documents and guest IndexedDB data are
preserved. Login never uploads guest boards or images automatically.

## Local configuration

Enter these values in the ignored backend `.env.docker` file when using Docker
PostgreSQL. Enter the private key locally, never in chat or a shared Postman
environment:

```dotenv
IMAGEKIT_PRIVATE_KEY=<your restricted private key, entered locally>
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/scribblemilan/
IMAGEKIT_FOLDER=scribble/dev
```

No public key or `VITE_` image variable is required. The private key stays in
the Express process. All three missing settings disable cloud image APIs with
a clear `503 IMAGE_STORAGE_UNAVAILABLE`; partial or invalid configuration
stops startup with a safe message naming the environment variables.

Keep ImageKit's signed-image-request requirement enabled. The adapter also
sets every uploaded file private and never overwrites an existing file.

Use the restricted key with **Media management: Read and write** and
**Account management: None**. ImageKit documents that media access includes
upload, listing/details and deletion; account access controls origins and URL
endpoints, which this backend does not manage. Signing happens locally with
the private key. The generated key's actual upload/read/sign/delete behavior
was also verified with disposable files. [ImageKit API key documentation](https://imagekit.io/docs/api-keys).

After entering configuration, the existing Docker commands apply SQL
migrations and start the local backend:

```powershell
npm run db:migrate:docker
npm run dev:server:docker
```

The deployed frontend remains at `https://milanputhukkudy.com/scribble/`.
There is no deployed backend URL yet, so Postman's configurable `baseUrl`
continues to default to `http://127.0.0.1:3001`.

## API contract

Both routes require the existing Google session cookie. Uploads also require
`X-Scribble-Request: 1` and the existing permitted-origin checks.

| Route | Current board role | Body/result |
| --- | --- | --- |
| `POST /api/boards/:id/assets` | Owner or editor | Raw binary JPEG, PNG or WebP; returns `201 { asset }` and the read route in `Location` |
| `GET /api/boards/:id/assets/:assetId` | Owner, editor or viewer | Returns `{ asset }` with a freshly signed `url` and `expiresAt` in Unix milliseconds |

Uploads use an exact `Content-Type` of `image/jpeg`, `image/png` or
`image/webp`. Send image bytes directly, without multipart, JSON, base64 or
request compression. Returned metadata contains `id`, `boardId`, `mimeType`,
`byteSize`, `width`, `height` and `createdAt`.

A completed asset must belong to the board named in the URL. Missing assets,
unfinished assets and assets from another board cannot be read through it.
Unauthorized accounts receive `BOARD_NOT_FOUND`, preserving the existing
private-board behavior. Viewers cannot upload.

Every signed URL issuance checks current access in PostgreSQL. Responses use
`Cache-Control: no-store`. Revocation prevents new URLs immediately; an
already issued URL can work until its five-minute expiry. The browser will
eventually refresh expired URLs through this API instead of keeping them in
the saved document.

## Image validation and limits

The backend checks actual file signatures and requires the declared MIME type
to match. Sharp fully decodes the image and re-encodes it, stripping metadata
and appended content while applying EXIF orientation. Supported formats are
static JPEG, PNG and WebP. SVG, GIF, APNG, animated WebP, corrupted files and
unsupported dimensions are rejected.

| Limit | Backend allowance |
| --- | --- |
| Single image | 5 MiB for both original request and validated stored bytes |
| Image dimensions | At most 4096 on either side and 16 million total pixels |
| Concurrent uploads | Two per server process; one per user; 30-second upload-body timeout |
| Upload attempts before decoding | Ten per user per hour in the server process |
| Durable uploads | Ten reservations per uploader in a rolling hour; 50 MiB per rolling day |
| Board storage | 100 active assets and 100 MiB |
| Global managed storage | 2,000,000,000 bytes reserved in PostgreSQL |
| Signed URL issuance | 120 per user per UTC hour |
| Global monthly issuance budget | 10,000,000,000 bytes, charging the asset's size per issued URL |

Reservations count against storage while pending or awaiting deletion.
Durable upload/signing budgets survive API restarts and multiple instances.
In-process limits also bound unsuccessful requests before allocating/decoding
large images; they reset when the process restarts.

ImageKit's published Forever Free plan allows 3 GB storage and 20 GB monthly
bandwidth. The limits above leave headroom for the existing manually uploaded
image and other usage. They track this application's reservations and newly
issued URLs, not unrelated files or repeated CDN downloads with an existing
URL. They therefore cannot guarantee a hard provider bandwidth cap. Continue
using the free plan and review provider usage before deployment; the active
subscription screen has not been independently confirmed. [ImageKit pricing](https://imagekit.io/plans/).

## Saving image references

`PUT /api/boards/:id/document` accepts the existing non-image objects plus
cloud image objects. An image example is:

```json
{
  "schemaVersion": 1,
  "expectedRevision": 0,
  "content": {
    "objects": [
      {
        "id": "image-1",
        "type": "image",
        "assetId": "550e8400-e29b-41d4-a716-446655440010",
        "x": 100,
        "y": 200,
        "width": 320,
        "height": 180,
        "originalWidth": 1920,
        "originalHeight": 1080,
        "zIndex": 1,
        "createdAt": 10,
        "updatedAt": 10,
        "name": "Sketch",
        "mimeType": "image/png"
      }
    ]
  }
}
```

The UUID is illustrative: use the actual `asset.id` returned by an upload to
this board. `originalWidth` and `originalHeight` are required positive integer
dimensions; `name`, `mimeType` and the existing `groupId` are optional.
Unknown fields, including `url` and `src`, are rejected.

The backend checks revision, permission and every image asset within the same
parent-board-lock transaction. Every reference must be `ready` and belong to
this board. A missing, unfinished or cross-board reference rejects the entire
save with `422 INVALID_ASSET_REFERENCE`. Stale saves retain the existing
`409 REVISION_CONFLICT` behavior. A failed save neither changes the document
or revision nor marks a newly uploaded asset as saved.

This cloud document validator is backend-only. The current frontend adapters
continue rejecting image-containing cloud saves until the next milestone
adds explicit upload and signed-image rendering. Local guest images remain
in IndexedDB and keep their existing behavior.

## Failures, retention and cleanup

An upload reservation is durable before contacting ImageKit. Provider I/O
happens outside the database transaction. If upload completion is uncertain
or finalization loses permission, its pending row remains: the file might
exist even when its HTTP response was lost. The exact provider path lets
cleanup reconcile that reservation later. Upload failure never changes the
board document or immediately frees potentially occupied storage.

Every asset successfully referenced by a committed document is retained for
this milestone, including after later image removal or board deletion.
This preserves recovery possibilities and avoids immediate deletion during
undo or save failure. A future retention policy for formerly saved assets is
separate work; retained files continue to consume the storage allowance.

Only never-saved pending/ready assets older than 24 hours are cleanup
candidates. Cleanup takes the parent-board lock and rechecks whether a save
protected each candidate. It marks candidates `deleting`, then looks up the
exact reserved provider path or deletes the recorded file ID. Confirmed
provider deletion/absence changes the row to `failed`, releasing storage.
Failures retain the reservation and retry after a 15-minute lease. ImageKit
listing is eventually consistent; the 24-hour grace also avoids immediate
absence decisions after upload.

Run a bounded batch of up to 20 candidates when needed:

```powershell
npm run assets:cleanup:docker
```

There is no automatic cleanup schedule yet. The command prints only safe
counts (`claimed`, `deleted`, `deferred`) and returns failure when operations
remain deferred. It uses only application asset rows, preserving the existing
manually uploaded image.

| HTTP status | Relevant error codes |
| --- | --- |
| 400 | `VALIDATION_ERROR` for malformed IDs/documents and forbidden fields |
| 401 | `UNAUTHENTICATED` |
| 403 | `CSRF_REJECTED`, `BOARD_FORBIDDEN` |
| 404 | `BOARD_NOT_FOUND`, `ASSET_NOT_FOUND` |
| 409 | `REVISION_CONFLICT`, `ASSET_NOT_READY` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_IMAGE_TYPE`, `UNSUPPORTED_MEDIA_TYPE` for encoding |
| 422 | `INVALID_IMAGE`, `INVALID_ASSET_REFERENCE` |
| 429 | `ASSET_UPLOAD_RATE_LIMIT`, `ASSET_SIGN_RATE_LIMIT`, `ASSET_BANDWIDTH_BUDGET` |
| 502 | `ASSET_PROVIDER_MISMATCH` |
| 503 | `IMAGE_STORAGE_UNAVAILABLE`, `ASSET_UPLOAD_FAILED`, `ASSET_SIGNING_FAILED` |
| 507 | `ASSET_STORAGE_LIMIT` |

## Verification and remaining work

The actual restricted ImageKit key was verified with five tiny disposable
files under `scribble/dev`: private upload, exact-path listing, signed image
read, unsigned rejection, genuine expired-URL rejection and deletion all
worked. A separate HTTP/Prisma/PostgreSQL/ImageKit proof in an isolated schema
uploaded two more real files as owner/editor, rejected viewer upload, read a
viewer-signed URL, rejected its unsigned equivalent, saved/read revision 1
and blocked fresh URL issuance after revocation. All seven test files were
deleted; the pre-existing image was preserved. No subscription change was made.

Focused backend tests and the maintained Postman collection cover current
roles, invalid uploads, board-scoped references, revision/save failures,
retention and quotas. Database fixtures use isolated random PostgreSQL
schemas. Postman uses fake provider storage with the real Express, Prisma and
PostgreSQL paths; its signed URL assertions do not claim a live CDN test.
The live provider check above supplies that separate evidence. The final cloud
Postman copy passed lint with 138 requests and no warnings/errors, then passed
138 requests / 466 assertions against the isolated database fixture. All 208
existing folder/request/example IDs and all 100 unrelated request/script/example
payloads were preserved. The collection adds 37 image workflow requests and
60 saved examples. Other final test counts are recorded in
`docs/implementation-status.md`.

Next: explicitly upload frontend image blobs, translate their local IDs into
board-scoped asset UUIDs, load/refresh signed URLs, and preserve draft,
permission and uncertain-save recovery. Then deploy Express and PostgreSQL
(Neon remains planned), configure the backend secrets and frontend API URL,
and arrange cleanup/usage monitoring. PWA offline loading and real-time
collaboration remain separate pending features.
