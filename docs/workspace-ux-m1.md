# Workspace UX M1: false-warning fix and wake recovery

Verified locally 2026-10-06. M1 is complete; M2 has not started. Status authority:
`../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`. M0 evidence remains in
`workspace-ux-baseline.md` and `workspace-ux-evidence/m0-*`.

## Implemented behavior

`BoardTabCoordinator` now distinguishes acquiring, owned, unverified, contended
and storage-unavailable states. A missed heartbeat alone is not proof of another
writer. If the durable owner/token still matches the held handle, renewal and
board writes extend that lease even after expiry. The token check, extension and
board writes remain in the same IndexedDB transaction. A fallback contender
that commits first changes the token, so the stale writer is still rejected.
An actual held Web Lock is retained through expiry and temporary storage errors;
the callback's lifetime is the ownership proof, not the heartbeat timestamp.

Focus, return-to-visible and pageshow trigger verification. Ordinary sole-writer
wake does not change board session, history, selection, viewport or pending work,
and creates no detached recovery record. Changed ownership still preserves the
existing interrupted-draft path and blocks edits until explicit reconciliation.
A missing record or expired foreign token is unverified, not proof of a currently
active second writer. Initial acquisition presents loading instead of a warning.

Temporary storage failure blocks unguarded editing/saving but keeps the token,
Web Lock, pending document and undo history. Heartbeat/lifecycle verification or
Retry device save can resume the unchanged session and queue its current draft.
Initial IndexedDB-open failure can also retry and hydrate retained content;
synchronous open errors no longer leave a permanently cached rejected promise.
Account autosave is notified when temporary storage ownership resumes. Server
roles still restrict editing independently of local ownership.

No IndexedDB version/key/record format, SQL migration, API or dependency changed.
Existing M0 changes and historical captures were preserved. No commit, push,
deployment, provider change or production mutation was performed.

## Validation

- **65 unit tests**: atomic ownership, saved-data compatibility, presentation,
  role restrictions, account session, local storage and save boundaries.
- **7 browser cases**: guest/account wake with Web Locks; guest/account fallback
  without Web Locks or BroadcastChannel; delayed initial acquisition; temporary
  write failure with pending work/history and retry; failed initial open/retry.
  Wake cases retain an interrupted pen stroke, pan/zoom, undo/redo and reload.
- **1 injected-clock expiry check**: converted M0 defect expectation; sole writer
  remains owned after 20,001 ms. Result: `workspace-ux-evidence/m1-sole-writer-expiry.json`.
- **3 actual browser/API/PostgreSQL cases**: guest contention/takeover, same-account
  draft contention plus unrelated boards/permission reread, and stale-writer
  recovery without overwriting the winning canonical draft.
- Production frontend build and focused browser-spec typecheck passed. Build
  retains existing dependency-annotation and bundle-size warnings. Diff check passed.

The first browser run overlapped a source repair and Vite hot reload. Failed
cases were rerun against unchanged source. Fallback reload explicitly advances
past the old lease's expiry; the outage undo check returns focus to the canvas
after closing details, whose header correctly isolates keyboard shortcuts.
All seven distinct cases passed; unchanged captures were not regenerated.

Integration used the existing Docker PostgreSQL on loopback 5434 and isolated
fixtures on 4174/4301. Zero `scribble_browser_test_*` schemas existed before and
after validation. The existing Docker database was left running. Standard browser
tests used 4173, mocked account HTTP and actual browser IndexedDB/Web Locks.
No real Google or ImageKit requests were made.

## Reusable commands

From the repository root in PowerShell:

```powershell
npm test -- src/persistence/boardTabCoordinator.test.ts src/components/SaveStatus.test.ts src/store/boardStore.test.ts src/persistence/accountBoardSession.test.ts src/persistence/localBoardStorage.test.ts src/persistence/waitForLocalBoardSave.test.ts

npm run test:e2e -- e2e/workspace-wake.spec.ts

$env:SCRIBBLE_WORKSPACE_BASELINE = '1'
try { npm run test:e2e -- e2e/workspace-baseline.spec.ts --grep 'workspace recovery' } finally { Remove-Item Env:SCRIBBLE_WORKSPACE_BASELINE -ErrorAction SilentlyContinue }

npm run test:e2e:integration -- e2e-integration/cross-tab.spec.ts

npm run build
```

Browser-spec typecheck (zero diagnostics):

```powershell
@'
import ts from 'typescript';
const source = ts.readConfigFile('e2e-integration/tsconfig.json', ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(source.config, ts.sys, 'e2e-integration');
const program = ts.createProgram(['e2e/workspace-wake.spec.ts', 'e2e/workspace-baseline.spec.ts'], config.options);
const diagnostics = [source.error, ...config.errors, ...ts.getPreEmitDiagnostics(program)].filter(Boolean);
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n' }));
console.log(`Workspace spec typecheck: ${diagnostics.length} diagnostics`);
process.exitCode = diagnostics.length ? 1 : 0;
'@ | node --input-type=module
```

## Boundaries and next entry

Elapsed time and blur/visibility/pageshow are injected deterministically. This is
not a physical device-sleep/background-throttling measurement. Physical/browser
acceptance and full integrated validation remain M11 work.

Fallback reload/crash still waits for the previous durable lease to expire;
no active Web Lock is stolen. Actual guest contention still uses explicit reopen,
and same-account editors still protect the canonical draft. M2 owns automatic
guest handoff, session journals and simultaneous account editors. Start with M2,
section 4's simultaneous-tab design and section 5's data-migration constraints;
then the coordinator, local persistence, account session and cross-tab tests.
