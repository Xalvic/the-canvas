# Sharing and roles

Implemented on 2026-10-05. Prisma was committed as `c092b74`; this sharing
milestone is awaiting its own commit authorization.

| Role | Read board/document | Edit document and rename | Delete board | Manage sharing |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | No | No |
| Viewer | Yes | No | No | No |

Boards keep their existing owner. Memberships grant editor/viewer access to
persisted user IDs. Invites are addressed to a normalized verified Google email,
expire after seven days, and require explicit acceptance while signed in to that
email. Owners copy a link to deliver an invitation; no email delivery service is
configured. Recipients can also find invites in the account panel.

## API contract

All routes require a session; mutations require the existing origin/header
protection. Board metadata includes the caller's `role`; document reads/saves
also return that role. Accessible lists include owned and accepted shared boards.
An invite alone grants no document access. Unknown/unshared boards return 404;
insufficient permission on an accessible board returns 403 `BOARD_FORBIDDEN`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /api/boards/:id/sharing | Owner sees members and pending invitations |
| POST | /api/boards/:id/invitations | Owner invites `{email, role: editor or viewer}` |
| DELETE | /api/boards/:id/invitations/:inviteId | Owner cancels invitation |
| PATCH | /api/boards/:id/members/:userId | Owner changes `{role: editor or viewer}` |
| DELETE | /api/boards/:id/members/:userId | Owner removes access |
| GET | /api/invitations | Recipient's unexpired pending invitations |
| POST | /api/invitations/:inviteId/accept | Recipient accepts; returns accessible board metadata |
| DELETE | /api/invitations/:inviteId | Recipient declines |

Validation uses strict schemas. Owners cannot invite themselves, change their
owner role or remove ownership. Reinviting a pending email updates its role and
expiry. Already accepted members are managed through the membership endpoints.
Acceptance, grant/revoke, rename and document saves serialize through the board
row, with permission rechecked after acquiring the lock. Revision checks remain
unchanged; write retries are never automatic.

SQL migrations remain the schema authority. New membership/invitation tables
cascade on board deletion; migration 5 preserves all existing owners/documents.
Prisma maps these tables and the current session identifies the acting user.

Viewer canvases allow navigation and selection/copy, with creation, editing,
dragging, resizing, paste, undo/redo and title changes blocked. Access refreshes
never replace the editor. A downgrade/revocation stops account saves and keeps
the existing local draft; explicit reload/copy handles recovery.

## Using it

1. Sign in and choose **Share** beside a board you own.
2. Enter the person's Google email and choose Viewer or Editor.
3. Choose **Create invitation**, then **Copy invitation link** and send it.
4. The recipient signs in with that email and chooses **Accept invitation**
   in Server boards. Their shared board then appears in the list.
5. Use Members to change a role or remove access. Cancel an invitation before
   acceptance to withdraw it. Ownership cannot be transferred in this milestone.

Sign-in answers “who is this person?” The board role answers “what can this
person do here?” Prisma reads the owner and memberships from PostgreSQL; the
server checks them before each action. Hiding a button helps the user, while
the server check also stops a manually constructed forbidden request.

The browser checks active access on focus and every 30 seconds. The server
enforces changes immediately on subsequent requests, including queued saves.
Access changes never erase an already downloaded local copy. Old editable drafts
are backed up before opening a viewer snapshot; permission is not persisted as
trusted authority in IndexedDB. Guest editing remains available.

Sharing uses the existing revision-conflict system. Two editors can open a board,
but one stale save is rejected until explicitly reloaded or copied. Live presence
and automatic synchronization are a later milestone. Cloud image assets are next.

Verification: 386 fast tests, 57 real PostgreSQL permissions/migration/concurrency
tests, 41 browser scenarios across full/targeted runs, typechecks, both builds and read-only Prisma schema
comparison. API tests use temporary database schemas; browser account tests use
mocked HTTP. Two real Google accounts have not been manually exercised for this
new sharing flow. The normal Docker migration preserves all original rows,
constraints and indexes, with no initial memberships or invitations.

The cloud Scribble API collection includes all eight sharing endpoints and a
32-request role/invitation lifecycle. Its fetched-back copy passes 101 requests /
325 assertions and v3 lint scans 101 requests without issues. Existing request
and example IDs and assertions are preserved. Local test schemas/sessions are
removed after verification; no test identities were added to the normal database.
