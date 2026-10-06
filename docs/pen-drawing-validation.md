# Pen drawing update: local validation

Updated 2026-10-06 (Asia/Calcutta). Physical Redmi acceptance is **pending**.

## Investigation and decisions

The user reports broken drawing at `https://milanputhukkudy.com/scribble/` using
a Xiaomi/Redmi tablet and a budget stylus, with the palm **off** the screen.
Device/stylus models, Android/Chrome versions, pressure support, pointer type,
DPR and refresh rate are unknown. No physical hardware was available here.

Verified source defects included replacing an active stroke on another contact,
unconditionally discarding strokes for pinch, discarding unexpected canceled ink,
dropping stationary force/final short movements, and treating touch fallback
pressure as real force. Those are addressed, but no one defect has been proved
to cause the user's physical-device failure. The previous speed/force combination
could also make fast ink very thin; the new profiles avoid that double attenuation.
Pressure fallback and coalesced-event handling follow the
[Pointer Events specification](https://www.w3.org/TR/pointerevents3/).

One pointer owns ink. Recognized pens reject other contacts; touch-reported
styluses retain first-contact ownership once drawing is established. A second
touch can promote a provisional draft to pinch within 160 ms and 6 cumulative
CSS pixels. Initial ink paints immediately. Unexpected endings preserve confirmed
ink, including dots, once; Escape, tool changes and provisional pinch cancel without history.
Hand/Select navigation remains available. The actual touch policy needs tablet tuning.

New strokes use pinned [perfect-freehand 1.2.3](https://github.com/steveruizok/perfect-freehand)
with rendererVersion=2, inputKind and calibrated per-point inkPressure.
Missing metadata selects the untouched legacy geometry. No migration, database
version, storage key, historical widthRatio reinterpretation or guest upload was
introduced. The strict shared cloud document validator accepts the same new fields.
Deploy the API contract before a frontend that writes renderer 2; older frontend
clients need refreshing before reading these new cloud strokes. No deployment occurred.

Mouse/touch thickness uses screen speed and elapsed time; pens use force with a
visible minimum and no speed attenuation. Library pressure simulation is disabled.
Solid uses uniform width. Size is calibrated to maximum 4/10/20 world-unit diameters.
The confirmed preview endpoint stays exact even for sparse events. World geometry,
rendered bounds, thickness edits and screen-space hit margins share the adapter.

Thin Draw ink below 50% zoom uses a hysteretic centerline and 0.85 CSS-pixel floor.
Rendered-pixel checks caught the outer HTML camera transform shrinking SVG
non-scaling strokes: display/hit widths now explicitly convert CSS pixels back to
world units. Camera transforms remain unchanged. Zoom buckets and live CSS zoom
update presentation without mutating points/history. Dark ink uses identical direct
paint mapping for draft/saved paths; opacity zero and persisted colors remain intact.

## Automated and visual evidence

Commands are reproducible from the project root:

```powershell
npm test
npm run test:e2e -- --output=test-results/all-final
npm run build
npm run typecheck:server
npx playwright test -c playwright.pen.config.ts --output=test-results/pen-production-final
```

- 599 fast tests passed. The 95 opt-in PostgreSQL cases are skipped in this run;
  no database migration or database environment change is part of this update.
- Full standard browser suite: 62 passed, one pre-existing optional UX baseline skipped.
  The final display-width/ending adjustments also pass all 14 pen-specific browser cases.
- Production build and server typecheck passed; new browser fixtures/config also typecheck.
  Build emits the existing bundle-size and Zod annotation warnings.
- Production checks use Chromium at DPR 1/2 and WebKit at DPR 1, zoom 20/35/50/100/400%,
  both themes, Draw/Solid, all sizes, black/dark-gray/white/blue and full/partial/zero opacity.
  The pixel test measures antialiased coverage of a thin horizontal stroke, rather
  than treating computed SVG stroke-width as its final screen width.
  All 19 applicable production cases passed; the host benchmark runs once, with
  its two duplicate browser/DPR instances intentionally skipped.
- Lifecycle tests exercise native CDP touch and pen, synthetic interruption/non-owner
  events, missing coalesced support, final endpoints, stationary pressure, idempotence,
  pen preference, explicit cancel, pan/pinch, reload, undo/redo and high-zoom hit areas.
- Mixed local/cloud version validation rejects malformed profiles; legacy geometry
  remains covered. Offscreen grouped ink retains its DOM movement node, moves with
  its selected partner and reappears after navigation/undo without document removal.

Screenshots, benchmark JSON and failure artifacts remain in ignored `test-results/`.
Local screenshots were visually inspected. Emulation, CDP pen force and browser
pixel checks do not establish hardware pressure, palm rejection or Redmi performance.

## Performance and enhancement gates

Completed geometry is cached by points, width, mode, renderer and input profile.
Appearance/selection changes reuse it. Retention is bounded by 512 point arrays,
50,000 samples and 12 styles per array; one oversized logical stroke can remain
cacheable. Active input paints through one scheduled animation-frame callback.

Measured production culling retains all document data and stable stroke group
elements, but renders only paths inside an overscanned world-space window plus
the existing selection's group/frame movement members. The window updates when
camera movement/zoom crosses its margin, rather than every pointer frame.

Desktop Chromium benchmark (synthetic replay, approximately 60 Hz frame cadence):

| Total / visible / rendered strokes | Reload to stroke nodes | Heap after GC | Idle p95 frame |
| --- | --- | --- | --- |
| 100 / 100 / 100 | 111 ms | 10.1 MB | 16.7 ms |
| 500 / 100 / 100 | 109 ms | 15.1 MB | 16.8 ms |
| 2,000 / 100 / 100 | 209 ms | 33.7 MB | 16.7 ms |

Before culling/bounded caching, the same 2,000-stroke fixture retained 122.5 MB
after GC and took 445 ms to reload. These are individual host runs, not a controlled
device benchmark or a universal speedup. A 30-second replay on the 2,000-stroke
board captured 3,602 samples: short-letter paint p95 0.4 ms; full-stroke paint
p95 3.2 ms / max 6.8 ms; event processing p95 0.3 ms; zero intervals above 25 ms.
The replay committed as one stroke and one undo action. Physical-device profiling,
120 Hz operation, fully visible dense scenes and longer pathological strokes remain
acceptance follow-ups; the final replay report is saved with production test output.

| Optional technique | Decision and evidence |
| --- | --- |
| Cached head / bounded active tail | Deferred: host replay fits the frame budget; algorithm-equivalent seams are not established. Revisit if tablet processing dominates. |
| One Euro filter | Deferred: no measured hardware jitter that justifies stacked smoothing or added lag. |
| Catmull-Rom / fitted Bezier | Deferred: the shared baseline handles finite paths, reversals and exact endpoints; no demonstrated improvement over it. |
| Predicted events | Deferred: no measured remaining tablet latency; confirmed samples alone are persisted. |
| pointerrawupdate | Deferred: no device trace showing benefit beyond coalesced moves; only one ingestion route is active. |
| Camera/rasterization rewrite or geometricPrecision | Deferred: pixel-floor conversion fixes the observed rendering issue; default antialiasing and existing transforms are retained. |

## Physical acceptance still pending

On the Redmi, record hardware/OS/browser/DPR/refresh rate, test palm-off first,
then palm-on, finger, rapid lifts, short letters, circles, loops and a 30-second
stroke at 20/35/50/100/400%. Check Draw/Solid, sizes/themes/opacity, pan/pinch,
selection/group movement, thickness edits, undo/redo and reload of mixed ink.
Compare the reference apps under the same conditions. Separately test a confirmed
pressure-capable device; touch emulation cannot prove actual force support.

For a development build only, open DevTools and call
`scribblePenDiagnostics.start()`, reproduce briefly, then `.stop()` and `.read()`.
The default-off ring holds at most 2,048 lifecycle records with raw pressure,
capture, owner, touch count, secure origin and user agent. It writes no boards,
logs no per-sample console output and is excluded from production. Use Android
remote debugging on the actual deployment for production lifecycle investigation.
