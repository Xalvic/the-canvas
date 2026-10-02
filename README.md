# The Canvas

Milestone 8.5 of a focused collaborative whiteboard: a polished, desktop-first
infinite viewport with editable objects, selection, history, clipboard tools,
object-linked connectors, frames, grouping, freehand drawing, and reliable local
persistence, including native image paste and drop.

## Run locally

```bash
npm install
npm run dev
```

## Local API learning prototype

In a second terminal, run `npm run dev:server`. The API listens only on
`http://127.0.0.1:3001`. It provides health checks and create/list/read endpoints
for board metadata. Records live in memory and disappear on restart; the canvas
continues to use IndexedDB independently.

See [the HTTP walkthrough](docs/backend.md) for browser requests and error cases,
[architecture](docs/architecture.md) for the existing editor flow, and
[learning progress](docs/learning-progress.md) for the roadmap and checkpoints.

Run `npm run test:server` and `npm run typecheck:server` for targeted API checks.
`npm run build:server` then `npm run start:server` runs the compiled API.
`npm run build` continues to build the frontend. The Vite proxy is development-only;
deployment of the API has not been configured.

## Interaction model

- Use `V`, `H`, `N`, `T`, `C`, `F`, and `P` to switch between Select, Hand,
  Note, Text, Connect, Frame, and Pen.
- Double-click empty canvas to create a card, or choose Note/Text and click.
- Paste PNG, JPEG, WEBP, or GIF data/files with `Ctrl`/`Cmd + V`, or drag image
  files directly onto the canvas. Images are inserted at the pointer, capped at
  480 × 360 canvas units, and support multiple-file insertion.
- Edit the board title beside the logo. Board content, title, and viewport
  autosave locally after changes settle and reopen on the next visit.
- Note, Text, and Frame return to Select after placing one object. Pen and Hand
  stay active for repeated use.
- Click to select and Shift-click to add or remove an object from selection.
- Drag empty space with Select active to marquee-select intersecting objects.
- Hold Shift while marquee-selecting to add objects to the current selection.
- Drag any selected object to move the whole selection as one interaction.
- Drag the visible handle on a single selection to resize.
- Image corner resizing preserves aspect ratio; hold `Shift` for a freeform
  container resize.
- Double-click an object to edit its content inline.
- Drag from any object's top, right, bottom, or left anchor with Connect active.
- Connect creates a directional arrow; Shift-drag creates a plain line.
- Select a connector to delete it, drag either endpoint to reconnect it, or press
  `A` to toggle its arrowhead.
- Choose Frame and drag empty space to draw a titled section, or click once for
  a default-sized frame. Double-click its title to rename it.
- Frames sit behind content and move fully contained objects by default. Select
  a frame and press `M` to toggle between moving its contents and leaving them
  fixed.
- Select multiple spatial objects and use `Ctrl`/`Cmd + G` to create a flat
  group. Use `Ctrl`/`Cmd + Shift + G` to ungroup it.
- Choose Pen and drag anywhere on the board. Draw mode uses smoothed velocity
  and available pressure: slower movement and more force produce thicker lines.
  Solid mode draws at a constant width. Both offer Small / Large / XL thickness,
  a 16-color palette, and 0–100% opacity in a compact panel on the left, below
  the logo and board name. Color swatches are circular; size and weight controls
  use initials, and alignment uses icons with accessible labels.
- Text offers the same palette and opacity controls, Small / Medium / Large / XL
  sizes, Regular / Medium / Bold weight, and Left / Center / Right alignment.
- Pen and Text preferences save locally, separately from the board. New objects
  inherit them; existing objects keep their own appearance. Select one stroke or
  text object and click **Edit appearance** in the toolbar to restyle it.
  Style changes support undo/redo; opacity previews commit once on release.
- Toolbar buttons show icons, with tool names and shortcuts on hover or keyboard
  focus. Autosave is silent unless a persistence error occurs.
- Switch to Select to select, move, group, duplicate, copy, or delete strokes.
- Press `Delete`/`Backspace` to remove the selection. Removing a node also
  removes its attached connectors in the same undoable operation.
- Use `Ctrl`/`Cmd + C` and `Ctrl`/`Cmd + V` for internal copy/paste.
- Use `Ctrl`/`Cmd + D` to duplicate the current selection.
- Use `Ctrl`/`Cmd + Z`, `Ctrl`/`Cmd + Shift + Z`, or `Ctrl + Y` for undo/redo.
- Use Hand, Space-drag, middle-drag, or scrolling to pan.
- A mouse wheel or two-finger trackpad scrolling pans the viewport.
- Trackpad pinch or `Ctrl`/`Cmd` + scroll zooms around the pointer.
- Use the bottom-right controls or `+`, `-`, and `0` for zoom/reset.

Object positions and dimensions are stored in world coordinates. Move, multi-move,
resize, and marquee interactions render transiently and commit once on release.
Document history is capped at 100 meaningful operations; viewport and selection
state are intentionally excluded.
Connectors store object and anchor references, render as SVG Bézier paths, and
update live while connected objects move or resize. Copying both endpoint nodes
also copies and remaps their internal connector.
Frame movement and group movement commit once per drag. Copied groups receive a
new group identity, so pasted and original groups remain independent.
Each pen gesture commits as one history operation. Stroke points remain editable
document data rather than being flattened into a bitmap.
New Draw points preserve smoothed width ratios and velocity. Legacy pressure
paths retain their rendering, and points without pressure render at their stored
base width. Sampling uses refs and the SVG draft paints at most once per animation
frame; document state changes only at the end of a gesture.
The current board is stored in IndexedDB with schema metadata and created/updated
timestamps. Saves are debounced, serialized, and triggered only by committed
document changes, settled viewport changes, or title edits. Selection and undo
history remain session-only.
Image objects store lightweight asset references in the board document. Their
original Blobs live separately in the IndexedDB asset store and are restored via
temporary object URLs that are revoked when no longer needed.

World/screen coordinate conversion is centralized in
`src/canvas/viewport/viewportMath.ts` and covered by unit tests.

## Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser coverage includes mouse lines/curves, native touch input, simulated
stylus force, object creation, frame movement, appearance history, opacity
preview grouping, local persistence, keyboard controls, and narrow viewports.
Physical stylus hardware still needs a hands-on feel check.
