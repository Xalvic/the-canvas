# Scribble

Scribble is an infinite whiteboard for notes, text, drawings, images, frames, and
connectors. You can use it as a guest and keep a board on your device, or sign in
with Google to save pages online and work with other people.

## Try it locally

Install dependencies and start the web app:

```bash
npm install
npm run dev
```

Vite prints the local address. Guest drawing and local saving work without an
account. Online pages, Google sign-in, sharing, and collaboration also need the
API and PostgreSQL configured; follow the [local database guide](docs/postgresql.md),
[authentication guide](docs/authentication.md), and [project handover](docs/agent-handoff.md)
for that setup. Never put server credentials in frontend variables or commit them.

## Use the board

- Choose Select, Hand, Note, Text, Connect, Frame, or Pen from the tools. The
  shortcuts are `V`, `H`, `N`, `T`, `C`, `F`, and `P`.
- Drag the canvas to move around; use the zoom controls or `+`, `-`, and `0` to
  zoom in, zoom out, or reset.
- Select and move objects, edit text by double-clicking, and use `Ctrl`/`Cmd` +
  `Z` to undo. Notes, text, images, frames, and pen strokes can be edited on the
  board.
- Paste or drop supported image files onto the canvas. A guest image stays on
  that device. Cloud pages use explicit image uploads.
- Sign-in does not upload a guest board. Moving guest work to an account is an
  explicit user action.

## Pages and sharing

Google sign-in enables online pages. Owners can share a page with a reusable
link and choose viewer or editor access. Recipients must sign in with Google;
the link by itself does not grant anonymous access. Owners can stop a link from
the sharing settings. Existing invitation and role-based sharing is also
documented in [sharing and roles](docs/sharing.md).

## Project guides

- [Agent handover](docs/agent-handoff.md): current status, architecture, important
  rules, development workflow, validation, deployment state, and pointers to
  detailed guides.
- [Architecture](docs/architecture.md): editor state and a traced example.
- [Local persistence](docs/persistence.md): guest boards and local saves.
- [Google sign-in](docs/authentication.md), [collaboration](docs/collaboration.md),
  [cloud images](docs/cloud-images.md), and [sharing](docs/sharing.md).
- [Workspace redesign acceptance and release handoff](docs/ui-redesign-r7.md):
  the latest feature-specific status, evidence, migration notes, and remaining
  release work.

## Useful checks

```bash
npm test
npm run build
npm run test:e2e
```

The API also has focused checks: `npm run test:server`,
`npm run typecheck:server`, and `npm run build:server`. Database and integrated
browser tests require their configured services. See the agent handover before
running checks that touch PostgreSQL or other local services.
