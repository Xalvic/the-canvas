# Workspace UX M9: guest chrome and workspace pages

Verified locally 2026-10-07. Authority: `../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`.
Stop after M9. Next: **M10 only**, toolbar placement, responsive layout and
accessibility completion. M7-M9 remain uncommitted.

## Implemented behavior

Guests keep one local drawing, its title, images and viewport. The header has the
app menu and one Google entry. Successful local saves are quiet; actual failures
offer one notice and recovery details. Pages, New page, Share and routine account
save controls are absent. Empty-drawing Google entry goes directly to OAuth;
existing content still uses M7's initially unchecked transfer consent.

Signed-in users get a collapsible Pages sidebar, owned pages followed by a Shared
with me group when applicable, loaded-list search, direct page selection and
`+ New page`. Desktop visibility is remembered per account in optional localStorage;
mobile starts closed and closes after opening/creating a page. The sidebar overlays
the existing canvas: it does not resize the viewport or modify world coordinates.
Current-page titles come from the editor, keeping unsaved title edits visible.

Page overflow menus offer inline rename for owners/editors and confirmed deletion
for owners. Enter commits rename, Escape cancels; header titles now follow the same
commit/cancel boundary instead of saving every keystroke. Current editor permissions
hide stale row actions immediately after an access downgrade. Deleting the final
page leaves M6's intentional empty workspace; guests are restored through sign-out.

The avatar menu provides account/retained-drawing details and sign-out. Invitations
use a contextual inbox entry and a separate dialog, retaining explicit acceptance
and M6 navigation when opening an accepted page. Current-page Share retains the
existing owner-only email invitation, role management and manual link fallback.
Menu/dialog shortcuts stay isolated and focus returns to their triggers.

Theme, help, save details and drawing-data export live in the app menu. Export is
a `.scribble.json` file containing title, objects, viewport and embedded available
image bytes; it is not a raster screenshot or a new import UI. Cloud image reads
are account-fenced, account journal/session metadata is omitted, missing images
stop export and a page/session change cancels delivery. The export performs no
cloud mutation. Toolbar theme duplicates are removed; toolbar arrangement is M10.

## Creation and recovery contracts

`WorkspaceController.newPage` commits/journals current work before M3 creation.
Before POST it confirms a tab/account-scoped sessionStorage intent with the exact
UUID, `Untitled` title and `initializeDocument: true`. A lost response reuses this
intent, including after reload. Once returned, the destination ID is stored before
opening it; failed opening retries that destination without another creation.
Account/generation fences discard late responses. Concurrent clicks and native
composition cannot dispatch another creation. Storage failure prevents dispatch.
M3 receipt retention/terminal errors remain authoritative; no silent legacy fallback.
Creation, destination metadata and document reads use the expected account header.

The old board browser/device chooser and normal Save to account flow are removed.
`SaveFlow` remains reachable only for exceptional recovery copies and one legacy
image-consent review. Recovery copies retain their existing legacy creation contract:
inspect My pages after an unknown copy response before making another copy.
M8 document/title/image saving, journals, retries, receipts and transfer consent
remain in place. Saved backups stay available in Save details without routine
warning banners. Device failures take priority over account-service notices.

No SQL, Prisma, package, IndexedDB schema or existing key changes. The new optional
sessionStorage intent has no effect on guest storage or another account. Release
still requires SQL 9-11, the compatible M7/M8 backend, then frontend; preserve the
M8-aware v4 parser and all recovery records on rollback. Next SQL remains 12.

## Verification and handoff

75 targeted unit tests pass, including four new creation cases for lost response/
reload, required intent storage, acknowledged destination recovery and concurrent
clicks/composition. The frontend build passes. Integration and focused browser/test
TypeScript configurations pass. Diff validation passes.

**49 distinct real browser/API/Prisma/PostgreSQL cases pass** across the final
48-case successful run and one focused rerun after replacing a stale viewer-copy
assertion. They include eight new UI journeys plus the M6/M7/M8 navigation,
transfer and autosave regressions. Controlled Google/image providers are used;
real provider/physical device acceptance is still pending.
The final five affected journeys also pass after the notice cleanup and creation
read fences.

**28 distinct standard browser cases pass**: seven app-menu/guest/sidebar/sharing
cases and 21 retargeted account cases, including recovery, retained guest work,
lost acknowledgements, access downgrades, refresh races and offline title saving.
The final account run passed 20; its remaining rename test now waits for the actual
autosave acknowledgement before releasing the older list read, and passed with
the two permission cases in a focused rerun. No tests were removed or skipped.

Earlier runs exposed the menu being covered by the sidebar, fixed by lifting the
header's stacking level. Other failures were stale button/menu/title/status selectors,
guest reloads before the device write, and assertions made before creation/rename
acknowledgement. They were corrected to use actual UI and durability boundaries.
The normal database's 12 tables/14 rows and definitions are unchanged and zero
disposable schemas remain: `../workspace-ux-evidence/m9-database-isolation.json`.
Inspected screenshots: `m9-owner-desktop.png`, `m9-owner-mobile.png` and
`m9-offline-pending.png` in `../workspace-ux-evidence/`.

```text
npm test -- src/persistence/workspaceController.test.ts src/persistence/accountBoardSession.test.ts src/components/SaveStatus.test.ts
npm run build
npx tsc -p e2e-integration/tsconfig.json
npx tsc -p workspace-ux-evidence/m9-typecheck.json
npm run test:e2e -- e2e/ux-simplification.spec.ts --output=test-results/m9-standard-final
npm run test:e2e -- e2e/account-boards.spec.ts --output=test-results/m9-account-final
npm run test:e2e -- e2e/account-boards.spec.ts -g "older list|viewers can|editors save" --output=test-results/m9-account-fix-final
npm run test:e2e:integration -- e2e-integration/workspace-ui.spec.ts e2e-integration/workspace-navigation.spec.ts e2e-integration/guest-transfer.spec.ts e2e-integration/workspace-saving.spec.ts --output=test-results/m9-regression-final
npm run test:e2e:integration -- e2e-integration/workspace-navigation.spec.ts -g "current viewer roles" --output=test-results/m9-viewer-final
npm run test:e2e:integration -- e2e-integration/workspace-ui.spec.ts e2e-integration/workspace-navigation.spec.ts -g "owners create|lost New page|list failure|guest UI|current viewer roles" --output=test-results/m9-notice-final
node --env-file=.env.docker workspace-ux-evidence/m9-database-audit.mjs before
node --env-file=.env.docker workspace-ux-evidence/m9-database-audit.mjs after
git diff --check
```

M10 should start with the layout/accessibility milestone block, Toolbar,
ZoomControls, viewport placement and the layout fixtures. The screenshot's current
toolbar/header arrangement is intermediate. Retarget the old layout/theme selectors
there; the historical provider-specific manual-save fixtures can be consolidated
with current automatic-save journeys at the integrated M11 gate. Do not treat
historical baseline/manual-save expectations as current product behavior. Full
integrated, screen-reader, IME/sleep and physical device acceptance remains M11.
No normal/production migration, commit, push, deployment or provider mutation.
