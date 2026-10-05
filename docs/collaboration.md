# Collaborative account editing

Status: implemented and verified locally, not deployed. Two separate browser
contexts use the actual Express API, Prisma and Docker PostgreSQL; controlled
Google-session/image fixtures keep tests repeatable without external consent.

Account boards publish authorized revision hints and presence over SSE. The
browser fetches a fresh document after a hint and merges it once active pointer
work/saving has settled. Presence includes world-space cursors and selections;
rendering follows canvas pan and zoom. Presence expires after 30 seconds and is
not durable drawing data. Reconnect uses bounded delays and refreshes the server
revision. Private session/access checks run repeatedly while streams remain open.
Logout, account changes, role downgrade and removal close or restrict access while
retaining local recovery drafts. Login never uploads guest content.

## Concurrent edits and recovery

The first document save retains revision-checked snapshot behavior. Later saves
send one atomic action containing changed objects with their before/after values.
The server locks the board and compares the touched objects before committing.
For example, Alice moving note A and Bob editing note B can both save from the
same starting revision. If both change note A, the second action conflicts; the
whole action is rejected and that browser preserves its draft. Connectors and
same-board completed image references are validated against the merged document.

Each action has a UUID and durable receipt. A lost response retries the identical
action UUID after reload; it cannot write the same action twice. Receipt replay
returns the current document so newer collaborator changes are retained. Reusing
an action UUID with a different payload is rejected. Receipts currently remain
retained indefinitely; no pruning weakens retry guarantees.

Client merging preserves independent edits and newer local changes made during
a save. A same-object conflict requires explicit reload with a recoverable
backup, or save as a new account board. Text inside one object is treated as one
object change; simultaneous text editing is not a character-level CRDT. Offline
edits in an already loaded account board stay in its device draft. Failed writes
need an explicit retry; signing in transfers nothing. An offline app reload is
not supported because PWA app loading was cancelled.

Undo/redo applies only the local action's touched objects. It retains independent
remote changes. If a collaborator changed a touched object, or the inverse would
leave a dangling connector, the whole history replay is refused with a visible
message. Remote snapshots do not create new local history entries. Explicit image
uploads persist mappings outside history; copied images receive destination-board
assets rather than reusing another board's references. Completed assets remain
retained for saved documents, drafts and undo.

## Local tabs and hosting

Cross-device/browser-context editing uses collaboration. Tabs sharing one
IndexedDB database use separate local write ownership to protect their canonical
draft; see [local reliability](local-reliability.md). Do not replace local
draft protection with competing autosave writers.

SSE checks permissions/database revisions about once per second and sends
15-second heartbeats. Connections, presence payloads and rates are bounded.
Durable operation budgets supplement process-level protection. Presence currently
lives in one Express process: run one replica until a shared presence store and
connection routing are implemented. PostgreSQL remains the authority for edits,
permissions, receipts and revisions across process restarts.

SQL migration 7 adds operation receipts; migration 8 adds durable production
request budgets. Both are applied to local Docker PostgreSQL on 5434 with
existing rows/definitions preserved. Portable PostgreSQL on 5433 is unchanged.
Production routing and actual two-Google-account deployed verification remain
pending. Run `npm run test:e2e:integration` for actual browser/API/DB scenarios;
see `e2e-integration/README.md` for isolated fixtures and teardown.
