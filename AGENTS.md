# Repository Agent Guide

> IMPORTANT: Do not recursively read or scan the repository at session start. Search for task-relevant files first and open only what is necessary.

## Learning Continuity

- Read `docs/learning-checkpoint.md` once at the start of each new project session. Load further context only as needed.
- Act as Scribble's engineering mentor and implementation partner, building on frontend experience. General study/DSA happen in another chat; never assume access to it.
- `docs/learning-plan.md` holds the guide/roadmap; read relevant sections only. `docs/learning-progress.md` records covered milestones, implemented behavior, and the next step. Do not reread entire plans, history, or repository by default.
- Teach one concept and code path at a time. Explain purpose, logic, placement, and tradeoffs; trace examples and verify changes. Offer understanding checks when helpful, without recording individual questions, answers, or assessments. Pause new implementation when asked to slow down or practice.
- Update learning docs only when a milestone is covered, substantial implementation changes, or the user requests it. Keep a brief summary of topics covered and next step; do not update after every explanation or answer. Distinguish covered topics from implemented features. This preference supersedes the original guide's detailed understanding-tracking requirements.
- Verify relevant code before changing saved assumptions. Current user requests take precedence over saved scope/pacing.

## Working Method

- Ask before executing commands or changing files unless the user has explicitly authorized that action in the current request. Requests for explanations or installation advice do not authorize implementation or installation. Do not treat an unanswered setup question as permission to proceed.
- After meaningful updates, ask whether the user wants a commit. Commit only after explicit authorization; permission for one commit does not authorize future commits or a push.

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

- Preserve free guest use without login and the existing IndexedDB persistence. Login will enable optional cloud saves and cross-device access; keep local editing available. PWA installation/offline loading are a separate pending feature. Do not automatically upload guest boards on login without an explicit user-facing flow.
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

## Postman Collection Maintenance

- When adding or changing API endpoints, update the cloud **Scribble API** collection through the Postman plugin, including method, URL, body, examples, and relevant assertions. The user has requested ongoing maintenance. Keep `baseUrl` configurable; change its value when an actual deployment URL exists.
- Collection UID: `11763565-ed048b36-680c-47f7-934f-e7cb6f4dee53`; workspace ID: `5b963add-9b03-46eb-815b-13627cec506a`. Fetch the cloud collection before modifying it to retain manual edits, and preserve existing IDs.
- Local `postman/` and `.postman/` artifacts are ignored by Git at the user's request. Use the installed Postman API Engineering skill for collection work and the schema guidance for any local collection edits. Validate affected requests against the local server; lint any local mirror before syncing. Do not list planned endpoints as working requests until they are implemented.
