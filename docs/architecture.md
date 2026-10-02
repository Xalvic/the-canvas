# Scribble architecture

Inspected on 2026-10-01. These statements describe repository code, not a verified
production deployment. The package is named `the-canvas`; the product is Scribble.

## Current stack and boundaries

React 19, TypeScript, Vite 7, and Zustand 5 power a custom editor. Objects use DOM
components; connectors and strokes use SVG. There is no tldraw, Excalidraw, Yjs,
or networking engine in the editor's dependencies. Lucide supplies UI icons.

[`App`](../src/App.tsx) mounts local persistence and `CanvasViewport`.
[`CanvasViewport`](../src/canvas/viewport/CanvasViewport.tsx) coordinates input,
viewport transforms, and the frame/connector/object/stroke/selection layers.
[`viewportMath`](../src/canvas/viewport/viewportMath.ts) owns coordinate conversion.

| State | Owner | Lifetime and behavior |
| --- | --- | --- |
| Canvas objects | `src/store/documentStore.ts` | Document data keyed by object ID; committed edits create history |
| Undo/redo | Same document store | Session-only snapshot stacks; at most 100 entries |
| Selected IDs | `src/store/selectionStore.ts` | Session-only `Set`; separate from document/history |
| Active tool | `src/store/uiStore.ts` | UI state |
| Interaction mode | `src/store/interactionStore.ts` | Transient interaction state |
| Pointer samples and movement previews | Refs in viewport/object components | Transient; no document/history write per pointer movement |
| Settled viewport | `src/store/viewportStore.ts` | Saved locally; pan/zoom do not enter document history |
| Board title and save status | `src/store/boardStore.ts` | Metadata plus hydration/save feedback |
| Image files | `src/assets/assetStore.ts` | IndexedDB Blobs; document stores asset IDs |
| Theme/tool preferences | Dedicated preference stores | localStorage, separate from the board |
| API board metadata | `server/boards.ts` | New process-local `Map`; not connected to the editor |

## Trace: place one note

1. With Note active, `beginSurfaceInteraction` calls `createObjectAt` in
   [`CanvasViewport`](../src/canvas/viewport/CanvasViewport.tsx).
2. `createObjectAt` subtracts the canvas element's bounding rectangle from the
   browser's client coordinates. `screenToWorld` then removes pan and zoom:
   `worldX = (screenX - panX) / zoom`, likewise for Y.
3. For canvas-relative click `(500, 250)`, pan `(100, 50)`, and zoom `2`, the
   world point is `(200, 100)`.
4. [`createCardObject`](../src/canvas/objects/objectFactories.ts) allocates a UUID
   and timestamps. Its 248 by 172 note starts at `(76, 68)` because its factory
   positions X 124 units left and Y 32 units above the insertion point.
5. [`documentStore.addObject`](../src/store/documentStore.ts) delegates to
   `addObjects`, creates a new object map, pushes the previous snapshot with
   `Create note`, and clears redo. The tool returns to Select, selection becomes
   this ID, and interaction mode becomes `editingText`.
6. [`ObjectLayer`](../src/canvas/layers/ObjectLayer.tsx) subscribes to the object
   map and renders `CanvasObjectView`/`CardObject`. The world layer applies
   `translate(panX, panY) scale(zoom)` to display world data on screen.
7. [`useLocalBoardPersistence`](../src/persistence/useLocalBoardPersistence.ts)
   observes the committed map change and schedules a save after 500 ms. It
   captures objects, title, viewport, schema version, and timestamps. The save
   queue calls `saveLocalBoard`, whose IndexedDB transaction writes the record.

Rendering and saving are separate consumers of the same committed document.
Selection is not a second copy of the document. Undo restores a snapshot and
triggers a save of that restored document without creating another history entry.

## Tests and deployment evidence

Vitest covers coordinate math, document/history, geometry, clipboard, local
record validation, image validation, preferences, and now HTTP behavior.
Playwright covers desktop/touch/appearance/reload/storage-error flows.
See [`learning-progress`](learning-progress.md) for executed checks.

Vite's configured base is `/scribble/`. This establishes an asset path, not proof
of a hosted site. No tracked CI workflow, Docker, PostgreSQL/Prisma, cloud asset
configuration, or backend deployment configuration was found. A real deployment,
if managed outside this repository, remains unknown.

The new API has a separate entry point and build. Vite proxies `/api` and
`/health` during development only. The compiled frontend does not host the API.
