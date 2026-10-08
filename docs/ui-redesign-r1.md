# UI redesign R1: shared visual foundation

2026-10-07 (Asia/Calcutta). **Verified locally.** Authority:
[UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md), R1 only.
Design source: [R0 decisions](ui-redesign-r0.md). Next: R2, still Pending.

## Implemented in the application

[ui-tokens.css](../src/ui-tokens.css) now owns the shared light/dark palette,
surface levels, typography, 4px spacing rhythm, control/surface radii, icon sizes,
focus, motion, shadows and error/pending/success colors. Existing canvas paint
and grid tokens were moved without changing their values. Theme selection,
storage keys, saved preferences and the existing sans-serif stack are unchanged.

[ui-primitives.css](../src/ui-primitives.css) supplies presentation for existing
native buttons, links, fields and semantic notices. Secondary actions use
transparent backgrounds and quiet hover fills; primary actions use each theme's
accent and contrasting text; destructive actions use error text and hover fill.
Fields have readable boundaries, placeholders and disabled states. Ordinary
controls use a 36px desktop minimum and 44px mobile/coarse-pointer minimum.
Existing drawing-dock geometry is retained. Focus stays visible, including
inside scrolling menus; reduced motion disables control transitions.

[styles.css](../src/styles.css) imports these foundations and removes the
conflicting button, field, focus and hard-coded primary-action declarations in
the touched presentation areas. Menus/dialogs use the shared spacing and surface
radii. Native Menu triggers and Dialog close buttons share the `ui-button`
primitive; their event handling, roles, keyboard traversal, focus wrapping and
restoration are unchanged. The tool-dock trigger keeps its established sizing.

Notice colors derive from existing failure/consent/recovery state; text and
alert/status semantics remain intact. Completed SaveFlow messages distinguish
confirmed success from pending work. No new save, selection or lifecycle state
was introduced.

Application files changed: the three CSS files above;
`src/components/Menu.tsx`, `Dialog.tsx`, `AppMenu.tsx`,
`ServerBoards/ServerBoards.tsx` and `ServerBoards/SaveFlow.tsx`.

This foundation does not complete the proposal's shell or drawing-control
composition. Header/sidebar/account placement belongs to R2, remaining control
and responsive refinement to R3, new link behavior to R4/R5 and refresh removal
to R6. Existing sharing and refresh behavior remain operational.

## Validation and evidence

| Gate | Result |
| --- | --- |
| Focused application browser gate | **20 passed**: 13 inherited layout/interaction cases, 3 preference/breakpoint cases, 2 guest/menu semantics cases and 2 new native-form/contrast/error cases. |
| Layout | Guest/owner, both themes, 320/360/390/768/1024/1440 widths and 844×390 landscape; viewer navigation, short styles panels and notice separation included. |
| Menus/dialogs | Arrow/Home/End navigation, Escape/focus return, native modal focus containment, email validation, explicit consent and keyboard/clipboard isolation pass. |
| Rendered controls | Primary text in default/hover states, form/help/error text meet 4.5:1; field boundaries/focus meet 3:1 in both themes. Disabled creation stays disabled after an uncertain response until the existing sharing check completes. Reduced-motion button hover starts no animation. |
| Editor/persistence | Pan/zoom coordinates, drag/resize, pen, atomic history, device failure/retry/reload and guest retention pass the inherited browser checks. |
| Frontend build | `npm run build` passed, including application TypeScript. Existing dependency-annotation and bundle-size notices remain non-blocking. |
| Focused test typecheck | `npx tsc -p ui-redesign-evidence/r1-typecheck.json` passed using the existing browser-fixture import mapping. |
| Preservation and diff | **90 protected entries unchanged** by SHA-256/Git status; learning documents unchanged; deleted old plan remains deleted; no unexpected files; `git diff --check` passed. |
| Visual inspection | Desktop 1440×900/mobile 390×844 owner output in both themes; light menu, light/dark native sharing forms and errors, and reduced-viewport mobile dialog inspected. |

The two new tests in [ui-primitives.spec.ts](../e2e/ui-primitives.spec.ts) check
rendered contrast, native validation, focus, reduced motion and actionable error
behavior. They do not compare implementation CSS values. A disposable copy of
the inherited layout spec redirects screenshots to R1, preserving all M11/R0
evidence and original fixtures. The temporary spec/config/results are removed
after the successful gate.

Reproduce from the repository root:

```text
node ui-redesign-evidence/r1-validate.mjs
npx tsc -p ui-redesign-evidence/r1-typecheck.json
npm run build
node ui-redesign-evidence/r1-check-preservation.mjs
git -c core.safecrlf=false diff --check
```

Detailed results: [browser report](../ui-redesign-evidence/r1-browser-results.json),
[inherited baseline](../ui-redesign-evidence/r1-inherited-work.json),
[preservation result](../ui-redesign-evidence/r1-preservation.json).
Representative application screenshots:
[desktop light](../ui-redesign-evidence/r1-owner-1440-light.png),
[desktop dark](../ui-redesign-evidence/r1-owner-1440-dark.png),
[mobile light](../ui-redesign-evidence/r1-owner-390-light.png),
[mobile dark](../ui-redesign-evidence/r1-owner-390-dark.png),
[focused form](../ui-redesign-evidence/r1-sharing-light.png),
[dark form](../ui-redesign-evidence/r1-sharing-dark.png),
[light error](../ui-redesign-evidence/r1-sharing-error-light.png),
[dark error](../ui-redesign-evidence/r1-sharing-error-dark.png).

Browser accounts/HTTP and IndexedDB are disposable fixtures. No normal/local
database, production API, provider or real account was modified. No API, SQL,
Prisma, document format, IndexedDB schema, package or dependency changes.
Physical keyboard/IME, screen-reader, actual browser zoom and live-provider
acceptance remain separate pending checks; viewport/IME simulations do not
replace them. Broader integrated/API/database acceptance remains R7 scope.
No commit, push or deployment. R1 is complete; stop here and resume R2 in a new
session using its specification and the shared foundation.
