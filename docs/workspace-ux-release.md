# Workspace UX release

2026-10-07. The user authorized committing and pushing **all pending updates**,
including previous milestones, with normal Cloudflare Pages deployment. They also
authorized the production SQL/backend release, then chose to deploy the backend
themselves through Render's dashboard because no Render credentials are available
to this session.

## Delivery

- Include all pending M7-M10 source, fixtures, tests, handoffs and evidence.
- Push the earlier local commits `265a244` (tab recovery/page retry) and `4b062f1`
  (M4-M6) as well as the combined M7-M10 commit.
- Use a normal `main` push without `[CF-Pages-Skip]` or CI skip markers.
- Cloudflare Pages project: `the-canvas`, serving the frontend through
  `https://milanputhukkudy.com/scribble/`.
- Render service: `scribble-api-003m`; auto-deploy remains OFF. Deploy the pushed
  commit using **Manual Deploy > Deploy latest commit** in the existing service.
  Verify `/api/workspace` returns unauthenticated rather than route-not-found and
  `/api/auth/me` advertises `guestTransferEnabled:true` for guests afterward.

## Production database completed

The configured direct/pooled Neon connections both target database **`scribble`**
with verified TLS. Its migration ledger was 1-8. Existing migrations 9-11 were
applied successfully with the transactional migration runner, after saving an
encrypted PostgreSQL custom-format backup. The ledger is now 1-11.

Before/after fingerprints of all preexisting columns and rows confirm that all
existing application data is unchanged: users, sessions, boards, documents,
sharing, operation receipts, images, OAuth flows and request-budget records.
The three new receipt/workspace tables are empty. No existing data was reset,
seeded or deleted. The next unused SQL number remains 12.

Private backup, encryption key and database audit files are retained only under
ignored `backups/workspace-ux-release-2026-10-07T07-01-39-025Z/`; none enter Git.

## Validation and remaining work

The combined checkout passes **811 fast tests**, the backend build and diff
checks. M10's frontend build, strict focused typecheck, 38 browser cases, seven
viewport-math cases and four distinct actual browser/API/PostgreSQL journeys also
passed before this release. The 151 opt-in PostgreSQL unit cases are skipped by
the ordinary fast-test command; milestone integration proofs cover their relevant
real-database paths.

M11 remains pending: historical manual-provider fixture consolidation, the full
integrated gate and release handoff. Physical device/IME, screen-reader, sleep/wake,
browser chrome zoom and live provider acceptance remain separate pending checks.
At preparation time the live backend returns 404 for `/api/workspace`; signed-in
workspaces require the user's Render deployment. Guest local editing remains
available. Keep the additive migration data and M8-aware v4 parser on rollback.
