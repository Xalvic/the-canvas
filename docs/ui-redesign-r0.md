# UI redesign R0: baseline and visual proposal

2026-10-07 (Asia/Calcutta). Verified locally. Authority:
[UI_REDESIGN_IMPLEMENTATION_PLAN.md](../UI_REDESIGN_IMPLEMENTATION_PLAN.md), R0 only.
Next milestone: R1, shared visual tokens and UI primitives.

## Review the proposal

Open [ui-redesign-proposal.html](ui-redesign-proposal.html) directly in a browser,
or serve it with the existing Vite development command. It is self-contained and
works without an account, application state, network services or new dependencies.
The 36px reviewer strip is outside the proposed application: choose Owner,
Collapsed or Guest, an example state, and Light/Dark. It is not a replacement
product header. The proposed application has independent title and Share regions.

Click Share in Owner to see the simulated one-click Can view confirmation.
Page menu → Link settings shows activation, Can view/Can edit, copying and Stop
sharing. Copy blocked and Link failure demonstrate separate outcomes. Guest Share
previews Google sign-in followed by explicit transfer consent, with cancellation
and the original drawing retained. Recipient and Stopped link expose only their
entry/unavailable states. No email field or routine Refresh action exists.

The drawing, account, collaborators, saving and sharing are **illustrative**.
There is no real clipboard operation, OAuth, protected document access, upload,
deletion, persistence or API call. Example URLs use `example.invalid`. This
milestone establishes the design; application behavior remains the inherited M11
implementation. Text settings use a representative panel; R3 retains the actual
tool-specific controls rather than copying the illustrative pen fields.

## Visual decisions for R1–R3

Use the existing sans-serif stack without downloading a font. Keep a 4px spacing
rhythm (4, 8, 12, 16, 24), 13–14px main UI text, 11–12px supporting labels,
18–20px icons, 8px control radii and 10–12px floating-surface radii. Desktop
controls are usually 36px; primary touch targets are at least 44px. Tool buttons
already meet 44px on desktop; mobile tool buttons are 48px high. Disabled actions
remain visibly disabled. Keep explicit focus outlines and reduced-motion support.

| Token / surface | Light | Dark |
| --- | --- | --- |
| Canvas | `#f7f7f4` | `#20211f` |
| Floating surface | `#ffffff` | `#2d2e2b` |
| Flat sidebar | `#f0f0ec` | `#272824` |
| Hover / current page | `#e9e9e3` | `#393b35` |
| Main text | `#20211f` | `#f0f1eb` |
| Secondary text | `#55574f` | `#d1d2cb` |
| Muted text | `#66685f` | `#aaaca5` |
| Quiet separator | `#ddded7` | `#454740` |
| Violet accent | `#635bff` | `#8d87ff` |
| Accent button text | `#ffffff` | `#20211f` |
| Accent soft surface | `#eeedff` | `#39364e` |
| Error text | `#9e3636` | `#f3aaa4` |
| Pending notice text / fill | `#805d15` / `#fff9e9` | `#edcd84` / `#393326` |

Reserve shadows for docks, popovers, notices and modal dialogs. Sidebar and
navigation controls are flat. The active page uses neutral fill; primary actions,
active tools and focus use violet. Save/permission states always have text or
accessible descriptions as well as visual indicators.

| Region | Decision |
| --- | --- |
| Desktop sidebar | 240px, edge-attached and full height, 12px internal padding, one edge separator. Search/New page, one page hierarchy, account/help/theme footer. Page actions appear on hover/focus and remain visible on touch. |
| Title | 16px from exposed canvas edge, 12px from top; truncate long title, preserve full accessible identity. Plain text at rest, editable focus state; Enter/blur commit, Escape cancels, composition respected. |
| Share | Independent upper-right control; compact collaborator disclosure alongside it. Local guests have Google entry in the desktop corner and page menu on mobile. |
| Save status | Quiet desktop icon with accessible status/details; mobile details through page menu. Actual failures/pending work get a separate anchored, actionable notice. |
| Drawing dock | Bottom center of the exposed working region. Undo/redo immediately above; compact zoom menu bottom left of that region. |
| Styles | 204px desktop popover on the right; open only when relevant. Compact widths use an on-demand bounded panel; close is reachable, content scrolls in limited height. |
| Dialogs | Native modality, explicit focus wrapping/return, destructive/consent action hierarchy and visual-viewport bounds. Ordinary choices use compact popovers. |

Keep the 768px mobile breakpoint. Between 768px and 1100px use the compact
navigation/drawer presentation and on-demand styles, prioritizing canvas space.
Above 1100px honor the saved desktop sidebar choice; below that threshold its
temporary effective collapse must **not overwrite that preference**. Mobile
uses a bounded modal page drawer, independent 44px title/Share controls, four
primary tools plus More, reachable history and zoom, and safe-area padding.
Notices and styles reserve separate vertical space. Short panels scroll instead
of extending past the viewport or covering essential controls.

In the application, changing overlays must never recenter, scale or otherwise
change canvas world coordinates. The proposal's responsive example artwork is
static composition only. Retain one account controller, existing selection/tool
state, save queues, guest-transfer consent, journals and undo/redo boundaries.
R1 applies tokens/primitives; R2 moves shell/account/navigation; R3 refines tools
and responsive treatment. Authenticated link behavior belongs to R4/R5.

## Baseline and validation

Focused status identified 47 inherited changed/deleted/untracked files apart
from the new plan. Their initial statuses and SHA-256 hashes are recorded in
[r0-inherited-work.json](../ui-redesign-evidence/r0-inherited-work.json).
They include M11 image retry/collaboration recovery changes, browser fixtures,
database/backup tests and completion evidence, plus the intentional old-plan
deletion. The final preservation check confirms every inherited file and Git
status unchanged. Learning documents remain unchanged.

Inspected the existing App, shell, title, sidebar, relevant tool/styles/zoom,
theme and modal paths, and saved owner desktop light/mobile dark M11 screenshots.
The shell is unchanged from that evidence. To verify the current checkout, ran
only the two existing owner/guest layout cases in a disposable copy of
`e2e/ux-layout.spec.ts`, using its existing account/UI fixtures. The copy directs
captures to R0 evidence, preserving all original M11 screenshots and tests.

| Gate | Result |
| --- | --- |
| Current app owner/guest layout fixtures | **2 passed**; both themes × 320, 360, 390, 768, 1024, 1440 widths and 844×390 landscape; pen/styles/drawer combinations included. Account HTTP is mocked. |
| Proposal checks | **47 passed**, recorded in [r0-verification.json](../ui-redesign-evidence/r0-verification.json). |
| Required renders | Owner/collapsed/guest 1440×900 and owner/guest 390×844, both themes; inspected visually. |
| Constraint checks | Long title/styles/menus at 320×700, 360×640, 740×390, 768×1024, 1024×768, 1100×600, 1101×600, 1440×360 and 390×420, both themes; notices/styles additionally checked in short landscape and reduced portrait. No measured chrome overlap or horizontal overflow. |
| Proposal interaction checks | Direct sharing/default role, settings/stop, clipboard fallback versus creation failure, stale scenario completion, guest consent/cancel, private recipient/unavailable state, title keyboard paths, drawer focus and overflow menu navigation. |
| Visual viewport | Consent fits a simulated 380px viewport at offsetTop 120; separate from physical-keyboard acceptance. |
| Isolation | Zero proposal browser errors and zero API/provider requests. No database, app source, package, SQL, Prisma or IndexedDB changes. |

Validation caught and fixed short-screen popover bounds, drawer Tab wrapping,
hidden recipient chrome, short-panel close geometry and captured transition
frames. Final evidence captures disable animations to show settled states.
No full application/build/database gate was needed for this standalone proposal.
Historical M11 integrated results remain historical, not rerun R0 results.
Physical devices, screen readers, live Google/clipboard/provider behavior and
actual browser zoom remain future acceptance work.

Reproduce the proposal gate from the repository root:

```text
npm run dev -- --host 127.0.0.1 --port 4178 --strictPort
node ui-redesign-evidence/r0-verify.mjs
```

The temporary baseline spec/config were removed after the two baseline tests.
Detailed screenshots and the reusable proposal gate live in
`ui-redesign-evidence/`. Representative views:
[desktop light](../ui-redesign-evidence/r0-owner-desktop-light.png),
[desktop dark](../ui-redesign-evidence/r0-owner-desktop-dark.png),
[mobile light](../ui-redesign-evidence/r0-owner-mobile-light.png),
[mobile dark](../ui-redesign-evidence/r0-owner-mobile-dark.png),
[Link settings](../ui-redesign-evidence/r0-link-settings.png),
[short landscape error](../ui-redesign-evidence/r0-short-landscape-error.png).

R0 is complete. Next: execute R1's block, using this token/control spec and
existing UI primitives, with targeted application validation. No commit, push,
deployment, production modification or recreation of the deleted plan occurred.
