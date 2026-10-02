# Scribble learning progress

## Session: 2026-10-01

The supplied learning prompt is the guide for this chat. The repository's
whiteboard specification uses an older editor milestone sequence; its embedded
"start with Milestone 01" text is planning material, not a request to rebuild the
existing viewport. Status is based on inspected code and executed checks.

Implementation and understanding are tracked separately. The user has not yet
answered a checkpoint in this chat; no concept is marked understood because
code or tests work.

| Roadmap milestone | Implementation | Understanding | Evidence / next gap |
| --- | --- | --- | --- |
| Existing local editor foundation | Completed for present local scope | Needs Review | Custom DOM/SVG editor; document/history/selection/viewport stores; IndexedDB boards/assets; baseline 70 tests pass |
| 1. Backend and HTTP | Building | Learning | Express/TypeScript health + metadata create/list/read; Zod/config/error handling; rename/delete/document contract remain |
| 2. PostgreSQL and board persistence | Not Started | Not Started | Local IndexedDB already works; no PostgreSQL/Prisma/schema/migrations; compare storage models before choosing |
| 3. Authentication | Not Started | Not Started | No accounts, sessions, or credential handling |
| 4. Authorization and sharing | Not Started | Not Started | No authenticated owner or server permission rules |
| 5. TanStack Query/server state | Not Started | Not Started | No query dependency or API-backed board UI; preserve local document ownership when adding it |
| 6. Cloud asset storage | Not Started; local prerequisite implemented | Needs Review for local assets | Blob storage/paste/drop exists; no R2 or other cloud upload/access configuration found |
| 7. Real-time collaboration | Not Started | Not Started | No WebSocket/shared document/presence/CRDT implementation |
| 8. Docker/repeatable API + DB setup | Not Started | Not Started | No Docker/Compose setup; API start/config commands now documented |
| 9. Testing | Building on existing coverage | Needs Review | Existing Vitest/Playwright plus new HTTP tests; auth/database/collaboration flows cannot be covered yet |
| 10. Production engineering | Not Started beyond build scripts | Not Started | Frontend/backend builds work; no tracked deployment/CI/database operations configuration found |

## First slice

Implemented: loopback API, validated `API_PORT`, health, metadata create/list/read,
server-generated IDs/timestamps, strict trimmed titles, JSON error handling,
16 KB request cap, development proxy, separate backend build, and isolated HTTP
tests. The editor still owns its existing local document.

Executed checks:

- Before changes: 70 existing unit tests and frontend build passed.
- After changes: 90 tests passed (70 existing + 20 backend/config checks).
- Backend typecheck, frontend build, and backend build passed.
- Browser through Vite: health 200, create 201 with trimmed title, read/list
  consistent, blank title 400, no page JavaScript errors.
- Eight targeted Playwright usability/compatibility checks passed, covering
  reload persistence, appearance history, drawing, and storage-error handling.
- `npm audit` reported two moderate entries for the existing Vitest 3.2.7 and
  `@vitest/mocker` 3.2.7. Those versions were already in the original lockfile;
  addressing them requires a separate test-tool upgrade review.

Limits: records are in memory; no canvas/network integration; browser restart
durability belongs to existing IndexedDB; cross-tab conflict behavior, real
deployment, physical stylus feel, and authenticated behavior remain unverified.

## Checkpoint awaiting the user's explanation

1. Follow `{ title: '   ' }` through `server/app.ts`. Which step rejects it, and
   why does no record enter the Map?
2. Predict the responses for `not-a-uuid` and an unknown valid UUID. Why do the
   status codes differ?
3. After restarting the backend, why can the API board list be empty while your
   local canvas still contains its notes?

Practice: inspect one create request in DevTools and point out which values came
from the browser and which were produced by the server. Answers intentionally
remain for the user to supply at the learning checkpoint.

Next project step: after this checkpoint, complete metadata rename/delete and
their validation/error semantics in another small Phase 1 slice. Decide the
remote document contract before connecting the editor; PostgreSQL follows the
basic lifecycle. Do not start authentication or collaboration yet.

## Handoff for the separate study chat

```text
Milestone: Phase 1, first HTTP/backend slice.
Implemented and verified: Existing canvas architecture traced; loopback Express API with health and metadata create/list/read; strict Zod validation; shared JSON errors; 90 tests, eight targeted browser tests, and both builds passed; browser proxy success/failure verified.
Concepts practiced: Screen/world conversion, editor versus UI state, request/response, middleware, runtime validation, status codes, in-memory lifetime.
What I can explain: Not assessed yet; awaiting my own checkpoint answers.
What needs review: Trace note creation/autosave and one API request; explain 400 versus 404 and restart behavior.
Decisions and tradeoffs: Preserve custom local editor; use Express and a temporary Map to learn HTTP; defer document storage and ownership design.
Remaining risks or unverified behavior: No remote canvas save, durable backend, auth, collaboration, or deployment; cross-tab local saves and physical stylus feel unverified; existing Vitest audit advisory needs a separate upgrade review.
Next project step: Finish metadata rename/delete after the current learning checkpoint.
Suggested study topic: HTTP methods/status/headers and why TypeScript types do not validate network input.
```
