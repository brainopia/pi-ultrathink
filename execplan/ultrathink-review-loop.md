# Build a Pi extension that runs `/ultrathink <prompt>` review loops with conditional git commits for changed iterations

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

## Purpose / Big Picture

After this change, a user will be able to type one command in Pi, `/ultrathink <prompt>`, confirm or edit the default continuation-prompt template in a Pi TUI overlay, and then let Pi run the prompt plus zero or more visible follow-up review turns. Each follow-up turn should happen only if the previous iteration produced real git changes. Pressing `Escape` must stop the active Ultrathink loop as well as abort the current streaming turn if one is in progress.

Git becomes both the checkpoint mechanism and the primary stop signal. After each iteration, the extension should inspect the repository. If the working tree changed during that iteration, the extension creates a commit named `v1`, `v2`, `v3`, and so on, then queues a visible review prompt that prepends the original task and a baseline git diff command before the accepted continuation template. If nothing changed in the repository for that iteration, the extension creates no commit and treats that iteration as the final one.

The user-visible proof must be concrete. In Pi, one `/ultrathink <prompt>` command should first show the editable continuation-template UI, then produce an initial visible user message, an initial assistant reply, and then zero or more visible review user messages and assistant replies. In a demo repository where the model changes files on each pass, `git log` should show iteration commits like `v1`, `v2`, and `v3`, followed by a final unchanged verification pass with no commit. Pressing `Escape` during the loop should stop any further automatic review prompts.

## Progress

- [x] (2026-03-12 12:10 UTC+8) Confirmed the repository currently contains only `README.md`, one existing ExecPlan file, and git metadata, so the implementation must scaffold the package from scratch.
- [x] (2026-03-12 12:10 UTC+8) Read the execplan skill instructions and the full `PLANS.md` methodology before revising this plan.
- [x] (2026-03-12 12:10 UTC+8) Read Pi documentation relevant to this feature: `docs/extensions.md`, `docs/sdk.md`, `docs/packages.md`, `docs/custom-provider.md`, `docs/session.md`, and extension examples for git checkpoints, hidden follow-up messages, and plan-mode orchestration.
- [x] (2026-03-12 12:10 UTC+8) Replaced the original generic-library plan with a Pi-extension-specific design that uses Pi lifecycle hooks and git iteration commits.
- [x] (2026-03-12 12:25 UTC+8) Re-reviewed the first Pi-specific plan and corrected two design problems: it depended on visible metadata trailers in assistant replies, and it assumed hidden review prompts that would have required context filtering.
- [x] (2026-03-12 12:45 UTC+8) Re-reviewed the plan again after the user changed requirements and identified a new simplification: the extension should be single-shot via `/ultrathink <prompt>`, review prompts should be visible ordinary user messages, tracked run artifacts should be removed, and commits should only be created when the repository actually changed.
- [x] (2026-03-12 15:57 UTC+8) Re-reviewed the single-shot `/ultrathink <prompt>` design and added explicit `Escape` cancellation so the user can stop the loop without typing another prompt.
- [x] (2026-03-12 16:28 UTC+8) Scaffolded the npm package, Pi package manifest, TypeScript config, Vitest config, `.gitignore`, and the source tree described below.
- [x] (2026-03-12 16:32 UTC+8) Built the Milestone 1 proof of concept: `/ultrathink <prompt>` launches a visible prompt, and `agent_end` queues exactly one visible follow-up review message.
- [x] (2026-03-12 16:36 UTC+8) Implemented persisted session state, git-driven stop logic, iteration labeling, summary UI, the editable continuation-prompt overlay, cancellation on overlapping user activity, and `Escape` interruption handling.
- [x] (2026-03-12 16:40 UTC+8) Implemented git repository checks, dirty-repo refusal, conditional iteration commits, and assistant-output commit bodies.
- [x] (2026-03-12 16:44 UTC+8) Added deterministic unit/integration tests plus an SDK demo with a fake provider and temporary git repositories.
- [x] (2026-03-12 16:45 UTC+8) Ran the validation sequence (`npm run check`, `npm run demo`) and recorded the observed output in this plan.

## Surprises & Discoveries

- Observation: The repository is effectively empty, so the plan must define both the extension architecture and the test harness instead of fitting into an existing package.
  Evidence: `find . -maxdepth 2 -type f` returned only `README.md`, `execplan/ultrathink-review-loop.md`, and `.git/*` metadata.

- Observation: Pi extensions cannot rewrite or replace a completed assistant message after it has streamed. They can only react after completion and queue more work.
  Evidence: `docs/extensions.md` documents `agent_end`, `turn_end`, `pi.sendMessage()`, and `pi.sendUserMessage()` for follow-up orchestration, but does not provide a hook that mutates a completed assistant message.

- Observation: `pi.sendUserMessage()` marks the resulting `input` event with `source === "extension"`, which gives the extension a reliable way to distinguish its own follow-up prompts from real user typing.
  Evidence: `docs/extensions.md` documents `input` event sources as `interactive`, `rpc`, and `extension` for messages sent through `sendUserMessage()`.

- Observation: Pi already binds `escape` to interrupt, and the extension context also exposes `ctx.abort()`, so `Escape` can be treated as both a stream abort and an Ultrathink-loop cancellation signal.
  Evidence: `docs/keybindings.md` documents `interrupt` with default key `escape`, and `docs/extensions.md` lists `ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages()` as control-flow helpers.

- Observation: If the extension writes tracked run artifacts into the repository, those files themselves would force git diffs and commits even when the model did not change project files.
  Evidence: The user explicitly changed the requirement: when the repository did not change, no commit should be created. Therefore tracked run artifacts must not be used to manufacture commit diffs.

- Observation: A git-driven stop rule changes the shape of successful demos: to show commits `v1`, `v2`, and `v3`, the run now needs one additional unchanged verification pass that produces no commit.
  Evidence: After switching the stop rule, `npm run demo` produced `v1`, `v2`, `v3`, then `iteration v4: no repository changes, no commit`, followed by `stop reason: no-git-changes`.

- Observation: The continuation prompt works best as an editable prompt body appended after a fixed header rather than as a full free-form follow-up message.
  Evidence: The implementation now stores the accepted template verbatim, `buildReviewPrompt()` prepends the original-task and git-diff header automatically, and `src/ui.ts` tells the user that Pi will prepend that fixed context.

## Decision Log

- Decision: Build the first version as a real Pi extension package, not a generic wrapper library.
  Rationale: The user explicitly asked for a Pi extension that intercepts normal Pi turns. Pi already provides the needed lifecycle hooks, visible or hidden follow-up messaging, git execution, commands, and packaging model.
  Date/Author: 2026-03-12 / Pi

- Decision: Trigger the feature only through `/ultrathink <prompt>` rather than a persistent on/off mode.
  Rationale: The user wants a single-shot workflow. A per-prompt command avoids background state that could unexpectedly affect later normal prompts.
  Date/Author: 2026-03-12 / Pi

- Decision: Use ordinary visible user messages for the automatic review prompts by calling `pi.sendUserMessage()` from the extension.
  Rationale: The user explicitly requested that the extension’s follow-up prompts look like normal user messages instead of hidden control messages.
  Date/Author: 2026-03-12 / Pi

- Decision: Pressing `Escape` during an active Ultrathink run must cancel the entire remaining loop, not only the currently streaming response.
  Rationale: The user explicitly requested that `Escape` stop the cycle. The extension should therefore register an `escape` shortcut that marks the run as cancelled and calls `ctx.abort()` when a turn is still streaming.
  Date/Author: 2026-03-12 / Pi
- Decision: Define loop completion by git behavior: if an iteration produces no repository changes, stop immediately; otherwise commit the changes and continue until the iteration cap or cancellation.
  Rationale: The new user requirement is that a no-change git iteration is the definitive signal that no substantial follow-up work remains. This is more aligned with code-review intent than repeated-text stabilization.
  Date/Author: 2026-03-12 / Pi

- Decision: Remove tracked run artifacts from the repository in v1.
  Rationale: The user explicitly said there is no need to save agent output into artifacts, and tracked artifacts would incorrectly force git diffs even when the project itself did not change.
  Date/Author: 2026-03-12 / Pi

- Decision: Create an iteration commit only when the repository changed during that iteration. Keep the iteration label tied to the review pass number even when some iterations produce no commit.
  Rationale: This preserves the user’s requested “v1 / v2 / v3” thinking-step semantics without fabricating commits for unchanged passes. For example, `v1` may have no commit, while `v2` may produce the first commit if the repository changed only on the second pass.
  Date/Author: 2026-03-12 / Pi

- Decision: Use the assistant output as the commit message body, with truncation to a safe size if needed.
  Rationale: The user explicitly suggested using the agent’s output as the commit description. A bounded body keeps commits readable and avoids impractically large commit messages.
  Date/Author: 2026-03-12 / Pi

- Decision: Keep intermediate review passes as separate visible user and assistant messages in v1.
  Rationale: Pi extension hooks can queue additional turns, but they cannot collapse multiple completed turns back into one final synthesized answer.
  Date/Author: 2026-03-12 / Pi

- Decision: Ask the user to confirm or edit the continuation prompt template up front in a Pi TUI overlay, then append that accepted text verbatim after a fixed original-task and git-diff header for each changed iteration.
  Rationale: The user explicitly asked for a visible editable prompt in the TUI, and the shipped implementation keeps the dynamic diff context in the fixed header while treating the editable body as plain text.
  Date/Author: 2026-03-12 / Pi

## Outcomes & Retrospective

The feature is now implemented end to end. The repository contains a working Pi extension package, deterministic tests, a fake-provider SDK demo, README usage instructions, and recorded validation evidence. `/ultrathink <prompt>` now opens an editable continuation-template overlay, creates visible follow-up review turns only after iterations that changed git state, labels assistant iterations as `ultrathink:vN`, persists minimal custom session state, creates git commits only when a pass changed the repository, and stops cleanly when an iteration produces no git changes, when the user cancels, when the iteration cap is reached, or when git setup fails.

## Context and Orientation

This repository now contains a complete first implementation of the feature. The key files are `src/index.ts` for the extension event wiring, `src/config.ts` for `.pi/ultrathink.json`, `src/review.ts` for review-prompt assembly and answer-digest metadata, `src/git.ts` for conditional commit behavior, `src/state.ts` for persisted custom entries, `src/ui.ts` for the editable TUI prompt overlay plus summary output, `test/support/fakePi.ts` plus `test/*.spec.ts` for deterministic tests, and `demo/fakeProvider.ts` plus `demo/runDemo.ts` for the credential-free SDK demo.

In this plan, a “Pi extension” means a TypeScript module that exports a default function receiving `ExtensionAPI` from `@mariozechner/pi-coding-agent`. Pi loads that module at runtime and lets it subscribe to lifecycle events such as `input`, `agent_end`, and `session_start`, and also lets it register slash commands and keyboard shortcuts. A “run” means the entire sequence launched by one `/ultrathink <prompt>` command: the initial prompt plus zero or more review prompts. An “iteration” means one assistant reply within that run. The initial reply is iteration `v1`, the first review reply is `v2`, the second review reply is `v3`, and so on. A “continuation prompt template” is the editable prompt body the user accepts at run start; the extension later appends that text verbatim after a fixed original-task and git-diff header to produce each real follow-up review prompt. A “conditional checkpoint commit” means a normal git commit created only if the repository changed during that iteration.

One active Ultrathink run per session is the required concurrency rule. If the user types another real prompt while a run is active, the extension must stop queuing further automatic review prompts and mark the run as cancelled by user activity. If the user presses `Escape`, the extension must stop the loop immediately and prevent any queued follow-up review prompt from being sent. If the user launches another `/ultrathink <prompt>` command, the extension should either reject it while the previous run is active or cancel the previous run first and then start the new one. The implementation must choose one behavior and document it consistently; this plan chooses cancellation of the older run before starting the newer one.

The implementation should create this repository layout:

- `package.json` with npm scripts, `keywords: ["pi-package"]`, peer dependencies for Pi packages, and a `pi` manifest that points to the extension entry.
- `tsconfig.json` and `vitest.config.ts` for local development and tests.
- `src/index.ts` as the extension entry point.
- `src/config.ts` for loading and validating configuration from `.pi/ultrathink.json` plus sane defaults.
- `src/types.ts` for shared types used across the extension and tests.
- `src/state.ts` for active-run state and persisted custom-entry snapshots.
- `src/review.ts` for review-prompt assembly, answer normalization, digest metadata, and stop decisions.
- `src/git.ts` for repo checks, change detection, conditional commit creation, optional scratch-branch handling, and commit-message formatting.
- `src/ui.ts` for small status and summary helpers.
- `demo/fakeProvider.ts` and `demo/runDemo.ts` for a credential-free SDK-based demonstration.
- `test/support/fakePi.ts` for deterministic extension-unit tests.
- `test/*.spec.ts` for orchestration, stop logic, git behavior, and end-to-end extension behavior.

The extension package should be runnable in two ways. First, Pi must be able to load it directly through the normal extension/package mechanism. Second, the repository must provide an SDK demo that loads the same extension into a programmatic Pi session so the behavior can be tested without a human and without real model credentials.

## Milestones

### Milestone 1: Prove that `/ultrathink <prompt>` can launch an automatic second pass

At the end of this milestone, the repository will build as a normal TypeScript package and contain the smallest useful spike of the feature: when the user runs `/ultrathink <prompt>`, the extension first asks the user to confirm or edit the continuation-template prompt, turns the command argument into a visible user prompt, waits for the assistant reply, and then queues exactly one visible follow-up review prompt after a changed git iteration. The proof will be a test or demo that shows the exact visible sequence: template prompt UI, one user prompt, one assistant reply, one follow-up user review prompt, and one review assistant reply.

This milestone exists because it de-risks the main unknown in the design: the exact runtime behavior of `agent_end` plus `pi.sendUserMessage(reviewPrompt, { deliverAs: "followUp" })` from inside an extension-driven loop.

### Milestone 2: Implement multi-pass run state, git-driven stop logic, editable continuation templates, and interruption handling
At the end of this milestone, one `/ultrathink <prompt>` run will support repeated review passes instead of just one extra turn. The run state will track accepted continuation-prompt templates, previous answer digests as metadata, iteration numbering, and cancellation when the user manually intervenes, presses `Escape`, or starts another Ultrathink run. The stop rule will be: if an iteration leaves the repository unchanged, stop immediately. The proof will be deterministic tests that feed scripted answer sequences such as “initial answer with repo change” and “follow-up answer with no repo change”, and observe the correct stop reason and iteration count.

### Milestone 3: Implement conditional git commits for changed iterations only

At the end of this milestone, each iteration will inspect the repository and create a commit only if the repository changed during that pass. The proof will be two complementary tests: one temporary git repository where every iteration changes files and creates `v1`, `v2`, `v3` commits, and one scenario where an unchanged iteration produces no commit.

### Milestone 4: Package, document, and validate the feature through Pi and the SDK

At the end of this milestone, a new user will be able to install or load the extension, run `/ultrathink <prompt>`, stop it with `Escape` if desired, inspect any commits that were created, and understand why some iterations may have no commit when the repository stayed unchanged. The proof will be a passing automated demo, updated README instructions, and recorded validation output in this plan.

## Plan of Work

Start by scaffolding the package as a Pi package rather than a loose script. In `package.json`, set the package name, add the `pi-package` keyword, declare peer dependencies on `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, and `@sinclair/typebox` with `"*"`, and add a `pi.extensions` entry pointing at `./src/index.ts`. Add development dependencies for TypeScript, Vitest, `tsx`, and `@types/node`.

Then define the configuration and run-state model. In `src/types.ts`, define the configuration shape, active-run shape, iteration record shape, and git mode options. In `src/config.ts`, load `.pi/ultrathink.json` from the project directory if it exists; otherwise use defaults. The default configuration should set `maxIterations` to a safe value such as `4`, include a default `continuationPromptTemplate`, set `git.mode` to `current-branch`, and default `allowDirty` to `false`.

Implement the command surface next. In `src/index.ts`, register a slash command `/ultrathink`. The command must require non-empty text after the command name. The handler should create a new active run object, cancel any older active run, persist a custom state entry that a run has started, and then call `pi.sendUserMessage(promptText)` so the first turn appears as an ordinary user message rather than as a hidden extension message.
Also register an `escape` shortcut. When no Ultrathink run is active, the shortcut should do nothing and let Pi’s normal interrupt behavior remain the only effect. When an Ultrathink run is active, the handler must mark the run as `cancelled-by-escape`, clear any pending automatic follow-up scheduling, and call `ctx.abort()` if the agent is currently streaming. This ensures that `Escape` stops both the current generation and the rest of the Ultrathink cycle.

Use the `input` event only for interruption detection, not for starting Ultrathink runs. If the extension sees a real user-originated prompt while an Ultrathink run is active and the prompt did not come from `sendUserMessage()` with `source === "extension"`, it must mark the current run as cancelled by user activity and stop scheduling further review turns.

Implement review-message generation in `src/review.ts`. Each automatic follow-up should be a normal visible user prompt, not a hidden control message. The prompt should prepend the original task, add a fixed instruction to review current repository changes with a git diff command (`git diff <baselineSha> HEAD` when the starting SHA is known, otherwise `git diff HEAD^ HEAD`), and then append the accepted continuation prompt template. The prompt must not ask for machine-readable metadata, confidence headers, or invisible control syntax in the assistant reply.

Implement stop decisions around git behavior. `normalizeAnswer()` should normalize line endings, trim trailing whitespace on each line, and strip leading or trailing blank lines. `computeAnswerDigest()` may still hash the normalized answer with SHA-256 for persisted metadata, but it no longer controls loop completion. The loop should stop immediately when an iteration produced no repository changes, otherwise continue until `maxIterations` is reached. Return explicit stop reasons such as `no-git-changes`, `max-iterations`, `git-error`, `cancelled-by-user`, and `cancelled-by-escape`.

Implement git handling in `src/git.ts`. Before the first commit attempt, verify whether the working directory is a git repository. In `current-branch` mode, refuse to create commits if `git status --porcelain` already contains unrelated changes and `allowDirty` is false. In `scratch-branch` mode, create and check out `ultrathink/<runId>` from the starting `HEAD` and record the original branch name for the final summary message. After each assistant reply, inspect the repository. If there is no diff relative to the current `HEAD`, return “no commit for this iteration”. If there is a diff, create a commit with a subject like `ultrathink(<runId>): v2` and a body containing the assistant output from that iteration, truncated to a configured limit if necessary.

Do not write tracked run artifacts into the repository. Instead, persist minimal run metadata in session custom entries using `pi.appendEntry()`. Each completed iteration should store at least the run identifier, iteration label, digest, whether a commit was created, the commit SHA if present, and the stop reason if the run ended. This keeps the session restart-friendly without polluting the git diff.

After each assistant iteration finishes, label the matching assistant entry. Use the final assistant entry from the just-completed prompt and call `pi.setLabel(entry.id, "ultrathink:vN")`. If a commit was created, include the commit SHA in the custom state entry for that iteration. The session transcript itself is the canonical place to inspect the textual evolution of the answer; git history is only for repository changes.

Add a small UI layer in `src/ui.ts`. In interactive mode, show a footer status like `🧠 ultrathink v2/3` while a run is active and clear it when the run ends. When the run stops, send one visible custom message summarizing the stop reason and any commits that were created. That summary should explicitly say when an iteration produced no commit because the repository did not change, and it should distinguish between normal completion, `Escape` cancellation, and user-message cancellation.

Build the test harness next. In `test/support/fakePi.ts`, implement a small fake `ExtensionAPI` that records registered handlers, sent user messages, appended custom entries, labels, and executed git commands. Use it for deterministic unit and integration tests of the extension logic without a live model. Separately, in `demo/fakeProvider.ts` and `demo/runDemo.ts`, create a Pi SDK demo using `createAgentSession()` plus a fake provider that emits scripted assistant messages. The demo must load the real extension entry, run inside a temporary git repository, and prove both the changed and unchanged iteration cases.

Update `README.md` last. Explain what the extension does, how to load it with `pi -e ./src/index.ts` or install it as a package, how to run `/ultrathink <prompt>`, how iteration numbering works, why some iterations may create no commit, and how to inspect both the session transcript and git history.

## Concrete Steps

All commands below assume the working directory is `/home/bot/projects/pi-ultrathink`.

1. Scaffold the package and development toolchain.

    npm init -y
    npm install -D typescript vitest tsx @types/node

   Then edit `package.json` to add the Pi package metadata, scripts, and peer dependency declarations described above.

2. Create the source, demo, and test directories.

    mkdir -p src demo test/support .pi

   Expected result: the repository now contains the directories needed by the extension, demo, and tests.

3. Create the initial build files.

    npx tsc --init --rootDir . --outDir dist --module esnext --moduleResolution bundler --target es2022 --resolveJsonModule true

   Then add `vitest.config.ts` and npm scripts such as `test`, `demo`, and `check`.

4. Implement the Milestone 1 spike first.

    npm test -- --run test/ultrathink-command-spike.spec.ts
   Expected result: the spike proves that `/ultrathink <prompt>` launches one initial visible user prompt, then exactly one automatic visible review prompt after `agent_end`, and the extension does not recursively create a fresh run from its own follow-up user message.

5. Implement the full extension, conditional commit logic, and tests.

    npm test

   Expected result: tests cover at least these scenarios: one revised pass then unchanged pass stop; unchanged-on-first-review stop; no-commit-on-unchanged-iteration; commit-created-on-changed-iteration; cancellation when the user starts another prompt; cancellation when the user presses `Escape`; and commit body derived from assistant output.

6. Run the SDK demo in a throwaway repository.

    npm run demo

   Expected transcript shape for the “changed each iteration” demo:

    > pi-ultrathink demo
    command: /ultrathink Fix the task and keep improving until stable
    iteration v1: commit created
    iteration v2: commit created
    iteration v3: commit created
    iteration v4: no repository changes, no commit
    stop reason: no-git-changes
    compare with: git log --oneline --decorate --graph

   Expected transcript shape for the “unchanged final iteration” scenario:

    > pi-ultrathink demo
    command: /ultrathink Fix the task and keep improving until stable
    iteration v1: commit created
    iteration v2: no repository changes, no commit
    stop reason: no-git-changes

7. Inspect the recorded git history manually.

    git log --oneline --decorate --graph --all
    git show --stat HEAD

   Expected result: iteration commits exist only for iterations that changed repository files, and the commit body includes assistant output from that iteration.

8. Verify Pi can load the extension directly.

    pi -e ./src/index.ts

   In the Pi session, run `/ultrathink <some prompt>` and confirm that the extension produces visible follow-up user prompts and assistant replies. Confirm that commits appear only for iterations that actually changed the repository.

## Validation and Acceptance

Validation is complete only if all of the following are true.
First, automated tests pass with no hidden prerequisites beyond Node.js, git, and npm. The test suite must prove that the extension can distinguish `/ultrathink`-initiated work from its own follow-up messages by using the `input` event source, and that the stop conditions are deterministic.

Second, an end-to-end demo built on `createAgentSession()` must run without a real provider API key. That demo must load the real extension entry, run a scripted conversation, and assert that one `/ultrathink <prompt>` command produced multiple automatic turns.

Third, pressing `Escape` during an active run must cancel the whole Ultrathink loop. If a response is currently streaming, that same key press must also abort the current generation so no further automatic review prompt is queued afterward.

Fourth, git behavior must be human-verifiable. In a scenario where every iteration changes files, `git log --oneline` must show `v1`, `v2`, `v3` commits in order. In a scenario where an iteration does not change the repository, that iteration must produce no commit at all.

Fifth, the commit body must be inspectable. Running `git show <sha>` on an Ultrathink commit must reveal assistant output from that iteration in the commit message body, unless the output exceeded the configured truncation limit, in which case the body must clearly indicate truncation.

Sixth, direct Pi usage must be documented and observable. A user following `README.md` must be able to load the extension with Pi, run `/ultrathink <prompt>`, understand why extra visible user prompts appear, and understand that `Escape` cancels the remaining loop.

## Idempotence and Recovery

The package scaffold, tests, and demo must be repeatable. Re-running `npm test`, `npm run demo`, and `npm run check` must not depend on stale state from earlier runs. The demo should create or reset its temporary repository on every execution.
The extension must be safe around git. In `current-branch` mode, it must inspect the repository before commit creation and refuse to create commits if unrelated changes already exist and `allowDirty` is false. In `scratch-branch` mode, it may leave the created branch in place when the run finishes or fails, because the branch itself is useful evidence for comparison.

If commit creation fails for an iteration, the extension must stop scheduling further review prompts, emit a visible summary message, and record `git-error` in its custom state entry. Because v1 no longer writes tracked artifacts, the session transcript and any commits that already exist are the debugging evidence.

If the user starts another prompt while a run is still active, the old run must stop cleanly and record `cancelled-by-user` in session state. If the user presses `Escape`, the run must stop cleanly and record `cancelled-by-escape`. If the user starts another `/ultrathink <prompt>`, the older run should be cancelled first and the new run should start from a clean iteration counter.
If Pi is reloaded or restarted mid-run, v1 does not need to auto-resume. It is enough to persist minimal run metadata in a custom session entry so a later contributor can inspect what happened.

## Artifacts and Notes

There are no tracked repository artifacts for v1. The observable evidence is the session transcript plus any commits that were actually created.

A healthy visible session flow should resemble this shape:

    user: <prompt from /ultrathink command>
    assistant: <initial answer>
    user: Original task:
          <prompt from /ultrathink command>

          Review the current repository changes with:
          `git diff <baselineSha> HEAD`

          Continue working only if ...
    assistant: <reviewed answer>
    user: Original task:
          <prompt from /ultrathink command>

          Review the current repository changes with:
          `git diff <baselineSha> HEAD`

          Continue working only if ...
    assistant: <final answer or no-substantial-changes reply>

A healthy commit log in a repository where each iteration changed files should resemble this shape:

    ultrathink(20260312T1245-demo): v1
    ultrathink(20260312T1245-demo): v2
    ultrathink(20260312T1245-demo): v3

A healthy commit body should resemble this shape:

    ultrathink(20260312T1245-demo): v2

    Assistant output for iteration v2:
    <assistant text here, truncated if very long>

A healthy custom session state entry should resemble this shape:

    {
      "runId": "20260312T1245-demo",
      "iteration": 2,
      "label": "v2",
      "answerDigest": "sha256:...",
      "commitCreated": true,
      "commitSha": "abc1234",
      "stopReason": null
    }

Observed validation output from `npm run check` on 2026-03-12 16:44 UTC+8:

    > pi-ultrathink@0.1.0 check
    > npm run typecheck && npm run test
    ...
    Test Files  3 passed (3)
    Tests  7 passed (7)

Observed validation output from `npm run demo` on 2026-03-12 16:47 UTC+8:

    > pi-ultrathink demo
    command: /ultrathink Fix the task and keep improving until stable
    iteration v1: commit created (370ac76)
    iteration v2: commit created (de67dab)
    iteration v3: commit created (caeaa9c)
    iteration v4: no repository changes, no commit
    stop reason: no-git-changes
    compare with: git log --oneline --decorate --graph
      * caeaa9c (HEAD -> main) ultrathink(20260312T164742-1fjz66): v3
      * de67dab ultrathink(20260312T164742-1fjz66): v2
      * 370ac76 ultrathink(20260312T164742-1fjz66): v1
      * 527c881 initial

    > pi-ultrathink demo
    command: /ultrathink Fix the task and keep improving until stable
    iteration v1: commit created (444d108)
    iteration v2: no repository changes, no commit
    stop reason: no-git-changes

## Interfaces and Dependencies

Use Node.js 20+, TypeScript, Vitest, and the Pi extension API. The package should rely on Node built-ins for hashing and any local text processing, and on Pi’s own `pi.exec()` for git commands during runtime. Avoid extra runtime dependencies unless a later milestone proves they are necessary.

In `src/types.ts`, define at least these shared shapes:

    export type GitMode = "current-branch" | "scratch-branch" | "off";

    export interface UltrathinkConfig {
      maxIterations: number;
      continuationPromptTemplate: string;
      commitBodyMaxChars?: number;
      git: {
        mode: GitMode;
        allowDirty: boolean;
      };
    }

    export type StopReason =
      | "no-git-changes"
      | "max-iterations"
      | "git-error"
      | "cancelled-by-user"
      | "cancelled-by-escape";
    export interface ActiveRun {
      runId: string;
      originalPromptText: string;
      iteration: number;
      maxIterations: number;
      continuationPromptTemplate: string;
      stableRepeats: number;
      previousDigest?: string;
      originalBranchName?: string;
      currentBranchName?: string;
      gitMode: GitMode;
      awaitingExtensionFollowUp: boolean;
      cancelRequested?: "user" | "escape";
      expectedPromptText?: string;
    }

    export interface IterationRecord {
      iteration: number;
      label: string;
      answerDigest: string;
      previousDigest?: string;
      stableRepeats: number;
      commitCreated: boolean;
      commitSha?: string;
      commitParentSha?: string;
      stopReason?: StopReason;
    }

In `src/index.ts`, export the default extension factory:

    export default function ultrathinkExtension(pi: ExtensionAPI): void

In `src/config.ts`, define:

    export async function loadUltrathinkConfig(cwd: string): Promise<UltrathinkConfig>

In `src/review.ts`, define:

    export function buildReviewPrompt(args: {
      template: string;
      originalPromptText: string;
      reviewBaseSha?: string;
    }): string

    export function normalizeAnswer(text: string): string

    export function computeAnswerDigest(text: string): string

    export function decideStop(args: {
      iteration: number;
      maxIterations: number;
      noGitChangesDetected: boolean;
    }): StopReason | null

In `src/git.ts`, define:

    export async function prepareGitRun(args: {
      cwd: string;
      runId: string;
      mode: GitMode;
      allowDirty: boolean;
    }): Promise<{ originalBranchName?: string; currentBranchName?: string; commitsEnabled: boolean }>

    export async function commitIterationIfChanged(args: {
      cwd: string;
      runId: string;
      iteration: number;
      assistantOutput: string;
      mode: GitMode;
      commitBodyMaxChars?: number;
    }): Promise<{ commitCreated: boolean; commitSha?: string; commitParentSha?: string }>

In `src/ui.ts`, define:

    export function setUltrathinkStatus(ctx: ExtensionContext, run?: ActiveRun): void

    export async function promptForContinuationTemplate(
      ctx: ExtensionCommandContext,
      defaultTemplate: string,
    ): Promise<string | null>

    export function sendCompletionMessage(pi: ExtensionAPI, args: {
      run: ActiveRun;
      stopReason: StopReason;
      iterations: IterationRecord[];
    }): void

Revision Note: 2026-03-12 12:10 UTC+8. Rewrote the original plan so it targets a real Pi extension package instead of a provider-agnostic standalone library.
Revision Note: 2026-03-12 12:25 UTC+8. Reviewed the first Pi-specific version and removed the visible metadata-trailer design and the hidden-message context-filtering requirement.

Revision Note: 2026-03-12 12:45 UTC+8. Updated the plan to match the new interaction model requested by the user: `/ultrathink <prompt>` launches a single run, automated review prompts are visible ordinary user messages, tracked repository artifacts are removed, and git commits are created only for iterations that actually changed repository files.

Revision Note: 2026-03-12 15:57 UTC+8. Added explicit `Escape` cancellation semantics so one key press cancels the active Ultrathink loop and aborts the current streaming turn when applicable.
Revision Note: 2026-03-12 16:45 UTC+8. Completed the implementation, updated the living sections to reflect the shipped package, added validation evidence from `npm run check` and `npm run demo`, and documented the final stop-reason precedence discovered during testing.
Revision Note: 2026-03-13 00:55 UTC+8. Revised the plan after changing the loop semantics: the stop rule is now git-driven (`no-git-changes`), and `/ultrathink` now begins with an editable continuation-prompt template overlay whose accepted text is appended verbatim after the fixed original-task and git-diff header for each follow-up cycle.