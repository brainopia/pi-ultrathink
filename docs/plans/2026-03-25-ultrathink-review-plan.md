# Implement `/ultrathink-review` for multi-pass review of existing branch changes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan has a companion design document at `docs/plans/2026-03-25-ultrathink-review-design.md`, but this ExecPlan is intentionally self-contained and must remain sufficient on its own.

## Purpose / Big Picture

After this change, a Pi user who already has work in the current repository will be able to run `/ultrathink-review` and ask Ultrathink to inspect and improve that existing work in several visible passes until another pass no longer changes the repository. The command will use the same scratch-branch safety model as `/ultrathink`, but it will start from a review range derived from the current branch state instead of from a fresh task prompt.

The behavior must be directly observable. In a git repository with local commits after the last push, `/ultrathink-review` should create a scratch branch, print a visible list of the commits being reviewed, send a visible English review prompt, and continue committing substantial fixes until the loop naturally stops. In a repository with dirty files, the command should first create a bootstrap commit for those dirty changes on the scratch branch, include that bootstrap commit in the reviewed commit list, and then review the resulting commit range. If there is nothing to review, the command should say so and avoid starting a run.

## Progress

- [x] (2026-03-25 18:05 UTC+8) Re-read the brainstorming skill, the execplan skill, and the full `PLANS.md` methodology before drafting this ExecPlan.
- [x] (2026-03-25 18:08 UTC+8) Inspected the current implementation in `src/index.ts`, `src/review.ts`, `src/git.ts`, `src/state.ts`, `src/types.ts`, `src/ui.ts`, `src/naming.ts`, `src/config.ts`, and the current test suite to confirm the shipped behavior today only exposes `/ultrathink` and `/ultrathink-oracle`, rejects dirty repositories at git-mode start, and assumes the git review prompt always begins with `Original task:`.
- [x] (2026-03-25 18:12 UTC+8) Captured the user-approved design in `docs/plans/2026-03-25-ultrathink-review-design.md`.
- [x] (2026-03-25 18:16 UTC+8) Drafted this ExecPlan so implementation can proceed later without needing the original chat context.
- [x] (2026-03-25 18:58 UTC+8) Implemented review-mode git range resolution in `src/git.ts`, including `prepareReviewRun()`, dirty bootstrap commits, last-pushed vs first-unique detection, reviewed-commit listing, and new git test helpers for upstream-backed repositories.
- [x] (2026-03-25 19:18 UTC+8) Added `/ultrathink-review`, review-mode prompt assembly, run metadata, start/summary UI, README updates, AGENTS updates, and expanded command-spike plus git integration coverage.
- [x] (2026-03-25 19:26 UTC+8) Ran `npm run check` successfully after the implementation changes.
- [x] (2026-03-25 19:27 UTC+8) Ran `npm run demo` successfully as a regression check for the shipped git loop behavior.
- [x] (2026-03-25 19:34 UTC+8) Fixed the dirty-bootstrap completion summary so bootstrap commits appear as scratch-branch commits in the final work log, then re-ran `npm run check` successfully.
- [x] (2026-03-25 19:41 UTC+8) Updated the ExecPlan interface notes to document the seeded scratch-commit metadata added for dirty-bootstrap review summaries.

## Surprises & Discoveries

- Observation: The current git start helper rejects any dirty working tree before a scratch branch is created.
  Evidence: `src/git.ts` `prepareScratchBranchRun()` calls `readRelevantStatus()` and throws `Ultrathink requires a clean git working tree before it starts.` when the status is non-empty.

- Observation: The current prompt builder only knows the task-first shape used by `/ultrathink`.
  Evidence: `src/review.ts` `buildReviewPrompt()` always begins with `Original task:` and uses `originalPromptText` plus `reviewBaseSha` to build the review instructions.

- Observation: The current run state does not distinguish between a normal git task run and a git review run.
  Evidence: `src/types.ts` `ActiveRun` has `mode: "git" | "oracle"` and git metadata such as `reviewBaseSha`, but no field that identifies a git sub-kind or stores the reviewed commit list.

- Observation: Existing tests already exercise scratch-branch git flows with real git repositories, which means the safest path is to extend those tests instead of inventing a separate fake git layer.
  Evidence: `test/ultrathink-git.spec.ts` and `test/ultrathink-command-spike.spec.ts` create temporary repositories through `test/support/gitTestUtils.ts` and assert actual branch, commit, and prompt behavior.

- Observation: Multi-commit review runs can include a bootstrap commit that is not present in `run.iterations`, so merge-commit naming cannot rely only on iteration records.
  Evidence: `/ultrathink-review` creates the dirty bootstrap commit before iteration `v1`, which means the original finalize path would have omitted that commit when generating the final merge-commit summary.

- Observation: Clean review-mode failures such as “nothing to review” or “missing upstream” are simplest and safest when the range is resolved before creating the scratch branch.
  Evidence: Implementing clean-range resolution first in `prepareReviewRun()` lets `/ultrathink-review` exit without ever creating `ultrathink/...` branches in the no-op and missing-upstream cases, which the new tests assert.

- Observation: The first `/ultrathink-review` implementation still omitted the bootstrap commit from the final “Scratch branch commits” section, even though the bootstrap commit was real work on the scratch branch.
  Evidence: The dirty-bootstrap path created and reintegrated the bootstrap commit correctly, but `src/ui.ts` originally derived scratch-branch commits only from `run.iterations`, which start after bootstrap creation.

## Decision Log

- Decision: Add only one new command, `/ultrathink-review`, and do not add `/ultrathink-review-branch`.
  Rationale: The user explicitly simplified the scope to one review command centered on the current branch’s post-push work.
  Date/Author: 2026-03-25 / Pi

- Decision: Keep `/ultrathink-review` inside the existing git scratch-branch model rather than running directly on the checked-out branch.
  Rationale: The user chose the safer branch-based behavior so review iterations can still be reintegrated or preserved using the existing Ultrathink workflow.
  Date/Author: 2026-03-25 / Pi

- Decision: Allow dirty repositories only for `/ultrathink-review`, and convert dirty changes into a bootstrap commit on the scratch branch before the first review pass starts.
  Rationale: The user wants to review already-created local work, including uncommitted files, while still preserving the branch-first safety model.
  Date/Author: 2026-03-25 / Pi

- Decision: Treat the bootstrap commit as part of the reviewed range.
  Rationale: The user explicitly said that in the dirty-changes case the created commit must be included in the reviewed commits.
  Date/Author: 2026-03-25 / Pi

- Decision: Compute and store an exclusive lower bound for the diff command, then always inject a consistent command of the form `git diff <exclusiveBaseSha> HEAD` in review mode.
  Rationale: This keeps prompt construction simple and makes it possible to include the first reviewed commit by storing the parent of that first commit instead of overloading `reviewBaseSha` with inconsistent inclusive semantics.
  Date/Author: 2026-03-25 / Pi

- Decision: The injected fixed review text for `/ultrathink-review` must always be in English.
  Rationale: The user called this out explicitly, even though the planning discussion happened in Russian.
  Date/Author: 2026-03-25 / Pi

- Decision: Show a visible start message listing the commits that will be reviewed before the first review prompt is sent.
  Rationale: The user wants to inspect the exact review scope up front, especially after dirty changes are turned into a bootstrap commit.
  Date/Author: 2026-03-25 / Pi

- Decision: When upstream information is required but missing, fail with a clear error rather than guessing a base branch.
  Rationale: The user explicitly chose the predictable and safe behavior over heuristic branch guessing.
  Date/Author: 2026-03-25 / Pi

- Decision: If there are no reviewable commits after range resolution, report that there is nothing to review and do not start the loop.
  Rationale: Running an empty review loop would waste a turn and hide the more useful fact that the current branch has no local work after the comparison point.
  Date/Author: 2026-03-25 / Pi

- Decision: Generate multi-commit merge messages from the actual scratch-branch commit log instead of from recorded iteration entries.
  Rationale: Review runs can seed the scratch branch with a bootstrap commit before iteration tracking begins, and merge summaries should include that commit too.
  Date/Author: 2026-03-25 / Pi

- Decision: Resolve clean `/ultrathink-review` ranges before creating the scratch branch.
  Rationale: This keeps missing-upstream and nothing-to-review exits simple, leaves the repository untouched in those cases, and still preserves the dirty-bootstrap branch-first behavior where it matters.
  Date/Author: 2026-03-25 / Pi

- Decision: Persist seeded scratch-branch commits in run metadata so review summaries can report bootstrap commits accurately.
  Rationale: Dirty review runs can create meaningful scratch-branch history before iteration `v1`, and the final summary should remain a truthful work log.
  Date/Author: 2026-03-25 / Pi

## Outcomes & Retrospective

The feature is implemented. A Pi user can now run `/ultrathink-review` inside a git repository that already contains local work, see a visible reviewed-commit list, receive a fixed English review prompt, and continue the same scratch-branch review loop until another pass no longer changes the repository.

The highest-risk part of the work was preserving the old `/ultrathink` cleanliness rule while making `/ultrathink-review` accept dirty trees. That split now lives in explicit startup paths: `/ultrathink` still uses the strict `prepareScratchBranchRun()` path, while `/ultrathink-review` uses `prepareReviewRun()` and bootstraps dirty changes into a first reviewed commit only for review mode.

A follow-up review pass also corrected the final summary for dirty-bootstrap runs. The implementation now persists seeded scratch-branch commit details so the bootstrap commit appears in the final “Scratch branch commits” section with its body text, not only in the reviewed-commit list.

## Context and Orientation

This repository is a Pi extension package written in TypeScript and loaded directly from source. The main extension entry point is `src/index.ts`. It registers `/ultrathink`, `/ultrathink-review`, and `/ultrathink-oracle`, tracks one active run, reacts to `input`, `session_start`, and `agent_end`, and sends visible user prompts back into Pi.

The git workflow lives mostly in `src/git.ts`. A “scratch branch” in this plan means the temporary branch named `ultrathink/<ai-slug>` where Ultrathink performs work before reintegration. `prepareScratchBranchRun()` still requires a clean repository for `/ultrathink`, while `prepareReviewRun()` handles review-mode startup by either resolving a clean review range or creating a dirty bootstrap commit on the scratch branch. `prepareIterationCommit()` stages and summarizes changes after each assistant turn. `commitPreparedIteration()` writes a commit using already-generated subject and body text. `finalizeScratchBranchRun()` handles zero-commit cleanup, one-commit rebase-plus-fast-forward, and multi-commit merge reintegration.

Prompt construction lives in `src/review.ts`. `buildReviewPrompt()` now supports both the existing task-first `/ultrathink` prompt and the review-first `/ultrathink-review` prompt that injects an English header plus `git diff <exclusiveBaseSha> HEAD`. The default continuation body itself lives in `src/promptTemplate.ts`.

Run state lives in `src/types.ts` and `src/state.ts`. `ActiveRun` now distinguishes normal git task runs from review runs with `gitRunKind`, `reviewSource`, `reviewStartSha`, `reviewExclusiveBaseSha`, and `reviewCommits`. It also carries `seedScratchCommits` so a dirty-bootstrap run can report the bootstrap commit accurately in the final scratch-branch summary. `state.ts` persists that metadata as custom session entries of type `ultrathink-state`.

The UI helpers live in `src/ui.ts`. They set the short status line, render the visible start-of-run reviewed-commit list for `/ultrathink-review`, and emit the plain-text completion summary that now distinguishes review runs from task runs.

Commit-message generation lives in `src/naming.ts`. The naming module already knows how to ensure a naming model is configured, create scratch-branch slugs, generate per-iteration commit messages, and generate final merge-commit messages. `/ultrathink-review` should reuse this layer so the bootstrap commit for dirty changes also receives an AI-authored subject and body.

The existing tests are important orientation for a future implementer. `test/ultrathink-command-spike.spec.ts` verifies visible prompt shape and prompt-template override behavior. `test/ultrathink-git.spec.ts` verifies scratch-branch creation, reintegration, dirty-repo refusal, branch-name collision retries, and direct agent commits. `test/ultrathink-orchestration.spec.ts` verifies cancellation and iteration-cap handling. `test/support/fakePi.ts` provides the fake Pi harness that records user messages, custom messages, labels, and notifications, while `test/support/gitTestUtils.ts` creates real temporary repositories backed by a real `git` binary.

A “last pushed commit” in this plan means the commit that represents the current branch’s pushed state relative to its tracking branch. A “first unique commit” means the earliest commit that belongs to the current branch after it diverged from its upstream; in practice that is the first commit reachable from `HEAD` that is not reachable from the upstream, and its parent becomes the exclusive lower bound for the review diff. A “bootstrap commit” means the synthetic first commit created only for `/ultrathink-review` when dirty files exist before the loop starts.

## Milestones

### Milestone 1: Add git helpers that can resolve a review range before the loop starts

At the end of this milestone, the repository will contain prescriptive git helpers for review-mode startup. Those helpers will be able to inspect the current branch, determine whether uncommitted changes exist, create the scratch branch without always rejecting dirty state, create a bootstrap commit when needed, resolve the current branch’s upstream, find the last pushed commit when available, find the first unique local commit when the branch has not been pushed, and list the commits that belong to the review range in chronological order.

This milestone matters because every later change depends on having one stable representation of review scope. The implementation should settle on a clear return type that includes the review source kind, the first included commit SHA, the exclusive lower-bound SHA, and the ordered list of reviewed commits with short SHA and subject. Acceptance is a focused set of tests proving all three start cases: dirty bootstrap, post-push local commits, and first-unique-with-upstream.

### Milestone 2: Add `/ultrathink-review` startup behavior and review-mode prompt building

At the end of this milestone, the extension will expose `/ultrathink-review [optional prompt]`. Starting this command will still ensure a naming model exists and still create a scratch branch, but it will skip the continuation prompt editor, resolve the review range, send a visible custom message listing the reviewed commits, and send a visible English review prompt instead of the current task-first prompt. If the user supplies custom prompt text, that text will replace the default continuation body while the fixed English review header remains injected above it.

This milestone is independently verifiable by command-spike tests that assert there is no prompt-editor interaction, that the first visible prompt is the review-mode prompt rather than the raw command text, that the prompt includes the English range-instruction header plus `git diff <exclusiveBaseSha> HEAD`, and that the visible custom message lists the reviewed commits before the first pass runs.

### Milestone 3: Extend run state, summaries, and README so review mode remains understandable after execution

At the end of this milestone, a review run will be distinguishable from a task run in state, summaries, and user-facing documentation. The active run and persisted state will record enough review metadata to explain what was reviewed, how the comparison point was chosen, and which commits seeded the run. The completion summary will clarify when a git run was a review run, and `README.md` will document the new command, its startup rules, the English injected header, the reviewed-commit list, and the special dirty-working-tree bootstrap behavior.

This milestone matters because `/ultrathink-review` changes the meaning of the initial prompt and the allowed repository start state. Acceptance is a passing README-oriented test update plus clear summary output visible in the fake Pi harness or a manual run.

### Milestone 4: Validate the end-to-end behavior with the existing test and demo workflow

At the end of this milestone, the implementation will be proven by the repository’s normal quality gates. `npm run check` must pass, and if the review startup logic changes demo-relevant behavior the implementer should also run `npm run demo` to ensure the extension still loads and the existing flows remain stable.

This milestone is independently verifiable because the project already has deterministic tests and a scripted demo harness. The review feature is done only when the new cases pass and the older `/ultrathink` and `/ultrathink-oracle` cases still pass unchanged.

## Plan of Work

Begin in `src/types.ts` and `src/state.ts` so the rest of the code has stable names for review-mode metadata. Keep the top-level run mode as `"git"`, because `/ultrathink-review` is still a git-mode run, but add explicit git-run subtype information such as `gitRunKind: "task" | "review"`. Add review-mode metadata that captures the review source kind (`dirty-bootstrap`, `last-pushed`, or `first-unique`), the first included commit SHA, the exclusive lower-bound SHA used by prompt injection, and the ordered list of reviewed commits. Extend the persisted start and stop entries so this information survives into summaries and future debugging. Avoid vague field names; a future novice should be able to tell which SHA is inclusive and which SHA is exclusive.

Next, reshape `src/git.ts` around an explicit review-start preparation path. The existing `prepareScratchBranchRun()` should stay available for `/ultrathink`, because normal task mode must continue refusing dirty repositories. Add either a new review-specific preparer or a parameterized helper that can create a scratch branch while allowing dirty state for review mode. After the scratch branch exists, implement helper functions that can inspect the current branch’s upstream, calculate the review source, and produce one canonical result object. For the dirty path, stage all changes and create a bootstrap commit with AI-generated subject and body, then store the parent of that bootstrap commit as the exclusive lower bound. For the clean path, use upstream data to identify either the last pushed commit or the first unique local commit, then compute the ordered reviewed-commit list. Keep these helpers strict: if upstream information is missing when needed, return a clear error instead of guessing `main` or `master`. When resolving upstream, always use the original branch name explicitly (e.g. `git rev-parse <originalBranch>@{u}`), because the scratch branch has no upstream configured and bare `@{u}` or `HEAD@{u}` would fail after the checkout.

Then update `src/naming.ts` and `src/index.ts` together. `src/naming.ts` already knows how to create iteration and merge commit messages. Reuse that path or add a thin bootstrap-specific wrapper so the dirty bootstrap commit gets a generated subject and body without duplicating JSON-completion logic. In `src/index.ts`, add the `/ultrathink-review` command and a `startReviewRun()` function. That function should mirror the lifecycle guards from `startRun()` and `startOracleRun()`—finish an active run first, wait for idle if needed, load config and naming state, and create a run id—but it must skip the prompt editor entirely. After it resolves the review range, it should send a visible custom message that lists the reviewed commits and then send the first visible review prompt. When no user-supplied prompt text is given, store a synthetic `originalPromptText` such as `"Review and improve the current branch changes"` so that subsequent continuation prompts built by `buildReviewPrompt()` remain coherent. The first prompt should be built through `src/review.ts`, not by hand-building strings inside `src/index.ts`. When creating the ActiveRun for review mode, set `reviewBaseSha` to the computed `reviewExclusiveBaseSha`. This ensures subsequent `buildReviewPrompt()` calls in the existing `agent_end` handler produce correct diff commands without modification. Store `reviewExclusiveBaseSha` additionally in the review metadata for summaries and debugging.

After that, expand `src/review.ts`, `src/ui.ts`, and the README. In `src/review.ts`, preserve the existing task-first prompt builder for `/ultrathink`, but add a review-mode prompt builder—or a parameterized version—that emits the English fixed header for `/ultrathink-review`. The command must always inject the review header and a `git diff <exclusiveBaseSha> HEAD` instruction, regardless of whether the user supplied custom prompt text. In `src/ui.ts`, add a helper for the start-of-run reviewed-commit list and make the completion summary identify review runs in plain language. In `README.md`, document the command syntax, the upstream requirement, the three review-source cases, the bootstrap commit behavior for dirty changes, the English injected review header, and the visible reviewed-commit list shown at startup.

Finish by extending the tests before running the full suite. Add command-spike tests for prompt shape and prompt-editor skipping, git integration tests for dirty bootstrap and commit-range resolution, and orchestration tests for nothing-to-review and missing-upstream failure paths. Re-run the existing `/ultrathink` tests to make sure the stricter dirty-tree behavior for normal task mode remains unchanged.

## Concrete Steps

All commands below assume the working directory is `/home/bot/projects/pi-ultrathink`.

1. Extend shared types and persisted run metadata for review mode.

    npm test -- --run test/ultrathink-command-spike.spec.ts test/ultrathink-orchestration.spec.ts

   Before editing, note the existing shape of `ActiveRun`, `UltrathinkStateEntry`, and persisted start/stop entries. After editing `src/types.ts` and `src/state.ts`, update or add focused tests that assert review-mode state carries the inclusive and exclusive review-range SHAs clearly.

2. Add git review-start helpers.

    npm test -- --run test/ultrathink-git.spec.ts

   Implement new helpers in `src/git.ts` for review start. Expected new tests should prove: dirty changes become a bootstrap commit on the scratch branch; the bootstrap commit appears in the reviewed-commit list; a branch with local commits after its last push uses the last pushed commit as the exclusive lower bound; a branch with an upstream but no push history uses the first unique local commit; and a branch with no reviewable commits returns a visible no-op result instead of starting the loop.

3. Add `/ultrathink-review` startup and review prompt assembly.

    npm test -- --run test/ultrathink-command-spike.spec.ts test/ultrathink-git.spec.ts

   Implement the new command in `src/index.ts` and the review-mode prompt helper in `src/review.ts`. Expected results: the prompt editor is never used for `/ultrathink-review`; the first visible prompt is an English review prompt with `git diff <exclusiveBaseSha> HEAD`; custom prompt text replaces the default body but not the fixed header; and the extension sends a visible start message listing reviewed commits before the first review turn.

4. Update summaries, README, and state-driven messaging.

    npm test -- --run test/ultrathink-orchestration.spec.ts test/ultrathink-command-spike.spec.ts

   Update `src/ui.ts` and `README.md`. Expected results: the summary for review runs identifies them as review runs; the README documents the new command and its review-source rules; and the visible reviewed-commit list is understandable in plain text. Update `AGENTS.md` to document `/ultrathink-review`, its review-mode behavior, the dirty-bootstrap semantics, any new metadata fields, and any new source files added during implementation.

5. Run the full project checks.

    npm run check

   Expected result: TypeScript passes, the full Vitest suite passes, and the newly added review-mode scenarios do not regress the existing `/ultrathink` and `/ultrathink-oracle` behavior.

6. If any orchestration or git-flow output changed materially, run the scripted demo as a regression check.

    npm run demo

   Expected result: the demo still completes without real model credentials and the previously shipped branch-first and oracle behaviors remain intact.

7. Perform one manual smoke test in Pi.

    pi -e ./src/index.ts

   In the Pi session, open a git repository with either local commits after push or dirty files. Run `/ultrathink-review` and confirm that the extension first shows a reviewed-commit list, then sends an English review prompt, then continues the same visible git-backed loop used by `/ultrathink`.

## Validation and Acceptance

Validation is complete only when all of the following are true.

First, `/ultrathink-review` starts only in a real git repository, and it still uses a scratch branch. Starting in a non-git directory must fail visibly. Starting in a clean branch with no upstream when upstream data is required must fail visibly and must not guess a base branch.

Second, dirty repositories behave differently for review mode than for task mode, and that split is observable. `/ultrathink` must still refuse dirty repositories. `/ultrathink-review` must instead create a bootstrap commit on the scratch branch, and that bootstrap commit must appear in the visible reviewed-commit list and be included in the first review range.

Third, clean review ranges must be computed correctly. If the current branch has local commits after the last push, the prompt must review all changes after the last pushed commit. If the branch has no pushed commits of its own but does have an upstream, the prompt must review from the first unique local commit onward. If no commits are reviewable, the command must report that there is nothing to review and must not start the loop.

Fourth, the startup prompt must match the approved UX. The command must not show the continuation prompt editor. The first visible user message sent to the model must be the review-mode prompt, not the raw slash-command argument. The fixed injected header must be in English. The prompt must include `git diff <exclusiveBaseSha> HEAD`. If the user passed custom prompt text, that text must replace the default continuation body but must not remove the fixed review header.

Fifth, the start-of-run visibility requirement must be met. Before the first review pass begins, the extension must send a visible message listing the commits being reviewed, including the bootstrap commit when dirty changes were present.

Sixth, the rest of the git loop must remain intact. Once review mode has started, later iterations must still create ordinary Ultrathink iteration commits when the agent changes the repository, stop on `no-git-changes` or `max-iterations`, and reintegrate the scratch branch using the same zero-commit, one-commit, and multi-commit logic that ordinary `/ultrathink` uses today.

Seventh, the README and summary output must make the feature understandable without reading source code. A user should be able to discover from `README.md` what `/ultrathink-review` does, how the base range is chosen, and why dirty changes are allowed in this one mode. A completed review run’s summary should say it was a review run and should remain readable as plain text.

## Idempotence and Recovery

The implementation should be safe to re-run in both code and tests. All automated tests use fresh temporary repositories, so repeatedly running the suite should not depend on or damage prior scratch branches.

Be careful when changing `src/git.ts`, because the project now needs two different start behaviors: one command that still refuses dirty repositories and one command that must accept them by creating a bootstrap commit after switching to the scratch branch. The safest recovery strategy is to keep `/ultrathink` on the existing strict path and introduce a separate review-specific startup helper rather than weakening the old behavior globally.

Bootstrap commit creation must be explicit and reversible through git history. If bootstrap commit creation fails after the scratch branch is created, the extension should leave the repository in a comprehensible state, surface the error clearly, and preserve the scratch branch as a recovery point rather than silently resetting the work. Likewise, if review-mode range resolution fails after switching branches, the code should avoid deleting commits or discarding user changes.

Prompt building should also be idempotent. Re-running the same command in the same repository state should produce the same reviewed-commit list and the same exclusive diff base, modulo AI-generated branch names and commit messages. Tests should assert stable structural behavior rather than overfitting to incidental wording.

## Artifacts and Notes

The key artifact for this feature is the visible reviewed-commit list sent before the first prompt. A good plain-text shape is:

    Ultrathink review run 20260325T... will inspect commits on ultrathink/review-branch.
    Review source: last-pushed
    First reviewed commit: ab12cd3 Add API timeout handling
    Diff base: 9f8e7d6
    Reviewed commits:
    - ab12cd3 Add API timeout handling
    - de34fa1 Tighten retry conditions

In the dirty bootstrap case, the list should include the synthetic commit created on the scratch branch, for example:

    Ultrathink review run 20260325T... will inspect commits on ultrathink/review-branch.
    Review source: dirty-bootstrap
    First reviewed commit: 11aa22b Capture current local edits
    Diff base: 44cc55d
    Reviewed commits:
    - 11aa22b Capture current local edits

The first review prompt should then clearly instruct the model in English, for example in this structural shape:

    Review the repository changes starting from commit 44cc55d.
    Inspect them with:
    `git diff 44cc55d HEAD`

    Continue working only if you find a genuinely substantial reason ...

The exact wording may evolve, but the fixed header must stay English and the git command must use the exclusive lower bound, not an ambiguous inclusive SHA.

## Interfaces and Dependencies

In `src/types.ts`, define stable review-mode metadata rather than reusing vague optional strings. The exact names may differ, but the codebase should end this work with types equivalent in meaning to:

    type GitRunKind = "task" | "review";
    type ReviewSource = "dirty-bootstrap" | "last-pushed" | "first-unique";

    interface ReviewCommitSummary {
      sha: string;
      subject: string;
    }

    interface ActiveRun {
      mode: "git" | "oracle";
      gitRunKind?: GitRunKind;
      reviewSource?: ReviewSource;
      reviewStartSha?: string;
      reviewExclusiveBaseSha?: string;
      reviewCommits?: ReviewCommitSummary[];
      seedScratchCommits?: Array<{ sha: string; subject: string; body: string }>;
      ...existing fields...
    }

In `src/git.ts`, add a review-start helper that returns a single self-describing result object instead of scattered tuples. The implementation should end with an interface equivalent in meaning to:

    interface PrepareReviewRunResult {
      originalBranchName: string;
      originalHeadSha: string;
      scratchBranchName: string;
      reviewSource: "dirty-bootstrap" | "last-pushed" | "first-unique";
      reviewStartSha: string;
      reviewExclusiveBaseSha: string;
      reviewCommits: Array<{ sha: string; subject: string }>;
      seedScratchCommits?: Array<{ sha: string; subject: string; body: string }>;
      baseline: GitSnapshot;
    }

The exact file layout is flexible, but `src/index.ts` should consume this object directly when creating the active run and when rendering the visible reviewed-commit list.

In `src/review.ts`, add a dedicated helper or a parameterized extension of `buildReviewPrompt()` that supports review-mode prompt assembly. The resulting interface should be explicit about prompt kind and exclusive diff base. Do not rely on the caller to concatenate English header strings manually in `src/index.ts`; keeping prompt assembly centralized will make tests and future wording changes safer.

In `src/naming.ts`, either reuse `generateIterationCommitMessage()` for bootstrap commits or add a small wrapper with review-specific prompt wording. Do not duplicate the lower-level JSON-completion parsing, model resolution, or normalization logic. The bootstrap commit wrapper should provide a meaningful description of the staged dirty changes (e.g. file list and diff summary) in place of the `assistantOutput` parameter, since no assistant has responded yet at bootstrap time.

In `README.md`, add one new documented command and keep the rest of the public contract stable. Do not change `/ultrathink-oracle` behavior as part of this feature.

Plan revision note: updated again on 2026-03-25 after a follow-up review of the implementation. This revision records the dirty-bootstrap summary fix, the additional metadata needed to surface seeded scratch-branch commits accurately, the matching interface updates in the living plan, and the repeated successful `npm run check` validation after that correction.