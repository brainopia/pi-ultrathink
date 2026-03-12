# pi-ultrathink — Agent Notes

## What this repository is
- `pi-ultrathink` is a Pi extension package that adds `/ultrathink <prompt>`.
- It turns one prompt into a visible multi-pass review loop driven by Git changes.
- User-facing usage lives in `README.md`.
- Design history lives in `execplan/ultrathink-review-loop.md`, but current `src/` code and tests are the source of truth if the plan and implementation diverge.

## Stack
- Node.js 20.6+
- TypeScript, ESM (`"type": "module"`)
- Vitest for tests
- Pi package manifest in `package.json` via `pi.extensions: ["./src/index.ts"]`
- No build output directory; the extension is run directly from TypeScript

## Key commands
- `npm install` — install dependencies
- `npm run check` — typecheck + full test suite
- `npm test` — run Vitest
- `npm run demo` — run the scripted SDK demo without real model credentials
- `pi -e ./src/index.ts` — load the extension locally in Pi

## Repository map
- `src/index.ts` — extension entry point; command registration, event wiring, run lifecycle
- `src/config.ts` — loads and validates `.pi/ultrathink.json`
- `src/git.ts` — repository checks, dirty-repo preflight, conditional commits, branch handling
- `src/review.ts` — default continuation prompt, review prompt assembly, answer digesting, stop decisions
- `src/state.ts` — active run creation and persisted custom session entries
- `src/ui.ts` — TUI prompt editor, status line, completion summary message
- `src/types.ts` — shared types for runtime and tests
- `test/support/fakePi.ts` — fake Pi extension harness for deterministic tests
- `test/support/gitTestUtils.ts` — temp git repo helpers and real `git` execution for tests
- `test/ultrathink-command-spike.spec.ts` — prompt shape + continuation template behavior
- `test/ultrathink-orchestration.spec.ts` — cancellation and loop-stop flow
- `test/ultrathink-git.spec.ts` — commit creation, unchanged-stop behavior, dirty repo handling
- `demo/fakeProvider.ts` — scripted fake provider/tooling for the SDK demo
- `demo/runDemo.ts` — end-to-end demo using the real extension in temp repos
- `execplan/ultrathink-review-loop.md` — design log / historical plan

## Runtime behavior and invariants
- Only one active Ultrathink run is tracked per session.
- Starting a new `/ultrathink` run cancels any currently active one.
- The initial task is sent as a normal visible user message via `pi.sendUserMessage(promptText)`.
- Follow-up review passes are also visible user messages, not hidden control messages.
- `Escape` cancels the active Ultrathink loop and aborts the current streaming turn when needed.
- If the user types another prompt during an active run, the loop stops with `cancelled-by-user`.
- Assistant replies for completed iterations are labeled `ultrathink:vN`.
- Minimal state is persisted as custom session entries of type `ultrathink-state`.
- Do not add tracked repo artifacts for run metadata; Git diffs should reflect project changes only.

## Git behavior
- Git is the main continuation signal.
- If an iteration leaves no repository changes, no commit is created and the run stops with `no-git-changes`.
- If an iteration changes the repo, the extension stages everything and creates a commit:
  - subject: `ultrathink(<runId>): vN`
  - body: assistant output for that iteration, truncated if needed
- `git.mode` supports:
  - `current-branch` — commit on the current branch
  - `scratch-branch` — create `ultrathink/<runId>` and commit there
  - `off` — disable commit creation entirely
- `git.allowDirty` defaults to `false`; in `current-branch` mode, the run refuses to use Git-backed tracking when the repo is already dirty.

## Config
Project-local config is read from `.pi/ultrathink.json`.

Current supported fields:
- `maxIterations`
- `continuationPromptTemplate`
- `commitBodyMaxChars`
- `git.mode`
- `git.allowDirty`

Defaults are defined in `src/config.ts`.

## Important implementation notes
- This is an ESM TypeScript project; keep local import specifiers using `.js` suffixes inside `.ts` files.
- There is no transpile step in normal development; `tsc` is used only for typechecking.
- The project intentionally keeps runtime dependencies minimal and relies mostly on Node built-ins plus Pi peer deps.
- The review loop is driven by `agent_end`, `input`, `session_start`, the `/ultrathink` command, and the `escape` shortcut.

## Known gotcha: ExecPlan vs shipped behavior
The ExecPlan contains notes about rendering placeholders like `{headSha}` and `{parentSha}` inside the continuation template. The shipped implementation does **not** currently expand these placeholders.

`buildReviewPrompt()` inserts the accepted template verbatim after the fixed task/diff header. This is intentional in the current codebase, and tests assert that literal tokens such as `{headSha}` remain unchanged.

When modifying continuation-template behavior, update:
- `src/review.ts`
- `src/index.ts`
- `README.md`
- `test/ultrathink-command-spike.spec.ts`

## Testing guidance
- Tests use real Git via temp repositories; a working `git` binary is required.
- If you change prompt wording, summary wording, or stop-reason text, expect test updates.
- If you change commit semantics or dirty-repo handling, run both:
  - `npm run check`
  - `npm run demo`

## Safe change checklist
For most non-trivial changes:
1. Update implementation in `src/`.
2. Update or add tests in `test/`.
3. Update `README.md` if user-visible behavior changed.
4. Re-run `npm run check`.
5. Run `npm run demo` when changing orchestration or Git behavior.
