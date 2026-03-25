# Ultrathink Review Design

Date: 2026-03-25

## Summary

This design adds a new `/ultrathink-review [optional prompt]` command for the case where work already exists in the current repository and the user wants Ultrathink to review and refine that work in multiple passes until another pass no longer changes the repository.

The new command keeps the existing git-backed scratch-branch execution model from `/ultrathink`. The main difference is the starting point: instead of starting from a new user task and showing the continuation-prompt editor, `/ultrathink-review` computes a review range from the repository’s current branch state, starts on a scratch branch, and immediately sends a visible review prompt.

## Goals

After this change, the user should be able to:

- run `/ultrathink-review` with no extra text and review all local branch changes since the last pushed point;
- run `/ultrathink-review <custom instructions>` to replace the default review body while still keeping the automatic injected review-range header;
- start from a dirty working tree, have Ultrathink create a bootstrap commit for those local changes on the scratch branch, and include that bootstrap commit in the review range;
- see a visible list of the commits being reviewed before the first review pass starts;
- keep using the same familiar scratch-branch reintegration behavior that `/ultrathink` already uses.

## Non-goals

This design does not add:

- a separate `/ultrathink-review-branch` command;
- a prompt editor for review mode;
- any new non-git review mode;
- placeholder expansion inside continuation prompts.

## User-facing behavior

### Command shape

The extension adds one command:

- `/ultrathink-review [optional prompt]`

If no prompt text is provided, the command uses the existing default continuation prompt body from `src/promptTemplate.ts`.

If prompt text is provided, it replaces the default review body. In both cases, the extension prepends a fixed English review header that tells the model to review changes starting from a computed git base.

### Start conditions

`/ultrathink-review` always runs in a git repository and always uses a scratch branch named `ultrathink/<ai-slug>`.

The command does not show the continuation prompt editor.

The command still relies on the existing naming model selection and persistence flow, because it may need AI-generated branch names and AI-generated commit messages, including a bootstrap commit for dirty changes.

### Review source resolution

The command resolves the review range in the following order.

#### Case 1: the repository has uncommitted changes

1. Prepare the scratch branch using the same scratch-branch creation workflow as `/ultrathink`.
2. Commit all dirty changes on the scratch branch as a bootstrap commit using an AI-generated subject and body.
3. Treat that bootstrap commit as the first reviewed commit.
4. Store the exclusive lower bound as the parent of the bootstrap commit so the review prompt can consistently use `git diff <exclusiveBaseSha> HEAD`.
5. Include the bootstrap commit in the visible “reviewed commits” list shown before the first review pass.

This means dirty changes are not rejected for `/ultrathink-review`. They are converted into the first reviewed commit on the scratch branch.

#### Case 2: the repository is clean

1. Resolve the current branch’s upstream.
2. If no upstream exists, fail with a clear message explaining that the current branch needs a tracking branch or push history.
3. If the current branch has local commits after its last pushed commit, use the last pushed commit as the exclusive lower bound, so all later commits are in scope.
4. If the branch has no pushed commits of its own but does have an upstream, find the first unique commit on the current branch relative to the upstream and use that commit’s parent as the exclusive lower bound.
5. If the resulting range contains no reviewable commits, report “nothing to review” and do not start the loop.

## Prompt behavior

### First prompt

The first visible user message sent to the main agent is a review prompt, not the original user command text.

The prompt is assembled from:

1. a fixed English header that states the review task and names the git range to inspect;
2. a git command based on the exclusive lower bound, using a consistent form such as `git diff <exclusiveBaseSha> HEAD`;
3. either the user-supplied prompt body or the default continuation prompt body.

The fixed header must remain in English even if the surrounding conversation is in another language.

### Later prompts

Later review passes continue to use the same git-mode loop that `/ultrathink` already uses: if the last pass created another repository change, Ultrathink commits it and queues another visible review prompt. The loop stops when a pass produces no repository changes or when `maxIterations` is reached.

## Visible start message

Before the first review prompt is sent, the extension emits a visible message that summarizes what will be reviewed.

The message should include:

- that this is an Ultrathink review run;
- the current branch and scratch branch;
- the review source (`dirty-bootstrap`, `last-pushed`, or `first-unique`);
- the first reviewed commit and the exclusive lower bound used for the diff command;
- the ordered list of commits being reviewed, printed as short SHA plus subject.

If dirty changes existed, this message is sent only after the bootstrap commit has been created, so the bootstrap commit appears in the list.

## Architecture

### Overall approach

The recommended implementation is to keep one shared git-mode loop and add a second git start strategy for review mode.

That means `/ultrathink` and `/ultrathink-review` should share:

- active-run lifecycle handling;
- `agent_end` iteration processing;
- per-iteration commit creation;
- stop-reason decisions;
- final reintegration and completion summary logic.

They should differ only in:

- how the run is initialized;
- whether the prompt editor is shown;
- how the review base is computed;
- whether a bootstrap commit is needed;
- how the first visible review prompt is constructed.

### `src/index.ts`

Add a new `/ultrathink-review` command and a `startReviewRun()` path.

This path should:

- finish any currently active run;
- wait for idle if needed;
- load config, git helpers, naming helpers, state helpers, and review helpers;
- skip the prompt editor entirely;
- ensure the naming model exists;
- create the scratch branch;
- resolve the review source and review commit list;
- create a bootstrap commit when the source is dirty changes;
- send the visible “reviewed commits” message;
- create the `ActiveRun` with git-mode review metadata;
- send the first visible review prompt.

The existing git `agent_end` loop should remain the shared engine for subsequent passes.

### `src/review.ts`

Extend prompt-building helpers so review-mode prompt assembly lives in `src/review.ts` instead of ad-hoc string building in `src/index.ts`.

The prompt builder needs to support at least two shapes:

- the current `/ultrathink` task-first prompt;
- the new `/ultrathink-review` review-first prompt with an English fixed header and a diff command based on an exclusive lower bound.

### `src/git.ts`

Add git helpers for:

- detecting whether the working tree is dirty without immediately rejecting the run;
- resolving the upstream branch for the current branch;
- resolving the last pushed commit for the current branch when one exists;
- resolving the first unique commit relative to the upstream when the branch has not been pushed;
- listing the commits that belong to the review range;
- creating the bootstrap commit for dirty changes;
- returning review range metadata in a shape that `src/index.ts` can use directly.

When resolving upstream references, always use the original branch name explicitly (e.g. `git rev-parse <originalBranch>@{u}`) rather than bare `@{u}` or `HEAD@{u}`, because after switching to the scratch branch, implicit upstream references would fail.

The existing `prepareScratchBranchRun()` currently rejects dirty trees. The design expects either a new helper or a parameterized version of that helper so `/ultrathink` can stay strict while `/ultrathink-review` can safely start from dirty state.

### `src/naming.ts`

Reuse the naming model for review bootstrap commits. The implementation may either:

- add a dedicated helper for a bootstrap commit message; or
- reuse the existing iteration-commit generator with a review-specific prompt text.

The important requirement is that bootstrap commits use AI-generated subject and body and remain distinguishable in code and tests as the seed of the review range rather than a normal iteration result.

### `src/types.ts` and `src/state.ts`

Keep `mode: "git"`, but distinguish normal task runs from review runs with additional metadata.

Recommended additions include:

- `gitRunKind: "task" | "review"`;
- `reviewSource: "dirty-bootstrap" | "last-pushed" | "first-unique"`;
- `reviewStartSha` for the first included commit;
- `reviewExclusiveBaseSha` for the lower bound used in injected diff commands;
- `reviewCommits` for the ordered reviewed commit list.

For review mode, set the existing `reviewBaseSha` field to the computed `reviewExclusiveBaseSha` value. This ensures that the existing `buildReviewPrompt()` calls in the `agent_end` handler produce correct diff commands for subsequent review passes without requiring changes to the shared git loop.

Persist the review metadata so summaries and future debugging remain understandable from session state alone.

### `src/ui.ts`

Keep the current plain-text summary style, but make review runs distinguishable from task runs.

At minimum:

- add a start message renderer or helper for the reviewed commit list;
- update the completion summary opening line so it can say “Ultrathink review run ... finished ...” when appropriate.

## Error handling

`/ultrathink-review` must fail early and visibly in these cases:

- not inside a git repository;
- current branch has no upstream when upstream information is needed;
- git history lookup fails for last-pushed or first-unique resolution;
- bootstrap commit creation fails for dirty changes;
- the resolved review range contains no commits to review.

After the run has started, the loop uses the existing git stop reasons and finalization behavior.

## Testing

The implementation should add or update tests for the following scenarios.

1. `/ultrathink-review` without arguments uses the default continuation prompt body and never opens the prompt editor.
2. `/ultrathink-review <text>` replaces the default body but still prepends the fixed English review header.
3. Dirty working tree review creates a scratch branch, creates a bootstrap commit, displays that bootstrap commit in the reviewed commit list, and uses the bootstrap commit’s parent as the exclusive diff base.
4. Clean branch with local commits after push resolves the last pushed commit correctly and reviews all later commits.
5. Clean branch with no pushed commits of its own but with an upstream resolves the first unique local commit correctly.
6. Clean branch with no reviewable commits reports “nothing to review” and does not start the loop.
7. Missing upstream fails clearly without creating a run.
8. Completion summaries and README examples clearly distinguish review mode from the original task mode.

## Documentation impact

`README.md` must be updated to document the new command, its starting-point rules, the fact that the injected review text is English, the reviewed-commit list shown at startup, and the special dirty-working-tree bootstrap behavior.

`AGENTS.md` must also be updated to document the new command, its review-mode behavior, and any new source files.

## Final decisions captured from brainstorming

- Only `/ultrathink-review` will be added. `/ultrathink-review-branch` is intentionally out of scope.
- The command always uses a scratch branch, not the current branch directly.
- Dirty changes are allowed only for review mode, and they are always converted into a bootstrap commit on the scratch branch.
- The bootstrap commit is included in the review range.
- The injected fixed review header is always in English.
- The user can omit the prompt text and get the default review body, or provide prompt text to replace that body.
- The command always shows the reviewed commit list before starting the first pass.
- If there is nothing to review, the run does not start.
- If upstream information is required but missing, the command fails with a clear error rather than guessing a base branch.
