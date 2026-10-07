# Workspace UX M10: layout and accessibility

Verified locally 2026-10-07. Scope authority:
`../WORKSPACE_UX_IMPLEMENTATION_PLAN.md`, M10. Stop here; M11 is next.

Drawing tools and compact history now sit together at the bottom center on
desktop. Zoom/reset sits at the bottom left. Tablet widths lift zoom above the
main dock to avoid overlap. Mobile has a centered drawing dock above zoom and
history, and retains those controls when the dock is collapsed. Contextual styles
sit on the right on desktop and open as a bounded, scrolling mobile popover.
Mobile object appearance temporarily replaces the selection action row and
returns focus to Style on close, including short landscape layouts.

The compact header wraps safely for long titles, current roles, save state and
collaborators. `ServerBoards.tsx` measures header/notice bounds with
ResizeObserver and writes CSS properties on the shell. Sidebar, notices and
settings follow those bounds without changing the canvas size or world origin.
VisualViewport height/offset bounds native dialogs and the mobile Pages drawer
when a soft keyboard shrinks or pans the visible area. CSS safe areas apply to
header, drawer and bottom controls; browsers without VisualViewport use the
dynamic viewport fallback. Mobile canvas text editing hides chrome as before.

Toolbars support Tab, Left/Right and Home/End, skipping disabled tools. More tools
uses the existing menu with radio items, Up/Down/Home/End, outside dismissal and
Escape/focus restoration. Settings and desktop Pages restore focus when closed.
Keyboard and clipboard events from chrome/dialogs do not mutate the canvas.
Explicit history buttons and the existing settings undo behavior remain usable.
Canvas shortcuts resume after moving focus back to the canvas. Active tool ink
uses a contrasting dark-theme color; text, fields and focus pass contrast checks.

No API, SQL, Prisma, package, document schema or IndexedDB format changes. No
pointer-move, selection ownership or durable interaction boundary changes. The
existing resize behavior retains the world point at viewport center; overlay
changes do not move it. Prior M2-M9 journal, receipt, transfer, asset and saving
contracts are preserved.

## Verification

The focused standard browser gate contains **38 cases**: 13 layout/accessibility,
five responsive/theme/touch, six usability/appearance and 14 pen/input cases.
It checks guest/owner/viewer UI, light/dark, 320/360/390/768/1024/1440 widths,
landscape, actual emulated CSS safe-area values, equivalent 200% layout, menu and
modal focus, clipboard isolation, IME composition, reduced/panned visual
viewports, notices beside expanded settings, and mobile object appearance.
Interaction cases cover non-default pan/zoom, sidebar overlays, drag/resize,
pen endpoints, transient appearance, atomic undo/redo, native touch pinch,
interruption and persisted drawing/styles after reload.

**Seven viewport-math unit tests** pass. **Four distinct actual browser/API/
Prisma/PostgreSQL journeys** pass across the main and final focused runs:
guest persistence/storage failure; owner create/rename/cancel/share/delete;
shared editor/viewer behavior; sign-out with retained guest/account work.
The frontend build, strict focused browser typecheck and diff checks pass.
Controlled local authentication/provider fixtures are used.

The normal database's 12 tables/14 rows and definitions are unchanged, with zero
disposable schemas after teardown:
`../workspace-ux-evidence/m10-database-isolation.json`.

Inspected screenshots in `../workspace-ux-evidence/`: `m10-owner-1440-light.png`,
`m10-owner-390-dark.png`, guest/owner light/dark width variants,
`m10-pending-mobile.png`, `m10-safe-area.png`, `m10-keyboard-pages.png`,
`m10-keyboard-share.png` and `m10-zoom-layout.png`.

Earlier failures exposed a retired tablet left offset and stale test assumptions
about theme controls, title labels, panel height and restored focus. Those were
corrected; no tests were removed or skipped. The notice layout test waits for
the established bounded save retries before expecting the actionable error.

```text
npm test -- src/canvas/viewport/viewportMath.test.ts
npm run build
npx tsc -p workspace-ux-evidence/m10-typecheck.json
node --env-file=.env.docker workspace-ux-evidence/m10-database-audit.mjs before
npm run test:e2e -- e2e/ux-layout.spec.ts e2e/responsive.spec.ts e2e/usability.spec.ts e2e/pen-input.spec.ts --output=test-results/m10-verified
npm run test:e2e:integration -- e2e-integration/workspace-ui.spec.ts -g "guest UI|owners create|shared editors|avatar sign-out" --output=test-results/m10-integration
npm run test:e2e:integration -- e2e-integration/workspace-ui.spec.ts -g "guest UI|owners create" --output=test-results/m10-integration-final
node --env-file=.env.docker workspace-ux-evidence/m10-database-audit.mjs after
git -c core.safecrlf=false diff --check
```

## Next session

Execute **M11 only**. Read its block, the acceptance matrix, section 8's release
constraints and the compact milestone handoffs. Consolidate historical
manual-provider fixtures into current automatic-save journeys, then run the
integrated gate. Physical devices/pressure hardware, real soft keyboards and
IME, screen readers, actual browser chrome zoom, sleep/wake and live provider
acceptance remain distinct human/provider checks. The simulations above do not
claim those checks. Preserve M8-aware v4 rollback parsing, additive data and the
existing mixed-version/recovery boundaries. On 2026-10-07 the user authorized
committing and pushing all pending updates, including the earlier local commits,
with normal Cloudflare Pages deployment and no deployment-skip marker. The combined
checkout passes 811 fast tests and the backend build. The user also authorized the
backend release. Neon database `scribble` now has SQL 1-11; an encrypted backup and
fingerprints confirm existing application data is unchanged. The user chose to
deploy the pushed backend through Render's dashboard. Its live workspace API and
M7 transfer capabilities remain pending that deploy. See `workspace-ux-release.md`.
