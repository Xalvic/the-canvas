# The Canvas

Milestone 05 of a focused collaborative whiteboard: a polished, desktop-first
infinite viewport with editable objects, selection, history, clipboard tools,
and object-linked connectors.

## Run locally

```bash
npm install
npm run dev
```

## Interaction model

- Use `V`, `H`, `N`, `T`, and `C` to switch between Select, Hand, Note, Text,
  and Connect.
- Double-click empty canvas to create a card, or choose Note/Text and click.
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
Objects are intentionally session-only until the persistence milestone.

World/screen coordinate conversion is centralized in
`src/canvas/viewport/viewportMath.ts` and covered by unit tests.

## Verify

```bash
npm test
npm run build
```
