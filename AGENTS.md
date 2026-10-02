# Repository Agent Guide

> IMPORTANT: Do not recursively read or scan the repository at session start. Search for task-relevant files first and open only what is necessary.

## Working Method

Use a minimal-context workflow:

```text
Understand task
↓
Search for relevant symbol / component / feature
↓
Open only matching files
↓
Follow directly relevant dependencies if needed
↓
Implement the smallest correct change
↓
Run targeted validation
```

Do not use this workflow:

```text
Read entire repository
↓
Understand all architecture
↓
Start task
```

- Prefer targeted searches (`rg`, `rg --files`) and narrow file reads. Do not dump large directories or broad file trees into context.
- Read neighboring modules, tests, types, and configuration only when they directly affect the task.
- Avoid unrelated refactors, cleanup, formatting churn, dependency changes, or generated-file updates.
- Follow existing conventions and make the smallest complete change that preserves current behavior outside the requested scope.

## Architecture and Interaction Rules

- This is a React + TypeScript + Vite application. Keep components, hooks, state, and types aligned with the existing local patterns.
- Treat the infinite canvas as a coordinate-system-sensitive feature. Keep world coordinates distinct from screen/viewport coordinates; make conversions explicit and account for pan and zoom.
- Preserve the intended ownership and semantics of selection state. Avoid duplicating selection state across components or introducing competing sources of truth.
- Keep high-frequency pointer paths lean. Avoid unnecessary React renders, allocations, persistence writes, or history entries during pointer move handling.
- Drag and resize state should remain transient while an interaction is active. Commit the durable state at the established boundary, normally when the interaction ends.
- Preserve undo/redo invariants. A user-visible action should produce the expected atomic history entry; transient frames must not flood history, and undo/redo replay must not create new entries.
- Maintain local-persistence compatibility. Treat stored data as potentially coming from older versions, preserve established keys and formats when possible, and add safe defaults or migrations for schema changes.
- When modifying canvas interactions, verify relevant combinations of selection, pan, zoom, drag, resize, persistence, and undo/redo rather than considering any one path in isolation.

## Git and Validation

- This repository is tracked with Git. When useful, prefer focused Git context over rereading large parts of the project:

```bash
git status
git diff
git diff --stat
git log --oneline -10
```

- Inspect the diff before finishing and ensure only task-relevant files changed.
- Run the narrowest useful checks first: targeted tests, type checking for affected code, or the relevant build/lint command. Expand validation only when risk or failures justify it.
- Do not discard, overwrite, or rewrite unrelated user changes. Do not create commits unless explicitly requested.
