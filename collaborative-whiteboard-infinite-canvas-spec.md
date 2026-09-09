# Collaborative Whiteboard / Infinite Canvas — MVP Product & Technical Spec

## 1. Project Summary

**Working title:** Collaborative Whiteboard / Infinite Canvas

**Core idea:**  
A fast, lightweight visual workspace where people can think, organize ideas, sketch flows, connect concepts, and collaborate in real time on an infinite canvas.

The project should feel closer to a focused product-thinking workspace than a bloated design tool.

The main experience is:

> **Create → move → connect → group → collaborate**

The product should demonstrate strong frontend engineering, interaction design, spatial UI, real-time collaboration, state architecture, and product thinking.

The goal is **not** to recreate all of Miro, FigJam, Figma, or Excalidraw.

The goal is to build a polished, opinionated subset that feels excellent.

---

# 2. Product Positioning

Possible positioning:

> **A lightweight collaborative canvas for thinking visually.**

or:

> **An infinite workspace for ideas, flows, and collaborative thinking.**

This project should feel useful for:

- brainstorming
- mapping ideas
- planning product flows
- lightweight diagrams
- organizing research
- workshop sessions
- visual note-taking
- remote collaboration

The product should not initially try to support professional vector design.

---

# 3. Product Principles

## 3.1 Canvas first

The infinite canvas is the product.

Do not begin by building:

- dashboards
- teams
- workspaces
- profile settings
- billing
- templates marketplace

The first goal is:

> Does panning, zooming, creating, selecting, moving, and connecting objects feel fast and natural?

## 3.2 Fast interaction

Every common action should feel immediate.

Examples:

- double click/tap canvas → create text/card
- drag empty space → pan
- scroll/pinch → zoom
- drag object → move
- shift-click → multi-select
- drag selection box → select many
- delete key → remove selection
- copy/paste → duplicate
- undo/redo → instant

The product should minimize modal dialogs and configuration panels.

## 3.3 Spatial clarity

Objects should remain understandable even as the canvas grows.

Use:

- snapping
- alignment guides
- grouping
- frames/sections
- connectors
- zoom-aware rendering
- sensible object hierarchy

The canvas should not become visually chaotic too quickly.

## 3.4 Progressive complexity

Start with a small number of primitives:

- text
- sticky/card
- rectangle
- connector
- freehand stroke
- frame/group

Do not start with dozens of shape types.

## 3.5 Collaboration should feel native

Real-time collaboration should eventually support:

- multiple cursors
- live object movement
- presence
- selections
- basic comments or reactions

Collaboration should not feel bolted on after the fact.

However, build the **single-user interaction engine first** before adding networking.

---

# 4. Platform Strategy

Build as a **desktop-first responsive web app**.

Primary use:

- desktop
- laptop
- tablet

Mobile phone support can be limited for the first MVP.

The canvas should still load on mobile, but complex editing does not need to be optimized for small screens initially.

---

# 5. Recommended Technology Stack

## Core application

- **React**
- **TypeScript**
- **Vite**

## State management

- **Zustand**

Recommended separation:

- document state
- UI state
- selection state
- viewport state
- collaboration presence

## Rendering

Recommended approach for this portfolio project:

### DOM/SVG hybrid

Use:

- regular DOM for cards/text
- SVG for connectors
- Canvas for freehand drawing if useful

This keeps text crisp and editable while allowing performant connectors.

Avoid building everything inside a single `<canvas>` unless there is a strong reason.

## Gestures / interaction

Use native:

- Pointer Events
- Wheel Events
- Keyboard Events

Avoid introducing a heavy canvas framework at the beginning.

The point of this project is partly to demonstrate that you understand:

- coordinate transforms
- viewport math
- selection
- hit testing
- dragging
- zooming
- spatial state

## Styling

- Tailwind CSS
- standard CSS where appropriate

## Animation

- Motion / Framer Motion for UI transitions only

Do not use it for high-frequency dragging.

## Persistence

For single-user MVP:

- IndexedDB
- `localforage` optional

For collaboration phase:

### Option A — Yjs

- `yjs`
- `y-websocket` or equivalent provider

Good if you want to demonstrate CRDT concepts.

### Option B — Liveblocks

Simpler developer experience.

Good if the main goal is product polish rather than infrastructure.

### Recommendation

For portfolio depth:

> **Use Yjs if you want collaboration architecture to be part of the case study.**

For faster delivery:

> **Use Liveblocks if real-time presence and shared state are the priority.**

Do not implement collaboration before the core canvas interaction is stable.

---

# 6. MVP Non-Goals

Do **not** build these initially:

- billing
- authentication
- organizations
- admin dashboard
- permissions system
- complex role management
- presentation mode
- template marketplace
- AI clustering
- AI summarization
- AI-generated diagrams
- full vector editor
- image masking
- PDF export
- multi-page documents
- complex tables
- spreadsheets
- kanban mode
- video calls
- voice chat
- version history UI
- plugin ecosystem
- mobile-first editor
- offline multi-user sync
- enterprise security features

Put future ideas into `later.md`.

---

# 7. Core Product Model

The canvas contains **objects**.

Recommended initial object types:

```ts
type CanvasObject =
  | TextObject
  | CardObject
  | ShapeObject
  | ConnectorObject
  | StrokeObject
  | FrameObject;
```

Every object should have a stable ID.

Base model:

```ts
type BaseObject = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
};
```

Object coordinates should exist in **world/canvas space**, not screen space.

---

# 8. Coordinate System

This project depends heavily on a clean coordinate model.

Maintain:

## World coordinates

Where objects exist.

Example:

```text
Card A = x: 1200, y: -640
```

## Screen coordinates

Where the pointer currently exists in the browser viewport.

## Viewport transform

```ts
type Viewport = {
  x: number;
  y: number;
  zoom: number;
};
```

The viewport translates world space into screen space.

Conceptually:

```text
world position
      ↓
apply zoom
      ↓
apply viewport translation
      ↓
screen position
```

You need helper utilities:

```ts
screenToWorld()
worldToScreen()
```

These should be centralized and well-tested.

---

# 9. Milestone 01 — Infinite Canvas

Build only the viewport.

Requirements:

- canvas fills available workspace
- click/drag empty canvas to pan
- mouse wheel / trackpad zoom
- zoom around pointer position
- sensible zoom limits
- reset viewport
- fit content later
- prevent accidental browser page zoom where appropriate

Suggested zoom range:

```text
0.2x → 4x
```

Exact values can be tuned.

The important part is that zoom feels anchored to the cursor.

---

# 10. Panning Behavior

Desktop interactions:

## Mouse

- middle mouse drag → pan
- space + left drag → pan
- optionally left drag on empty canvas → pan

Recommended:

- left drag on empty canvas pans
- drag starting on object moves object
- space temporarily forces pan mode

## Trackpad

Support:

- two-finger scroll → pan
- pinch gesture / ctrl+wheel → zoom where available

Test heavily on actual trackpads.

---

# 11. Milestone 02 — Basic Objects

Add only two object types first:

- text
- card/sticky note

## Text object

Requirements:

- create
- edit inline
- move
- resize width
- delete

## Card object

Requirements:

- title/body text
- move
- resize
- basic background variants later
- delete

Card creation options:

- toolbar
- keyboard shortcut
- double-click empty space

Double-click creation is highly recommended.

---

# 12. Selection Model

Implement selection early.

Required states:

- no selection
- single object
- multiple objects

Selection should support:

- click object
- shift-click object
- drag selection box
- click empty canvas to clear
- Escape to clear
- Delete/Backspace to remove

Conceptual selection state:

```ts
type SelectionState = {
  ids: Set<string>;
};
```

Avoid storing `selected: true` inside every object.

Selection is UI state, not document data.

---

# 13. Selection Box / Marquee

Allow dragging across empty canvas to select objects.

Behavior:

- pointer down on empty canvas
- drag creates selection rectangle
- intersecting objects become selected
- modifier key can add to existing selection

This is a significant interaction milestone.

---

# 14. Milestone 03 — Moving and Resizing

Objects should support:

- drag movement
- resize handles
- multi-selection movement

Important technical rule:

Do not write every pointer movement into persistent storage immediately.

Use transient interaction state during drag.

Example flow:

```text
pointerdown
   ↓
capture starting positions
   ↓
pointermove
   ↓
render transient transformed positions
   ↓
pointerup
   ↓
commit final positions to document state
```

This makes undo history cleaner and reduces unnecessary writes.

---

# 15. Snapping and Alignment

After movement works, add lightweight snapping.

Recommended MVP snapping:

- grid snapping optional
- horizontal center guide
- vertical center guide
- edge alignment
- equal spacing later

Show temporary visual guides.

Do not make snapping overly aggressive.

Consider holding a modifier key to temporarily disable snapping.

---

# 16. Milestone 04 — Connectors

Connectors make the canvas useful for flows.

Add:

- directional connector
- non-directional connector
- optional arrowhead

Objects should expose connection anchors:

```text
top
right
bottom
left
```

A connector should store references to objects rather than fixed screen coordinates whenever possible.

Example:

```ts
type ConnectorObject = {
  id: string;
  type: "connector";
  from: {
    objectId: string;
    anchor: "top" | "right" | "bottom" | "left";
  };
  to: {
    objectId: string;
    anchor: "top" | "right" | "bottom" | "left";
  };
};
```

The connector updates automatically when connected objects move.

---

# 17. Connector Rendering

Render connectors in SVG.

Suggested first routing:

- straight line
- or simple curved Bézier

Do not build a complex orthogonal router initially.

Later experimentation can include:

- elbow routing
- smart routing
- avoiding overlap

---

# 18. Milestone 05 — Frames / Sections

Add a Frame object for organizing groups.

A frame can represent:

- workflow stage
- brainstorm category
- sprint area
- journey step

Frame behavior:

- has title
- can contain objects spatially
- moving frame can optionally move contained objects
- frame sits visually behind content

This helps large canvases remain understandable.

---

# 19. Grouping

Grouping can be introduced after frames.

MVP grouping:

- select multiple objects
- `Ctrl/Cmd + G`
- move as one
- ungroup

Do not build nested grouping at first unless needed.

---

# 20. Milestone 06 — Freehand Drawing

Add simple pen drawing.

Use Canvas or SVG paths.

Requirements:

- pointer down starts stroke
- pointer move adds points
- pointer up ends stroke
- basic smoothing
- delete stroke
- undo stroke

Store path points in world coordinates.

```ts
type StrokeObject = {
  id: string;
  type: "stroke";
  points: Array<{ x: number; y: number }>;
  width: number;
};
```

Do not build brush libraries or advanced pressure-sensitive calligraphy initially.

---

# 21. Keyboard Shortcuts

MVP shortcuts:

```text
V              Select
H / Space      Pan
T              Text
N              Card / Note
C              Connector
P              Pen

Delete         Delete selection
Escape         Clear / cancel
Cmd/Ctrl + Z   Undo
Cmd/Ctrl + Shift + Z / Y
               Redo
Cmd/Ctrl + C   Copy
Cmd/Ctrl + V   Paste
Cmd/Ctrl + D   Duplicate
Cmd/Ctrl + G   Group
```

Shortcuts should never interfere with active text editing.

---

# 22. Clipboard

Support internal copy/paste.

Expected behavior:

- copy selected objects
- paste near original
- remap IDs
- remap connector references if both connected objects are copied

System clipboard JSON export is optional.

Internal clipboard is enough for MVP.

---

# 23. Undo / Redo

Undo/redo is essential for a canvas tool.

Use command/history snapshots carefully.

Recommended approach:

- store document-level history
- commit meaningful interactions
- do not store every drag frame

Examples of one history entry:

- move object from A to B
- resize object
- create object
- delete object
- edit text
- connect objects

Dragging across 200 pointer events should produce **one** undo action.

---

# 24. Suggested State Architecture

Separate state into categories.

## Document Store

Contains persistent board data:

```ts
{
  objects,
  boardMetadata
}
```

## UI Store

Contains:

- active tool
- panels
- temporary menus
- hover state

## Selection Store

Contains:

- selected IDs
- active selection bounds

## Viewport Store

Contains:

- x
- y
- zoom

## Interaction Store

Transient state:

- dragging
- resizing
- marquee
- connector creation
- active pointer

## Presence Store

Later collaboration state:

- cursor
- active user
- remote selections

This separation helps prevent the entire app from rerendering on every pointer move.

---

# 25. Rendering Architecture

Recommended structure:

```text
CanvasViewport
│
├── BackgroundGrid
├── SVGConnectorLayer
├── ObjectLayer
│   ├── TextObject
│   ├── CardObject
│   ├── ShapeObject
│   └── FrameObject
├── StrokeLayer
├── SelectionLayer
├── RemotePresenceLayer
└── InteractionOverlay
```

Apply the same viewport transform consistently across world-space layers.

---

# 26. Performance Rules

This project can become slow quickly if architecture is careless.

Important rules:

1. Avoid rerendering every object during pointer movement.
2. Subscribe components only to the state they need.
3. Use stable object IDs.
4. Avoid global React state updates for cursor movement.
5. Use CSS transforms for dragging where appropriate.
6. Batch document commits.
7. Use `requestAnimationFrame` for high-frequency visual updates.
8. Virtualization can be added later for huge boards.
9. Remote cursor updates should be throttled.
10. Connector recalculation should only occur when dependencies move.

---

# 27. Background Grid

A subtle grid helps communicate infinite space.

Options:

- dot grid
- line grid
- no grid

Recommended default:

**dot grid**

The grid should:

- move with pan
- scale appropriately with zoom
- become less visually dominant when zoomed out

Avoid high-contrast grid lines.

---

# 28. MVP Toolbar

Keep toolbar minimal.

Suggested tools:

```text
Select
Hand
Text
Card
Shape
Connector
Pen
```

Secondary controls:

```text
Undo
Redo
Zoom
```

Do not build a huge property inspector initially.

---

# 29. Contextual Object Controls

When an object is selected, show only relevant actions.

Examples:

For card:

- background
- text style
- duplicate
- delete

For connector:

- line style
- arrow
- delete

For frame:

- title
- duplicate
- delete

Keep these controls contextual rather than permanently visible.

---

# 30. MVP 1 — Single-User Definition

Before collaboration, the canvas should support:

## Navigation

- pan
- zoom
- reset/fit

## Objects

- text
- cards
- basic shapes
- connectors
- frames
- pen strokes

## Editing

- inline text edit
- move
- resize
- multi-select
- marquee selection
- delete
- duplicate
- copy/paste
- grouping

## Productivity

- undo
- redo
- keyboard shortcuts
- snapping/alignment

## Persistence

- save board locally
- reopen board

Do not start collaboration until this feels reliable.

---

# 31. Local Persistence

Use IndexedDB/localforage.

Persist:

- board objects
- viewport position optionally
- board title
- timestamps

MVP can support:

- one current board
- or a very small recent-board list

Do not build a complex workspace dashboard.

---

# 32. Milestone 07 — Collaboration Foundation

After single-user interactions are stable, add real-time collaboration.

Minimum collaboration features:

- two browser sessions can open same board
- create object in one → appears in other
- move object → updates remotely
- edit text → syncs
- delete → syncs
- connectors remain valid
- conflicts do not corrupt board

Recommended architecture:

```text
Local UI
   ↓
Shared Document
   ↓
CRDT / realtime provider
   ↓
Other clients
```

If using Yjs:

```text
React/Zustand UI
      ↓
Y.Doc
      ↓
Y.Map / Y.Array
      ↓
Provider
      ↓
Other clients
```

---

# 33. Collaboration Data Strategy

Do not synchronize every piece of UI state.

## Shared/document state

Sync:

- objects
- text content
- dimensions
- positions
- connectors
- groups/frames

## Presence state

Sync separately:

- cursor position
- user name
- user color
- current selection
- currently editing object

Do **not** persist presence as document content.

---

# 34. Milestone 08 — Live Cursors

Add remote cursors.

Cursor state:

```ts
type Presence = {
  userId: string;
  name: string;
  cursor: {
    x: number;
    y: number;
  } | null;
  selectedIds: string[];
};
```

Use world coordinates for cursor position.

Remote cursors should display:

- pointer
- small user label
- selection outline if useful

Throttle cursor updates.

Example:

```text
20–30 updates/second maximum
```

Exact rate can be tuned.

---

# 35. Milestone 09 — Remote Selection / Editing Presence

Show what collaborators are doing.

Possible indicators:

- colored object outline
- “Milan is editing”
- colored selection box
- live drag position

Avoid preventing simultaneous edits unless absolutely necessary.

Presence should communicate activity rather than lock the board.

---

# 36. Milestone 10 — Comments

Add lightweight comments only after collaboration works.

Possible model:

- attach comment to object
- comment thread
- resolve/unresolve
- author + timestamp

Do not build mentions, notifications, email, or permission systems in MVP.

If comments add too much scope, they can remain post-MVP.

---

# 37. MVP 2 — Collaborative Definition

The collaborative MVP is complete when:

1. Two users open the same board.
2. Both can see each other's cursors.
3. Both can create objects.
4. Objects synchronize quickly.
5. Both can move objects.
6. Text edits synchronize safely.
7. Selections/presence are visible.
8. Undo does not destroy another user's work unexpectedly.
9. Reconnection does not corrupt the board.
10. The board remains usable during normal simultaneous editing.

---

# 38. Conflict and Undo Strategy

Collaboration complicates undo.

Do not implement naive global snapshot undo after adding multiplayer.

Preferred behavior:

- undo only the local user's operations
- remote changes remain intact

If using Yjs, use Yjs UndoManager scoped to local origins where appropriate.

This is worth discussing in the portfolio case study.

---

# 39. Suggested File Structure

```text
src/

  canvas/
    viewport/
      viewportMath.ts
      useViewport.ts
      Viewport.tsx

    interactions/
      pointerController.ts
      dragController.ts
      resizeController.ts
      selectionController.ts
      connectorController.ts

    objects/
      BaseObject.ts
      TextObject.tsx
      CardObject.tsx
      ShapeObject.tsx
      FrameObject.tsx
      ConnectorObject.tsx
      StrokeObject.tsx

    layers/
      GridLayer.tsx
      ConnectorLayer.tsx
      ObjectLayer.tsx
      StrokeLayer.tsx
      SelectionLayer.tsx
      PresenceLayer.tsx

  store/
    documentStore.ts
    uiStore.ts
    viewportStore.ts
    selectionStore.ts
    interactionStore.ts

  history/
    historyManager.ts

  persistence/
    localBoardStorage.ts

  collaboration/
    provider.ts
    presence.ts
    sharedDocument.ts

  components/
    Toolbar/
    ContextToolbar/
    ZoomControls/

  utils/
    geometry.ts
    ids.ts
    keyboard.ts

  App.tsx
```

Keep canvas math and interaction systems separate from generic UI.

---

# 40. Interaction State Machine

For complex canvas tools, explicit interaction states help avoid bugs.

Possible states:

```text
idle
panning
marqueeSelecting
draggingObjects
resizing
editingText
drawingConnector
drawingStroke
```

Only one primary interaction mode should control the pointer at a time.

Conceptual model:

```ts
type InteractionMode =
  | "idle"
  | "panning"
  | "marquee"
  | "dragging"
  | "resizing"
  | "connecting"
  | "drawing";
```

This is easier to reason about than many unrelated boolean flags.

---

# 41. Pointer Capture

Use `setPointerCapture()` for drag interactions.

This prevents losing the interaction when the pointer moves outside the original element.

Use it for:

- dragging
- resizing
- marquee
- connector creation
- pen strokes

Always release/reset transient interaction state on:

- `pointerup`
- `pointercancel`

---

# 42. Touch / Tablet Support

After mouse interaction is stable, support:

- one-finger object interaction
- one-finger drawing
- two-finger pan
- pinch zoom

Do not let touch support destabilize the first desktop milestone.

Tablet support is valuable for the portfolio, especially for freehand drawing.

---

# 43. UX Validation Questions

Test the product against these questions.

## Navigation

- Does zoom feel anchored and predictable?
- Can the user move around without getting lost?
- Is panning discoverable?

## Creation

- Can a new idea be added in under two seconds?
- Is double-click/tap creation intuitive?
- Is the toolbar necessary for common actions?

## Manipulation

- Does moving objects feel direct?
- Is multi-selection predictable?
- Are resize handles easy to understand?

## Structure

- Do connectors help without creating clutter?
- Do frames make large boards easier to understand?

## Collaboration

- Can users tell where collaborators are?
- Can they tell what another person is editing?
- Does simultaneous editing feel safe?

---

# 44. User Testing Plan

## Test 1 — Solo navigation

Give the board to someone with no instructions.

Ask them:

> Create three ideas and arrange them.

Observe:

- how they try to create objects
- whether they understand panning
- whether they use zoom
- whether selection feels obvious

## Test 2 — Flow creation

Ask:

> Create a simple onboarding flow with four steps.

Observe:

- whether they discover connectors
- whether moving nodes preserves connections
- whether alignment feels frustrating
- whether they look for grouping

## Test 3 — Brainstorm

Ask:

> Put six ideas on the canvas and organize them into two groups.

Observe:

- whether frame/group concepts are discoverable
- whether spatial organization feels natural

## Test 4 — Collaboration

Two users edit the same board.

Ask them to:

- create notes
- group ideas
- move items
- edit the same area

Observe:

- confusion around ownership
- overwritten changes
- cursor usefulness
- whether presence makes collaboration clearer

---

# 45. UI Design Direction

Do not design the app like a dashboard.

The canvas should dominate.

Recommended layout:

```text
┌───────────────────────────────────────────────┐
│ [tool] [tool] [tool]                         │
│                                               │
│                                               │
│                  CANVAS                       │
│                                               │
│                                               │
│                              collaborators ○○ │
│                                               │
│                         zoom  85%   +   -      │
└───────────────────────────────────────────────┘
```

Controls should feel secondary.

---

# 46. Toolbar Direction

A compact floating toolbar is appropriate.

Possible layout:

```text
Select
Hand
Note
Text
Shape
Connector
Pen
```

Use tooltips and accessible names.

---

# 47. Object Styling

Keep objects visually simple.

Recommended MVP visual language:

- neutral canvas
- soft cards
- restrained border
- clear typography
- subtle selection handles
- one accent for active UI
- a few muted card variants

Avoid excessive:

- gradients
- glass effects
- shadows
- neon colors

This project should feel like a serious product tool.

---

# 48. Zoom-Aware UI

Certain details should adapt with zoom.

Examples:

At low zoom:

- hide resize handles
- simplify text rendering if necessary
- reduce connector decoration

At high zoom:

- show full editing affordances

Do not implement aggressive level-of-detail systems unless performance requires it.

---

# 49. Fit to Content

Add a “Fit” command after objects exist.

Behavior:

- calculate object bounds
- add padding
- update viewport to show all content

Useful shortcut can be added later.

---

# 50. Mini-map — Post MVP

A minimap may be useful for large canvases.

Do not build it initially.

Only add if user testing shows people frequently get lost.

---

# 51. Autosave

Local MVP should autosave.

Recommended behavior:

- debounce document saves
- show subtle “Saved” state
- never block interaction

Do not autosave on every pointer frame.

Commit after meaningful operations.

---

# 52. Board Model

For MVP:

```ts
type Board = {
  id: string;
  title: string;
  objects: Record<string, CanvasObject>;
  createdAt: number;
  updatedAt: number;
};
```

Using an object map by ID can make updates and connector lookups efficient.

---

# 53. Development Milestones

## Milestone 01 — Viewport

Build:

- pan
- zoom
- coordinate conversion
- background grid

Stop and test feel.

## Milestone 02 — Cards & Text

Build:

- create
- edit
- move
- delete

Stop and test interaction.

## Milestone 03 — Selection System

Build:

- click select
- shift-select
- marquee
- multi-move
- resize

## Milestone 04 — History & Clipboard

Build:

- undo
- redo
- duplicate
- copy/paste
- keyboard shortcuts

## Milestone 05 — Connectors

Build:

- anchors
- draw connection
- reconnect
- automatic position update

## Milestone 06 — Frames / Groups

Build:

- frames
- group movement
- basic grouping

## Milestone 07 — Pen / Freehand

Build:

- strokes
- smoothing
- delete
- undo

## Milestone 08 — Local Persistence

Build:

- autosave
- reopen board
- recent board state if needed

At this point:

**Single-user MVP is complete.**

Use it before adding collaboration.

## Milestone 09 — Shared Document

Add:

- Yjs or Liveblocks
- shared board
- object synchronization

## Milestone 10 — Presence

Add:

- remote cursors
- collaborator names
- remote selection

## Milestone 11 — Collaboration Polish

Test:

- simultaneous moves
- simultaneous text edits
- reconnect
- local-only undo
- latency handling

## Milestone 12 — Optional Comments

Only if the core collaboration is already polished.

---

# 54. Recommended First Codex Task

Start with **Milestone 01 only**.

Suggested prompt:

> Build a React + TypeScript + Vite prototype for an infinite canvas workspace. Implement a large canvas viewport with a subtle dot grid. Users should be able to pan and zoom smoothly using Pointer Events and wheel/trackpad input. Zoom must remain anchored around the pointer position. Store the viewport as world translation X/Y plus zoom. Create reusable `screenToWorld` and `worldToScreen` utilities. Do not add cards, drawing, collaboration, authentication, or elaborate styling yet. Keep the viewport interaction architecture separate from React UI state where high-frequency pointer updates are involved. The goal is to make panning and zooming feel excellent before any other feature is added.

After this is stable, continue to **Milestone 02 — Cards & Text**.

---

# 55. Suggested Milestone 02 Codex Task

> Add basic objects to the existing infinite canvas. Implement two object types: a simple editable text object and a card/sticky note. Objects must store their positions in world coordinates. Users should be able to create an object by double-clicking the canvas, drag objects to move them, click to select them, edit their text inline, and delete the selected object. Dragging should use transient interaction state and only commit the final position to document state on pointer release. Do not add connectors, collaboration, groups, or advanced styling yet.

---

# 56. Suggested Milestone 03 Codex Task

> Add a proper selection system. Support single selection, Shift-click multi-selection, click-empty-space to clear selection, Escape to clear, marquee selection by dragging on empty canvas, and moving multiple selected objects together. Keep selection state separate from the persistent document data. Do not store `selected` flags inside canvas objects.

---

# 57. Portfolio / Case Study Value

This project can become a very strong portfolio piece because it demonstrates more than UI implementation.

It can show:

## Product problem

How do you make spatial collaboration feel fast and understandable without overwhelming the user?

## Interaction design

- panning
- zooming
- selection
- object manipulation
- connectors
- grouping
- collaboration presence

## Engineering

- coordinate systems
- world/screen transforms
- interaction state machine
- performance optimization
- history model
- real-time synchronization
- CRDT or multiplayer state
- local vs shared state

## UX iteration

Show:

- early viewport experiments
- selection behavior changes
- connector design iterations
- collaboration feedback
- usability findings

---

# 58. Case Study Structure

When the project is mature, document it like this:

## Problem

Existing whiteboards can feel bloated or over-featured for lightweight thinking.

## Hypothesis

A smaller set of highly polished spatial interactions may create a faster thinking environment.

## Goals

- instant object creation
- smooth navigation
- easy structuring
- safe collaboration

## Constraints

- web-based
- low latency
- multiple users
- large spatial document
- minimal UI chrome

## Process

Show:

- interaction sketches
- architecture
- viewport math
- selection prototype
- connector prototype
- collaboration prototype

## User Testing

Document what users attempted naturally.

## Final Experience

Show:

- solo board creation
- connection flow
- grouping
- live multi-user editing

## Technical Deep Dive

Explain:

- world coordinates
- rendering layers
- pointer capture
- transient interaction state
- undo strategy
- Yjs or collaboration architecture
- performance decisions

## Reflection

Explain what you would build next and what you intentionally did not include.

---

# 59. Optional Differentiators — After MVP

Once the core project is polished, consider **one or two** distinctive features.

Do not add all of them.

Possible ideas:

## Spatial voting

Users drop quick votes on ideas during collaborative sessions.

## Focus mode

Select a frame and temporarily isolate it.

## Follow collaborator

Temporarily follow another user's viewport.

## Presentation path

Create a sequence of frames to navigate through.

## Smart tidy

Deterministic auto-layout for selected cards.

No AI required.

## Spatial timeline

Arrange frames as stages with a lightweight timeline mode.

## Quick cluster

Select notes and group them spatially with a single action.

These can make the project feel like an original product instead of a clone.

---

# 60. What Not to Do

Avoid:

- immediately copying the Figma UI
- implementing 30 tools
- depending entirely on an off-the-shelf whiteboard library
- starting collaboration before interaction quality
- routing pointermove through large React rerenders
- storing viewport coordinates in every object
- using screen coordinates as document coordinates
- saving drag state on every frame
- making every operation a modal
- over-styling before the canvas feels good
- adding AI merely because it is fashionable

---

# 61. Coding Rules / Guardrails for the Codex Session

1. Build milestone-by-milestone.
2. Do not add future features early.
3. Keep world coordinates independent of the viewport.
4. Centralize coordinate conversion functions.
5. Use Pointer Events.
6. Use pointer capture for drag interactions.
7. Keep document state separate from UI/selection state.
8. Use transient drag/resize state and commit on completion.
9. One drag should equal one undo operation.
10. Do not rerender the whole board on every pointer event.
11. Keep interaction modes explicit.
12. Keep connectors data-driven and object-referenced.
13. Do not introduce collaboration until the single-user canvas is stable.
14. Keep presence separate from persistent document state.
15. Avoid premature abstraction.
16. Prefer readable TypeScript.
17. Write tests for viewport math and geometry helpers.
18. Regularly test mouse and trackpad behavior.
19. Test at different zoom levels.
20. Profile performance before introducing optimization complexity.

---

# 62. Definition of Single-User MVP Complete

The single-user MVP is complete when a user can:

1. Open the board.
2. Pan and zoom naturally.
3. Create notes/text.
4. Edit content inline.
5. Move and resize objects.
6. Multi-select.
7. Marquee select.
8. Copy/paste/duplicate.
9. Undo/redo.
10. Connect objects.
11. Create frames/groups.
12. Draw basic freehand strokes.
13. Save locally.
14. Reopen the board.

At that point:

**Stop adding single-user features.**

Use the product and test it.

Then add collaboration.

---

# 63. Definition of Collaborative MVP Complete

The collaborative MVP is complete when:

1. Two users can open the same board.
2. Changes synchronize reliably.
3. Both users see live cursors.
4. Remote selections are visible.
5. Simultaneous edits do not corrupt the document.
6. Object movement feels responsive.
7. Text changes reconcile safely.
8. Local undo does not erase unrelated remote work.
9. Reconnection works.
10. Presence clearly communicates what collaborators are doing.

At that point:

**Stop.**

Do not immediately turn it into a full productivity suite.

Polish the experience and document the case study.

---

# 64. Final Product Intent

This project should not be judged by the number of tools it contains.

The successful outcome is:

> A user opens a blank canvas, immediately understands how to move around, creates a few ideas, connects and organizes them naturally, then another person joins and both can work in the same space without the interface getting in the way.

That feeling of **spatial freedom + control + shared presence** is the core product.
