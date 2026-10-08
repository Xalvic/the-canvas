# UI redesign R3: editor controls and responsive polish

2026-10-07 (Asia/Calcutta). **Verified locally.** Authority:
[UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md), R3.
The plan's shared visual tokens/primitives are R1, already verified. This delivery
implements R3 in the application and stops before R4.

## Implemented in the application

`src/editor-controls.css` owns drawing controls and uses the existing R1 tokens.
Competing editor declarations are removed from `styles.css`; neighboring canvas,
object and interaction styles retain their behavior. The dock is compact, has
clear pressed/hover/focus states, and centers within the exposed desktop canvas.
Undo/redo sit immediately above it in a quieter row. Zoom retains its existing
callbacks and shortcuts; its percentage opens the existing accessible Menu with
Reset view, Zoom out and Zoom in. Escape/menu selection restore focus.

Desktop contextual styles use a condensed 204px panel. Color swatches paint a
small circle within their hit area, with a check and outline for selection.
Through 1100px, or at heights up to 500px, settings start collapsed and open on
demand. Compact choices and swatches have at least 44px targets. Content scrolls
independently beneath the heading, keeping close/collapse reachable. Tool
switching and returning to the canvas collapse presentation while retaining the
actual settings. This runs only at pointer-down; pointer-move paths are unchanged.

Mobile collapsed settings sit at the upper edge, leaving the drawing region
clear. Expanded appearance replaces the selection action row. History and zoom
share the row above the mobile tool dock. Existing safe-area and visual-viewport
measurements bound the dock and panels above a virtual keyboard. Overlay changes
do not resize or recenter the canvas or write visibility preferences.

The empty canvas has a quiet centered hint while Select is active, with correct
viewer wording. Selection help is short and contextual. Shared native dialogs
have consistent facts/actions, a reachable heading, explicit consent presentation
and readable error surfaces. Google sign-in retains its primary appearance and
contrast when hovered; a competing generic hover rule is corrected. Existing
consent, recovery, deletion and account behavior stays intact. Sharing still uses
email invitations and lists still expose refresh until their R4-R6 milestones.

Application changes: `styles.css`, `editor-controls.css`, `Toolbar`, `ToolOptions`,
`ZoomControls`, and presentation-only portions of `CanvasViewport`.

## Validation and evidence

| Gate | Result |
| --- | --- |
| Focused browser gate | **42 passed**: layout 13, responsive/touch 5, guest/error semantics 2, native primitives 2, workspace shell 5, appearance 4, pen 2, new editor cases 9. |
| Editor behavior | Draw/select, pan/pinch/zoom, drag/resize, text editing, atomic undo/redo, pen endpoints, tool switching and guest persistence after reload pass. |
| Appearance | Preferences remain separate from object styling. Opacity previews cause no durable writes; release commits one history entry. Selection actions and appearance preserve focus and history. |
| Responsive layout | Guest/owner/viewer; 320/360/390/768/1024/1440 widths, short 320px height, landscape, safe areas, equivalent 200% layout and simulated keyboard pan/height pass. |
| Keyboard/semantics | Arrow traversal, disabled viewer tools, More/zoom menu navigation, Escape/focus return, clipboard isolation, native modal containment and IME fixtures pass. |
| Contrast | Actual rendered active/inactive tool text and Google primary/hover actions pass in both themes, alongside inherited form/error/focus checks. |
| Focused unit gate | **21 passed**: viewport math 7, stroke rendering 11, appearance preview 3. |
| Build/typecheck | Frontend build and strict fixture-aware TypeScript pass. Existing bundle-size/dependency annotation notices remain non-blocking. |
| Visual inspection | Desktop/mobile in both themes, pen/text controls, account consent, recovery, Help and simulated keyboard output inspected. Final captures disable motion for stable inspection. |
| Preservation | **158 protected inherited/learning entries retain hashes and Git status**. No unexpected files; historical captures and the intentional old-plan deletion are preserved. Diff check passes. |

The runner copies layout, primitives and shell specs to redirect their screenshot
paths into R3 evidence. An initial run missed the shell capture and overwrote one
R2 drawer image. Its exact original PNG bytes were recovered from the R2 image-view
output, with a matching saved SHA-256; see the restoration audit. Temporary recovery
fixtures/captures were removed. All three inherited capture paths are now redirected.

Reproduce from the repository root:

```text
node ui-redesign-evidence/r3-validate.mjs
npm test -- src/store/appearancePreviewStore.test.ts src/canvas/viewport/viewportMath.test.ts src/canvas/strokes/strokeRenderer.test.ts
npx tsc -p ui-redesign-evidence/r3-typecheck.json
npm run build
node ui-redesign-evidence/r3-check-preservation.mjs
git -c core.safecrlf=false diff --check
```

Results: [browser report](../ui-redesign-evidence/r3-browser-results.json),
[inherited baseline](../ui-redesign-evidence/r3-inherited-work.json),
[preservation audit](../ui-redesign-evidence/r3-preservation.json),
[R2 capture restoration](../ui-redesign-evidence/r3-r2-restoration.json).
Application views:
[desktop light](../ui-redesign-evidence/r3-owner-1440-light.png),
[desktop dark](../ui-redesign-evidence/r3-owner-1440-dark.png),
[mobile light](../ui-redesign-evidence/r3-owner-390-light.png),
[mobile dark](../ui-redesign-evidence/r3-owner-390-dark.png),
[text styles](../ui-redesign-evidence/r3-text-desktop-dark.png),
[account consent](../ui-redesign-evidence/r3-consent-light.png),
[recovery](../ui-redesign-evidence/r3-recovery-dark.png),
[Help](../ui-redesign-evidence/r3-help-dark.png),
[keyboard controls](../ui-redesign-evidence/r3-keyboard-controls.png),
[drawer](../ui-redesign-evidence/r3-drawer-dark.png).

Accounts/HTTP and IndexedDB use disposable browser fixtures. SQL 1-11, document
v1, IndexedDB v4, API contracts, packages, normal databases, provider configuration
and learning documents are unchanged. Physical devices/IME, screen readers, actual
browser zoom and live providers remain separate pending acceptance; integrated
acceptance remains R7. No commit, push or deployment.

R3 is complete. Next: R4, authenticated reusable links.
