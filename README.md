# The Canvas

Milestone 08 of a focused collaborative whiteboard: a polished, desktop-first
infinite viewport with editable objects, selection, history, clipboard tools,
object-linked connectors, frames, grouping, freehand drawing, and reliable local
persistence.

## Run locally

```bash
npm install
npm run dev
```

## Interaction model

- Use `V`, `H`, `N`, `T`, `C`, `F`, and `P` to switch between Select, Hand,
  Note, Text, Connect, Frame, and Pen.
- Double-click empty canvas to create a card, or choose Note/Text and click.
- Edit the board title beside the logo. Board content, title, and viewport
  autosave locally after changes settle and reopen on the next visit.
- Note and Text remain active for repeated placement; press `Escape` or `V` to return to Select.
- Click to select and Shift-click to add or remove an object from selection.
- Drag empty space with Select active to marquee-select intersecting objects.
- Hold Shift while marquee-selecting to add objects to the current selection.
- Drag any selected object to move the whole selection as one interaction.
- Drag the visible handle on a single selection to resize.
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
- Choose Pen and drag anywhere on the board to draw. Pointer samples are stored
  in world coordinates and rendered as smooth, variable-width SVG paths. A
  stylus uses real pressure; a mouse gets a subtle thin-to-full-width start.
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
The current board is stored in IndexedDB with schema metadata and created/updated
timestamps. Saves are debounced, serialized, and triggered only by committed
document changes, settled viewport changes, or title edits. Selection and undo
history remain session-only.

World/screen coordinate conversion is centralized in
`src/canvas/viewport/viewportMath.ts` and covered by unit tests.

## Verify

```bash
npm test
npm run build
```
