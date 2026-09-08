# The Canvas

Milestone 03 of a focused collaborative whiteboard: a polished, desktop-first
infinite viewport with editable objects and a complete selection system.

## Run locally

```bash
npm install
npm run dev
```

## Interaction model

- Use `V`, `H`, `N`, and `T` to switch between Select, Hand, Note, and Text.
- Double-click empty canvas to create a card, or choose Note/Text and click.
- Click to select and Shift-click to add or remove an object from selection.
- Drag empty space with Select active to marquee-select intersecting objects.
- Hold Shift while marquee-selecting to add objects to the current selection.
- Drag any selected object to move the whole selection as one interaction.
- Drag the visible handle on a single selection to resize.
- Double-click an object to edit its content inline.
- Press `Delete`/`Backspace` to remove the selected object.
- Use Hand, Space-drag, middle-drag, or scrolling to pan.
- A mouse wheel or two-finger trackpad scrolling pans the viewport.
- Trackpad pinch or `Ctrl`/`Cmd` + scroll zooms around the pointer.
- Use the bottom-right controls or `+`, `-`, and `0` for zoom/reset.

Object positions and dimensions are stored in world coordinates. Move, multi-move,
resize, and marquee interactions render transiently and commit once on release.
Objects are intentionally session-only until the persistence milestone.

World/screen coordinate conversion is centralized in
`src/canvas/viewport/viewportMath.ts` and covered by unit tests.

## Verify

```bash
npm test
npm run build
```
