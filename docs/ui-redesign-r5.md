# UI redesign R5: Share and recipient flows

2026-10-07 (Asia/Calcutta). **Verified locally.** Authority:
[UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md), R5 only.
Next: R6, automatic freshness and removal of routine refresh controls.

## Application behavior

An owner clicks **Share** once to create or reuse the page's reusable link and
copy its Vite-base fragment URL. A five-second accessible confirmation reports
**Link copied** and Can view/Can edit. No successful-flow dialog, email field or
invitation creation step remains. Canvas editing and navigation stay available.
Pending device changes remain truthful and are described as appearing after sync.

**App menu -> Link settings** reads settings without enabling sharing. It offers
Can view/Can edit, Copy link (or Enable and copy link), and Stop sharing. The
secondary Existing invited access section retains member roles/removal and
already-created invitation copy/cancel actions. Removal explains that an active
link can still grant access again. Legacy invitation inbox/acceptance is retained.

Clipboard rejection opens a selectable URL and a fresh Copy link again action.
That action retries only the clipboard, without another server mutation. Page,
actor, workspace phase, navigation and editor-session guards fence stale
completions. Repeated clicks coalesce. New feedback is measured below an existing
notice and reserves space above appearance controls, without moving the canvas.

Owner mutation identities are stored **without tokens** in tab storage before
dispatch. Unknown outcomes retain the exact request UUID, expected version and
operation across retry, dialog closure, page switching and reload. A pending
request blocks a different operation until reconciled. New changes use the
settings version the owner reviewed; conflicts/supersession require review and
never silently rebase or reactivate a later-stopped link. Capability version 1
gates the typed R4 API. Unsupported servers never produce a nonfunctional URL.

Recipients see **Sign in with Google to open this page** without protected reads.
The validated 43-character fragment is retained for ten minutes in this tab for
OAuth, then removed from the address bar before redirect. It never enters Google
URLs/state, IndexedDB or durable page records. Storage rejection blocks redirect
with instructions to sign in in another tab and reopen the original link.
Cancellation keeps an explicit retry and the device drawing available.

The existing WorkspaceController redeems a signed-in link and opens its returned
page through AccountBoardSession. A first-time recipient initializes an empty
workspace, without an incidental owned page. The canonical page URL replaces
the secret, temporary intent clears, and the joined page appears in Shared with
me. An explicit shared-link destination takes priority over normal return/page
selection and an incomplete guest transfer; the transfer keeps its consent,
actor and recorded destination. A deliberate subsequent page selection clears
the superseded link intent only after successful navigation.

Guest **Share** explains sign-in/account saving and requires unchecked transfer
consent. It preserves the local original and uses the existing image/transfer
pipeline. Its continuation is bound to that flow ID and resumes Share only on
the exact completed destination. Cancellation uploads nothing. Ordinary sign-in
retains its existing optional transfer behavior.

Transient resolution errors offer Retry; invalid/stopped/deleted links show a
privacy-preserving unavailable state. Existing session-expiry and live access
handling clear private rendering on expiry, enforce downgrade/revocation, and
preserve offline editor drafts. No second account/workspace or cursor lifecycle
was introduced.

## Verification

| Gate | Result |
| --- | --- |
| Fast suite | **865 passed**, including **21 new** mutation/intent/lifecycle checks. The 176 database cases are intentionally skipped in this gate; their R4 result is historical. |
| Actual browser/API/Prisma/PostgreSQL | **15 passed** in a new disposable migrated schema, with controlled Google identity/provider, real cookies, real routes and real SQL. |
| Multi-account behavior | Owner's one-click native clipboard copy/reuse; two recipients; viewer writes denied; editor edits persisted and propagated; owner-only settings; live Stop; offline draft preservation; fresh generation and rejection of old links. |
| Recovery | Lost committed Copy response/reload uses the same UUID; later Stop supersedes it; another tab's settings require review. Clipboard fallback issues no second mutation. Navigation suppresses stale clipboard completion. |
| Recipient/guest | No signed-out protected requests; cancelled OAuth retries; no incidental recipient page; retained guest source; explicit Share transfer; incoming link preserves an incomplete transfer and resumes its original destination. Actual session revocation restores the guest drawing. |
| Failure/layout | Unsupported capability; transient versus unavailable resolution; blocked tab storage; native focus return; light/dark 1440/390 settings; separate recovery/share/appearance regions. Recovery-notice layout uses a controlled UI error, not a claimed device I/O failure. |
| Editor/shell regressions | **26 passed**: inherited layout, theme/contrast, IME simulation, dialog/footer isolation, responsive styles, pan/zoom, drag/resize, pen, atomic history, local save/retry and sidebar behavior. |
| Types/build | Frontend build and strict focused browser/client/fixture TypeScript passed. Existing Zod annotation and bundle-size notices remain non-blocking. |
| Preservation | **238 protected entries unchanged**, including learning documents, R0-R4 evidence, backend/contracts and earlier implementation. No unexpected files; diff checks pass. |
| Normal local database | **15 tables / 32 rows unchanged**, including data, columns, constraints and indexes. Ledger remains 11; **zero disposable schemas** after teardown. |

The regression runner makes temporary copies of inherited specs and redirects
their screenshots to R5. It excludes the obsolete test that expects Share to
open an email dialog; the actual R5 settings/clipboard tests cover the replacement
flow. Original fixtures and evidence remain unchanged.

Reproduce from the repository root:

```text
node --env-file=.env.docker ui-redesign-evidence/r5-database-audit.mjs before
node ui-redesign-evidence/r5-fast-checks.mjs
npx playwright test -c ui-redesign-evidence/r5-integration.config.ts
node ui-redesign-evidence/r5-regressions.mjs
npx tsc -p ui-redesign-evidence/r5-typecheck.json
npm run build
node --env-file=.env.docker ui-redesign-evidence/r5-database-audit.mjs after
node ui-redesign-evidence/r5-check-preservation.mjs
git -c core.safecrlf=false diff --check
```

Reports: [fast](../ui-redesign-evidence/r5-fast-results.json),
[actual journeys](../ui-redesign-evidence/r5-browser-results.json),
[regressions](../ui-redesign-evidence/r5-regression-browser-results.json),
[database preservation](../ui-redesign-evidence/r5-database-isolation.json),
[inherited-work preservation](../ui-redesign-evidence/r5-preservation.json).

Visually inspected actual application output:
[desktop light](../ui-redesign-evidence/r5-settings-1440-light.png),
[desktop dark](../ui-redesign-evidence/r5-settings-1440-dark.png),
[mobile light](../ui-redesign-evidence/r5-settings-390-light.png),
[mobile dark](../ui-redesign-evidence/r5-settings-390-dark.png), and
[separated errors/appearance](../ui-redesign-evidence/r5-pending-share-error.png).
No token-bearing field is captured. Native clipboard tests grant browser clipboard
permissions; rejection is separately injected and recovered. These results do
not replace physical keyboard/IME, screen-reader or live Google/provider acceptance.

## Files and release limits

Application files: `src/persistence/shareLinkActions.ts`, `shareLinkIntent.ts`,
`workspaceController.ts`; `src/components/ServerBoards/ShareControls.tsx`,
`ServerBoards.tsx`, `Sharing.tsx`; `src/components/Account/Account.tsx`,
`src/components/AppMenu.tsx`; `src/share-controls.css`, `src/styles.css`.
Tests/evidence add the matching fast tests, `e2e-integration/share-links.spec.ts`
and R5 runners/reports. The isolated API fixture opts into R4 links only with
`SCRIBBLE_E2E_SHARE_LINKS=1`, using an ephemeral fixture-only key.

No API, SQL, Prisma, document/IndexedDB format, dependency, provider, production,
normal local configuration, commit, push or deployment change. The normal local
backend still needs **migration 12 and a stable backend SHARE_LINK_KEY** to
advertise link capability. R5 verification activates these only inside its
disposable fixture. Keep the R4 rollout order: migration -> configured compatible
backend -> frontend; retain additive data on rollback. Existing refresh controls
remain for R6. Integrated/release acceptance remains R7.

Stop after R5. Resume R6 from section 7 and its checklist in the active plan.
