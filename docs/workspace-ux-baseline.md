# Workspace UX baseline - M0

Verified locally on 2026-10-06 against Scribble HEAD
`52f0011252bc0aa55d6fe20744250fe5db7a3116`. This milestone establishes evidence
and reusable fixtures only. No application, API, database contract, dependency,
production setting, or deployment changed.

## Confirmed starting assumptions

The existing tldraw research in section 2 of
`WORKSPACE_UX_IMPLEMENTATION_PLAN.md` is reused without another research pass.
No material change to its recorded comparison was established. Scribble still
shows guest Boards / Save to account controls, routes Sign in through the account
dialog, and requires explicit image uploads. Account document autosaving,
collaboration and recovery already exist. `POST /api/boards` still delegates to
metadata-only creation with a new UUID per call; image uploads still allocate a
new random asset before provider upload. Neither path has a creation/upload
request receipt. These conclusions come from the listed source entry points,
not new production requests.

The sole-writer reproduction uses one active `BoardTabCoordinator`, an isolated
`fake-indexeddb` database, no Web Locks or running heartbeat, and an injected
clock advanced by 20,001 ms. `renew()` returns false, ownership emits `lost: true`,
and `savePresentation()` reports **Editing in another tab** despite no competing
acquisition. The canonical test record is unchanged. This confirms the code path;
it does not measure real browser throttling or device sleep.

Evidence: [reproduction output](workspace-ux-evidence/m0-sole-writer-expiry.json).
The opt-in characterization in `e2e/workspace-baseline.spec.ts` deliberately
asserts the current defect. M1 must convert those expectations to recovery
regression checks; it must not retain the false warning merely to pass this test.
The existing unit test named `cannot silently renew an expired lease before
loading the current board again` also needs review when changing that behavior.

## UI evidence

Chromium captures use fresh browser storage and anonymized mocked account HTTP;
they do not represent real Google consent or deployed account behavior. Saving
has settled after each viewport resize, and opening the owner fixture sends no
cloud mutation. All four images were visually inspected.

| State | Desktop, 1440 x 900 | Mobile layout, 390 x 844 |
| --- | --- | --- |
| Guest | [Capture](workspace-ux-evidence/m0-guest-1440.png) | [Capture](workspace-ux-evidence/m0-guest-390.png) |
| Owner | [Capture](workspace-ux-evidence/m0-owner-1440.png) | [Capture](workspace-ux-evidence/m0-owner-390.png) |

These are browser viewport checks, not physical phone or soft-keyboard checks.
The previous `docs/ux-evidence/` captures remain unchanged.

## Reusable fixtures

| Need | Existing entry point and scope |
| --- | --- |
| Guest/auth/account UI | `e2e/fixtures/account.ts`: `mockAccount`, `savedBoard`, `openBoard`, `canvasState`, `localBoard`; signed-in switch, HTTP errors, delayed lists/documents, conflict and lost-save response controls. SSE is disabled in these mocks. |
| Shared UI actions | `e2e/fixtures/ui.ts`: dialogs, account menu, browsing, explicit save and recovery actions. Selectors describe the current UI. |
| Actual API/DB/auth | `playwright.integration.config.ts`, `scripts/e2e-api-fixture.ts`, `e2e-integration/fixture.ts`: real Express/Prisma/PostgreSQL and cookie sessions, test-only identity, disposable random schema, controlled in-memory image provider. |
| Roles and access loss | Integration `signIn` / `membership`; `collaboration.spec.ts` live downgrade/revocation; `sharing.spec.ts` actual invitation/acceptance UI. Mock viewer/editor cases are in `e2e/account-boards.spec.ts`. |
| Offline and lost responses | `collaboration.spec.ts`: browser-context `setOffline`, reconnect, and `network(request, 1)` to drop a response after a real operation commit. PostgreSQL receipts prove single application. |
| Local tab ownership | `src/persistence/boardTabCoordinator.test.ts` for atomic leases; `e2e-integration/cross-tab.spec.ts` for real IndexedDB/Web Locks, guest takeover, account draft contention and interrupted recovery. |

Only the missing workspace baseline capture/reproduction was added. A typecheck
also exposed an existing helper mismatch: `savedBoard` accepted local
`CanvasObject[]` although its result is a stored `BoardDocument`. Its parameter
now uses `BoardDocument["content"]["objects"]`; runtime behavior is unchanged.
No future-milestone fixtures were built.

## Focused validation and commands

Run from the repository root in PowerShell:

```powershell
npm test -- src/persistence/boardTabCoordinator.test.ts src/components/SaveStatus.test.ts

$env:SCRIBBLE_WORKSPACE_BASELINE = '1'
try { npm run test:e2e -- e2e/workspace-baseline.spec.ts } finally { Remove-Item Env:SCRIBBLE_WORKSPACE_BASELINE -ErrorAction SilentlyContinue }

npm run test:e2e:integration -- e2e-integration/cross-tab.spec.ts e2e-integration/collaboration.spec.ts --grep 'same-device guest tabs|offline independent edits|a committed operation with a lost response|live downgrade and revocation'
```

Results: **10 unit tests, 2 baseline checks, 4 actual browser/API/DB scenarios
passed**. The UI capture check was rerun successfully after adding a wait for
viewport autosave; the unchanged expiry check and other passed checks were not
repeated. The intentional lost-response scenario logs a socket hang-up.

The standard browser fixture starts Vite on 4173. Integration requires the
already-running Docker PostgreSQL on loopback 5434 and ignored `.env.docker`;
its guard rejects other database hosts/ports. It starts API 4301 and Vite 4174,
runs migrations only in its random schema, and acknowledges teardown only after
dropping that schema. There were **zero `scribble_browser_test_*` schemas before
and after** this run. The existing Docker service was left running. No real
Google or ImageKit requests were used.

Focused typechecking of the new spec and its dependencies used the existing
integration compiler settings and passed with **zero diagnostics**:

```powershell
@'
import ts from 'typescript';
const source = ts.readConfigFile('e2e-integration/tsconfig.json', ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(source.config, ts.sys, 'e2e-integration');
const program = ts.createProgram(['e2e/workspace-baseline.spec.ts'], config.options);
const diagnostics = [source.error, ...config.errors, ...ts.getPreEmitDiagnostics(program)].filter(Boolean);
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n' }));
console.log(`Workspace baseline typecheck: ${diagnostics.length} diagnostics`);
process.exitCode = diagnostics.length ? 1 : 0;
'@ | node --input-type=module
```

## Next-session entry points

Next is **M1 only**. Start with `BoardTabCoordinator.renew`, `acquire`, and `write`
in `src/persistence/boardTabCoordinator.ts`; the ownership-loss subscriber,
initial `setTabReadOnly(true)` and focus renewal in
`src/persistence/useLocalBoardPersistence.ts`; and the `tabReadOnly` branch in
`src/components/SaveStatus.ts`. Reuse the focused unit tests and guest cross-tab
integration case above to preserve real competing-writer protection. No M1 fix
was implemented in M0. Full integrated regression remains M11 work.
