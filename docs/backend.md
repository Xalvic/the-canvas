# First HTTP slice: local board metadata

## Outcome and scope

You can create, list, and read board metadata using HTTP. This is Phase 1 in
progress. Rename/delete and canvas document integration remain future slices.
There is no authentication or ownership yet. Both the API and Vite default to
loopback; keep this learning prototype on your own machine.

An HTTP request carries a method, URL, headers, and sometimes a body. A response
carries a status, headers, and a body. JSON is the format used here.
Middleware is a function that runs along that request path; it can parse input,
continue to the next function, or produce a response/error.

## Run

Use Node 24 (verified in this workspace) and `npm install`.
Run these in two terminals:

```text
npm run dev:server
npm run dev
```

Open the Vite URL ending in `/scribble/`. The API runs at
`http://127.0.0.1:3001`. `API_PORT` is optional and validated as an integer from
1 to 65535 before the API listens. For example, in PowerShell use
`$env:API_PORT = '3456'` in **both** terminals before starting the commands;
Vite reads the same variable to select its proxy target. There is no `.env`
loader in this slice. A port change requires restarting Vite too.

To run compiled backend code: `npm run build:server`, then `npm run start:server`.
Frontend and backend builds remain separate. The frontend production build has
no development proxy and no configured API deployment.

## Contract

| Request | Success | Notes |
| --- | --- | --- |
| `GET /health` | `200 { "status": "ok" }` | Process liveness only; no database exists |
| `GET /api/boards` | `200 { "boards": [...] }` | All records in this process; insertion order, no pagination |
| `POST /api/boards` | `201 { "board": {...} }` | JSON `{ "title": "Product ideas" }`; `Location` points to the record |
| `GET /api/boards/:id` | `200 { "board": {...} }` | UUID required; unknown valid UUID returns 404 |

Titles are trimmed and must contain 1–120 characters after trimming. Unknown
fields are rejected, including client-supplied IDs, timestamps, and owner IDs.
Records contain `id`, `title`, `createdAt`, and `updatedAt`. Timestamps are epoch
milliseconds, matching the existing local metadata convention. Requests are
limited to 16 KB; this limit is for metadata, not canvas documents or images.
Responses use `Cache-Control: no-store`.

## Follow an example through the code

```text
Browser fetch('/api/boards', { method: 'POST', ... })
  → Vite development proxy forwards to 127.0.0.1:3001
  → express.json parses the body
  → POST route requires application/json
  → Zod validates and turns '  Product ideas  ' into 'Product ideas'
  → store generates UUID/timestamps and adds the record to its Map
  → response: 201 + Location header + JSON board
```

[`server/index.ts`](../server/index.ts) validates configuration and starts the
listener. [`createApp`](../server/app.ts) wires middleware/routes without opening
a port, so integration tests can use isolated application instances.
[`boards.ts`](../server/boards.ts) owns schemas and the temporary store.
[`errorHandler`](../server/errors.ts) converts failures to a shared JSON shape.

TypeScript describes values to the compiler; it cannot check a browser's HTTP
payload at runtime. Zod performs that runtime check. JSON parsing only proves
valid JSON syntax: `{ "title": 42 }` is valid JSON but fails the title schema.
Validation checks data; authentication would identify a user; authorization
would check that user's permission. The latter two are not present yet.

If validation throws, Express skips normal handling and reaches the error
middleware. Its four-argument signature and placement after the routes matter.
Unexpected errors are logged on the server and return a generic message.

## Verify in DevTools

Open Network and Console on the running canvas, then execute:

```js
const response = await fetch('/api/boards', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '  Product ideas  ' }),
});
const result = await response.json();
console.log(response.status, response.headers.get('Location'), result);
console.log(await (await fetch('/api/boards')).json());
console.log(await (await fetch(`/api/boards/${result.board.id}`)).json());
```

Inspect the request method, payload, Content-Type, response status, response JSON,
and Location header. The browser talks to Vite on its own origin; Vite forwards
the request to the API. This avoids a cross-origin browser request during
development without adding a permissive CORS policy.

Repeat the POST with `{ title: '   ' }`: expect `400` and
`error.code === 'VALIDATION_ERROR'`, with no additional record in the list.
Use a malformed ID to see `400`, or an unknown valid UUID to see `404`.
Stop and restart the backend: the list becomes empty. The local canvas document
is independent and should still reopen from IndexedDB.

| Failure | Status and code |
| --- | --- |
| Invalid body fields or ID | 400 `VALIDATION_ERROR` |
| Malformed JSON | 400 `INVALID_JSON` |
| Missing board/route | 404 `BOARD_NOT_FOUND` / `ROUTE_NOT_FOUND` |
| More than 16 KB | 413 `PAYLOAD_TOO_LARGE` |
| Non-JSON create request/unsupported encoding | 415 `UNSUPPORTED_MEDIA_TYPE` |
| Unexpected server failure | 500 `INTERNAL_ERROR` |

Fetch resolves even for an HTTP error status, so inspect `response.ok`/status.
A stopped server is a transport failure, not an API validation response; a Vite
proxy failure may return a different body. A future frontend API client must
handle both. POST is not idempotent: repeating it creates another board. There
is no retry or duplicate-request protection yet.

## Choice and limits

Express exposes routes and middleware directly; a raw Node HTTP server is a
reasonable alternative with more manual request/body handling. A `Map` lets us
inspect HTTP before introducing SQL, but loses data on restart and cannot
coordinate multiple processes. It needs replacing with durable persistence.
There is no board-list UI, remote document save, pagination, sharing, deployment,
or claim of collaboration. Do not publish this unauthenticated prototype.

Tests in [`app.test.ts`](../server/app.test.ts) exercise real HTTP parsing,
validation, success/error responses, isolation, and unexpected failures via
Supertest. [`config.test.ts`](../server/config.test.ts) checks startup settings.
They do not prove PostgreSQL durability, authentication, or production behavior.

Primary references consulted: [Express error handling](https://expressjs.com/en/guide/error-handling/),
[Zod schemas](https://zod.dev/api), and [Vite proxy options](https://vite.dev/config/server-options#server-proxy).
