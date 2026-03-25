# pi-ultrathink — Agent Notes

## What this repository is
- `pi-ultrathink` is a Pi extension package that adds `/ultrathink <prompt>`, `/ultrathink-review [optional prompt]`, and `/ultrathink-oracle <prompt>`.
- `/ultrathink` turns one prompt into a visible multi-pass review loop driven by Git changes.
- `/ultrathink-review` starts from existing branch work, computes a review range, and immediately sends a visible review prompt plus a reviewed-commit list.
- `/ultrathink-oracle` uses an AI oracle reviewer that evaluates the agent's work through bidirectional dialogue. Works without git.
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
- `src/config.ts` — loads and validates global `~/.pi/ultrathink.json`
- `src/git.ts` — repository checks, scratch-branch creation, conditional commits, and final reintegration
- `src/review.ts` — review prompt assembly, answer digesting, stop decisions
- `src/promptTemplate.ts` — shared default continuation prompt text
- `src/promptEditor.ts` — lazily loaded TUI prompt editor for the continuation template
- `src/naming.ts` — naming-model selection, branch-slug generation, and AI-authored commit/merge message generation
- `src/state.ts` — active run creation and persisted custom session entries
- `src/ui.ts` — lightweight status line and completion summary helpers
- `src/types.ts` — shared types for runtime and tests
- `src/oracle.ts` — oracle session creation, `oracle_accept` tool, send/receive, disposal
- `src/oracleSetupWidget.ts` — TUI overlay for oracle model/thinking/prompt selection
- `test/support/fakePi.ts` — fake Pi extension harness for deterministic tests
- `test/support/gitTestUtils.ts` — temp git repo helpers and real `git` execution for tests
- `test/support/globalConfigTestUtils.ts` — temp global-config override helpers for tests and demo
- `test/support/namingTestUtils.ts` — naming-model test helpers
- `test/ultrathink-command-spike.spec.ts` — prompt shape + continuation template behavior + naming-model persistence + review-mode startup prompt coverage
- `test/ultrathink-orchestration.spec.ts` — cancellation and loop-stop flow
- `test/ultrathink-git.spec.ts` — scratch-branch commits, reintegration, dirty repo handling, and `/ultrathink-review` range resolution
- `test/ultrathink-oracle.spec.ts` — oracle mode: config, UI, stop reasons, state management
- `demo/fakeProvider.ts` — scripted fake provider/tooling for the SDK demo
- `demo/runDemo.ts` — end-to-end demo using the real extension in temp repos
- `execplan/ultrathink-review-loop.md` — original design log / historical plan
- `execplan/ultrathink-ai-branch-merge-flow.md` — current branch-first design and implementation log
- `execplan/ultrathink-oracle-mode.md` — oracle mode design and implementation plan

## Runtime behavior and invariants
- Only one active Ultrathink run is tracked per session (git-based or oracle-based).
- Starting a new `/ultrathink`, `/ultrathink-review`, or `/ultrathink-oracle` run cancels any currently active one.
- `/ultrathink` sends the initial task as a normal visible user message via `pi.sendUserMessage(promptText)`.
- `/ultrathink-review` sends a visible custom start message listing the reviewed commits, then sends a visible English review prompt as the first user message.
- Follow-up review passes are also visible user messages, not hidden control messages.
- Pi's interrupt action cancels the active Ultrathink loop; the extension detects this via `stopReason === "aborted"` on the assistant message in the `agent_end` handler.
- If the user types another prompt during an active run, the loop stops with `cancelled-by-user`.
- Assistant replies for completed git-mode iterations are labeled `ultrathink:vN`.
- Assistant replies for oracle-mode iterations are labeled `ultrathink-oracle:vN`.
- Minimal state is persisted as custom session entries of type `ultrathink-state`.
- Do not add tracked repo artifacts for run metadata; Git diffs should reflect project changes only.

## Oracle behavior
- Oracle mode works without git — usable in any directory.
- The oracle is a separate in-process `AgentSession` created via `createAgentSession()` from the Pi SDK.
- The oracle has its own tools (read, bash, grep, find, ls) and can independently inspect the codebase.
- The oracle signals acceptance by calling a custom `oracle_accept` tool (no text parsing).
- Oracle feedback is sent to the main session as visible user messages.
- The oracle maintains full conversation context across rounds (persistent session).
- Stop reasons: `oracle-accepted` (oracle called oracle_accept), `oracle-max-rounds` (hit maxRounds without acceptance).

## Git behavior
- Git is the main continuation signal.
- Every `/ultrathink` run starts on a dedicated scratch branch named `ultrathink/<ai-slug>` and still requires a clean working tree.
- Every `/ultrathink-review` run also starts on a dedicated scratch branch named `ultrathink/<ai-slug>`, but it may bootstrap dirty working-tree changes into the first reviewed commit.
- Review-mode sources are `dirty-bootstrap`, `last-pushed`, and `first-unique`. The reviewed commit list is shown before the first pass.
- If an iteration leaves no repository changes, no commit is created and the run stops with `no-git-changes`.
- If an iteration changes the repo, the extension stages everything and creates a commit with AI-generated subject/body.
- Normal completion reintegrates work back into the original branch automatically:
  - 0 commits — delete the empty scratch branch
  - 1 commit — rebase the scratch branch and fast-forward the original branch
  - 2+ commits — create one final AI-authored merge commit on the original branch
- If reintegration conflicts, the scratch branch is preserved for manual resolution.

## Config
Global config is read from `~/.pi/ultrathink.json`.
Current supported fields:
- `maxIterations`
- `continuationPromptTemplate`
- `commitBodyMaxChars`
- `naming.provider`
- `naming.modelId`
- `oracle.provider`
- `oracle.modelId`
- `oracle.thinkingLevel`
- `oracle.systemPromptTemplate`
- `oracle.maxRounds`

## Important implementation notes
- This is an ESM TypeScript project; keep local import specifiers using `.js` suffixes inside `.ts` files.
- There is no transpile step in normal development; `tsc` is used only for typechecking.
- The project intentionally keeps runtime dependencies minimal and relies mostly on Node built-ins plus Pi peer deps.
- The review loop is driven by `agent_end`, `input`, `session_start`, and the `/ultrathink`, `/ultrathink-review`, and `/ultrathink-oracle` commands.

## Known gotcha: continuation-template behavior

- `/ultrathink` still prepends `Original task:` plus the diff command before the continuation body.
- `/ultrathink-review` prepends a fixed English review header plus `git diff <exclusiveBaseSha> HEAD` before the continuation body.
- The shipped implementation does **not** expand placeholders like `{headSha}` and `{parentSha}` inside the continuation body.
- `buildReviewPrompt()` inserts the accepted template verbatim after the fixed header. Tests assert that literal tokens such as `{headSha}` remain unchanged.

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
