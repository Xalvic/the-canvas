# UI redesign R2: workspace shell and navigation

2026-10-07 (Asia/Calcutta). **Verified locally.** Authority:
[UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md), R2.
The plan's shared visual foundation is R1; this session continues with R2.
Next: R3, editor controls and responsive polish.

## Implemented in the application

The full-width header surface is removed. Separate title/navigation and
collaboration/Share regions overlay the existing full-size canvas. Page titles
truncate at rest, expose their complete value, and retain Enter/blur commit,
Escape cancellation and IME composition. Viewer titles remain read-only.
The save icon has the existing truthful status as its accessible label and
opens Save details; mobile retains that action in the page menu. Pending work
uses a clock rather than a confirmed-save check.

The desktop sidebar is attached to the left edge, 240px wide and full height,
with one quiet separator. Search, New page, neutral current-page highlighting,
owned/shared groups and a scrolling page list use the R1 tokens. Row actions
appear on hover/focus and stay visible on touch. Scrolled row menus are bounded
to the visual viewport. Existing rename, deletion confirmation, loading, empty,
cached error and role behavior are retained.

At widths up to 1100px, Pages opens a bounded native modal drawer. Escape,
close and backdrop dismissal restore focus; Tab/Shift+Tab include footer
controls. Navigation closes the drawer. Its adaptive visibility does not write
the saved desktop sidebar preference.

Account controls move to the sidebar footer, alongside Help and theme controls.
The single Account component stays mounted; only its trigger is portaled between
the footer and corner. Account dialogs, pending sign-in cancellation and the
workspace/session controllers retain their ownership. AppMenu similarly owns
one Help dialog and presents footer utilities while the sidebar is visible.
Collapsed navigation retains account and Help/theme access.

Independent title/Share/notice measurements determine overlay offsets. The
drawing dock centers within the exposed desktop region and zoom follows its
left edge. The canvas never resizes or recenters when the sidebar toggles.
Clipboard and keyboard isolation includes the new controls and notices.

Changed application files: `src/workspace-shell.css`, `styles.css`,
`ui-primitives.css`; `ServerBoards`, `PageSidebar`, `BoardIdentity`, `Account`,
`AppMenu`, `Menu`, `Dialog`, `CollaborationPresence` and the chrome-target guard
in `CanvasViewport`. Existing sharing/refresh behavior continues through its
scheduled R4-R6 milestones. Further drawing-control polish remains R3.

## Validation and evidence

| Gate | Result |
| --- | --- |
| Focused browser gate | **25 passed**: 13 inherited layout/interaction cases, 3 preference cases, 2 guest/menu cases, 2 native-form cases and 5 shell cases. |
| Responsive layout | Guest/owner/viewer; both themes; 320/360/390/768/1024/1440 widths and landscape. Explicit 1100/1101 transitions preserve the desktop preference. |
| Navigation/title | Loaded-list search, owned/shared groups, scrolled menus, rename/cancel, delete confirmation/cancel, viewer restrictions, mobile navigation, Enter/blur/Escape and composing keys. |
| Account and focus | One account trigger, no extra account checks during relocation, account dialog retained across breakpoints; footer Help/theme, drawer wrapping/return, backdrop dismissal and UI keyboard/clipboard isolation. |
| Editor and durability | Sidebar preserves canvas bounds and pan/zoom; drag/resize, pen endpoints, atomic undo/redo, guest retention, save failure/retry/reload and consent gates pass. |
| Visual viewport | Safe-area offsets, simulated keyboard pan/height, short landscape, bounded dialogs and notice/settings separation pass. |
| Build/typecheck | Frontend build and strict fixture-aware TypeScript pass. Existing bundle-size/dependency-annotation notices remain non-blocking. |
| Preservation | **118 protected inherited/learning entries retain their hashes and Git status**; no unexpected files; old-plan deletion preserved; diff check passes. Authorized R2 source/plan changes are excluded from the hash comparison. |
| Visual inspection | Desktop 1440×900/mobile 390×844 in both themes, guest, mobile drawer, simulated keyboard drawer and actionable save notice inspected. |

The R2 runner copies both layout and native-form specs to redirect their captures;
historical M11/R0/R1 evidence remains unchanged. The initial run overwrote six R1
captures; all six were restored with exact original SHA-256 matches, recorded in
[the restoration audit](../ui-redesign-evidence/r2-r1-restoration.json).
Temporary recovery presentation and test files were removed.

Reproduce from the repository root:

```text
node ui-redesign-evidence/r2-validate.mjs
npx tsc -p ui-redesign-evidence/r2-typecheck.json
npm run build
node ui-redesign-evidence/r2-check-preservation.mjs
git -c core.safecrlf=false diff --check
```

Results: [browser report](../ui-redesign-evidence/r2-browser-results.json),
[baseline](../ui-redesign-evidence/r2-inherited-work.json),
[preservation](../ui-redesign-evidence/r2-preservation.json).
Application views:
[desktop light](../ui-redesign-evidence/r2-owner-1440-light.png),
[desktop dark](../ui-redesign-evidence/r2-owner-1440-dark.png),
[mobile light](../ui-redesign-evidence/r2-owner-390-light.png),
[mobile dark](../ui-redesign-evidence/r2-owner-390-dark.png),
[drawer](../ui-redesign-evidence/r2-drawer-dark.png),
[keyboard drawer](../ui-redesign-evidence/r2-keyboard-pages.png),
[save error](../ui-redesign-evidence/r2-pending-mobile.png).

Accounts/HTTP and IndexedDB use disposable browser fixtures. No API, SQL, Prisma,
document format, IndexedDB schema, package, normal database or provider changes.
Learning documents are unchanged. Physical keyboard/IME, screen readers, actual
browser zoom and live-provider acceptance remain separate pending checks;
integrated acceptance remains R7. No commit, push or deployment.

R2 is complete. Resume R3 only in the next implementation session.
