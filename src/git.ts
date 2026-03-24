import type {
  CommitIterationResult,
  FinalizationResult,
  GitSnapshot,
  PendingCommitResult,
  PrepareScratchBranchRunResult,
} from "./types.js";
import type { ExecOptions, ExecResult } from "@mariozechner/pi-coding-agent";

export type ExecLike = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export const NO_REPOSITORY_CHANGES_NOTE = "no repository changes, no commit";
const DEFAULT_BRANCH_ATTEMPTS = 5;

async function runGit(exec: ExecLike, cwd: string, args: string[]): Promise<ExecResult> {
  return await exec("git", args, { cwd, timeout: 30_000 });
}

async function runGitStrict(exec: ExecLike, cwd: string, args: string[]): Promise<ExecResult> {
  const result = await runGit(exec, cwd, args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown git error").trim()}`);
  }
  return result;
}

async function readRelevantStatus(exec: ExecLike, cwd: string): Promise<string> {
  const result = await runGitStrict(exec, cwd, ["status", "--porcelain", "--untracked-files=all"]);
  return result.stdout;
}

async function isGitRepository(exec: ExecLike, cwd: string): Promise<boolean> {
  const result = await runGit(exec, cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

async function getCurrentBranchNameStrict(exec: ExecLike, cwd: string): Promise<string> {
  const result = await runGitStrict(exec, cwd, ["branch", "--show-current"]);
  const branch = result.stdout.trim();
  if (!branch) {
    throw new Error("Ultrathink requires starting from a named branch, not a detached HEAD.");
  }
  return branch;
}

async function getCommitParentSha(exec: ExecLike, cwd: string, ref = "HEAD"): Promise<string | undefined> {
  const result = await runGit(exec, cwd, ["rev-parse", "--short", `${ref}^`]);
  if (result.code !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

async function branchExists(exec: ExecLike, cwd: string, branchName: string): Promise<boolean> {
  const result = await runGit(exec, cwd, ["show-ref", "--verify", `refs/heads/${branchName}`]);
  return result.code === 0;
}

async function listLocalBranches(exec: ExecLike, cwd: string): Promise<string[]> {
  const result = await runGitStrict(exec, cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function truncateCommitBody(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) {
    return text;
  }

  const truncated = text.slice(0, maxChars).trimEnd();
  return `${truncated}\n\n[truncated to ${maxChars} characters]`;
}

export async function captureGitSnapshot(exec: ExecLike, cwd: string): Promise<GitSnapshot> {
  if (!(await isGitRepository(exec, cwd))) {
    return { repoExists: false, head: null, status: "" };
  }

  const headResult = await runGit(exec, cwd, ["rev-parse", "HEAD"]);
  const status = await readRelevantStatus(exec, cwd);
  return {
    repoExists: true,
    head: headResult.code === 0 ? headResult.stdout.trim() : null,
    status,
  };
}

export async function prepareScratchBranchRun(args: {
  cwd: string;
  exec: ExecLike;
  generateBranchSlug: (existingBranchNames: string[]) => Promise<string>;
  maxAttempts?: number;
}): Promise<PrepareScratchBranchRunResult> {
  if (!(await isGitRepository(args.exec, args.cwd))) {
    throw new Error("Ultrathink requires a git repository.");
  }

  const status = await readRelevantStatus(args.exec, args.cwd);
  if (status.trim().length > 0) {
    throw new Error("Ultrathink requires a clean git working tree before it starts.");
  }

  const originalBranchName = await getCurrentBranchNameStrict(args.exec, args.cwd);
  const originalHead = await runGitStrict(args.exec, args.cwd, ["rev-parse", "HEAD"]);
  const originalHeadSha = originalHead.stdout.trim();
  const existingBranchNames = await listLocalBranches(args.exec, args.cwd);
  const maxAttempts = args.maxAttempts ?? DEFAULT_BRANCH_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slug = (await args.generateBranchSlug(existingBranchNames)).trim();
    if (!slug) {
      continue;
    }

    const scratchBranchName = `ultrathink/${slug}`;
    if (await branchExists(args.exec, args.cwd, scratchBranchName)) {
      continue;
    }

    await runGitStrict(args.exec, args.cwd, ["checkout", "-b", scratchBranchName]);
    return {
      originalBranchName,
      originalHeadSha,
      scratchBranchName,
      baseline: await captureGitSnapshot(args.exec, args.cwd),
    };
  }

  throw new Error(`Ultrathink could not find a free scratch-branch name after ${maxAttempts} attempts.`);
}

export async function prepareIterationCommit(args: {
  cwd: string;
  exec: ExecLike;
  baselineHead?: string;
}): Promise<PendingCommitResult> {
  if (!(await isGitRepository(args.exec, args.cwd))) {
    return { readyToCommit: false, changedFiles: [], diffSummary: "", noCommitReason: "not a git repository" };
  }

  const status = await readRelevantStatus(args.exec, args.cwd);
  if (status.trim().length === 0) {
    // Working tree is clean — check if agent committed changes directly
    if (args.baselineHead) {
      const currentHead = await runGitStrict(args.exec, args.cwd, ["rev-parse", "HEAD"]);
      const currentHeadSha = currentHead.stdout.trim();
      if (currentHeadSha !== args.baselineHead) {
        // HEAD advanced: the agent committed changes directly
        const range = `${args.baselineHead}..HEAD`;
        const diffSummary = await runGitStrict(args.exec, args.cwd, ["diff", "--stat", "--find-renames", range]);
        const changedFiles = await runGitStrict(args.exec, args.cwd, ["diff", "--name-only", "--find-renames", range]);
        return {
          readyToCommit: false,
          agentCommitted: true,
          changedFiles: changedFiles.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          diffSummary: diffSummary.stdout.trim(),
        };
      }
    }
    return { readyToCommit: false, changedFiles: [], diffSummary: "", noCommitReason: NO_REPOSITORY_CHANGES_NOTE };
  }

  await runGitStrict(args.exec, args.cwd, ["add", "-A"]);
  const diffSummary = await runGitStrict(args.exec, args.cwd, ["diff", "--cached", "--stat", "--find-renames", "HEAD"]);
  const changedFiles = await runGitStrict(args.exec, args.cwd, ["diff", "--cached", "--name-only", "--find-renames", "HEAD"]);
  return {
    readyToCommit: true,
    changedFiles: changedFiles.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    diffSummary: diffSummary.stdout.trim(),
  };
}

export async function commitPreparedIteration(args: {
  cwd: string;
  subject: string;
  body: string;
  commitBodyMaxChars?: number;
  exec: ExecLike;
}): Promise<CommitIterationResult> {
  const subject = args.subject.trim();
  const body = truncateCommitBody(args.body.trim(), args.commitBodyMaxChars);
  if (!subject) {
    throw new Error("Ultrathink cannot create a commit with an empty subject.");
  }
  if (!body) {
    throw new Error("Ultrathink cannot create a commit with an empty body.");
  }

  await runGitStrict(args.exec, args.cwd, ["commit", "-m", subject, "-m", body]);
  const sha = await runGitStrict(args.exec, args.cwd, ["rev-parse", "--short", "HEAD"]);
  const parentSha = await getCommitParentSha(args.exec, args.cwd, "HEAD");
  return {
    commitCreated: true,
    commitSha: sha.stdout.trim(),
    commitParentSha: parentSha,
    commitSubject: subject,
    commitBody: body,
  };
}

export async function describeCommitRange(args: {
  cwd: string;
  exec: ExecLike;
  fromRef: string;
  toRef: string;
}): Promise<{ changedFiles: string[]; diffSummary: string }> {
  const range = `${args.fromRef}..${args.toRef}`;
  const diffSummary = await runGitStrict(args.exec, args.cwd, ["diff", "--stat", "--find-renames", range]);
  const changedFiles = await runGitStrict(args.exec, args.cwd, ["diff", "--name-only", "--find-renames", range]);

  return {
    changedFiles: changedFiles.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    diffSummary: diffSummary.stdout.trim(),
  };
}

async function checkoutBranch(exec: ExecLike, cwd: string, branchName: string): Promise<void> {
  await runGitStrict(exec, cwd, ["checkout", branchName]);
}

async function deleteBranch(exec: ExecLike, cwd: string, branchName: string): Promise<void> {
  await runGitStrict(exec, cwd, ["branch", "-d", branchName]);
}

export async function countCommitsBetween(args: {
  exec: ExecLike;
  cwd: string;
  fromRef: string;
  toRef: string;
}): Promise<number> {
  const result = await runGitStrict(args.exec, args.cwd, ["rev-list", "--count", `${args.fromRef}..${args.toRef}`]);
  return parseInt(result.stdout.trim(), 10);
}

export async function getHeadCommitInfo(args: {
  exec: ExecLike;
  cwd: string;
}): Promise<{ sha: string; parentSha?: string; subject: string; body: string }> {
  const sha = await runGitStrict(args.exec, args.cwd, ["rev-parse", "--short", "HEAD"]);
  const parentSha = await getCommitParentSha(args.exec, args.cwd, "HEAD");
  const subject = await runGitStrict(args.exec, args.cwd, ["log", "-1", "--format=%s"]);
  const body = await runGitStrict(args.exec, args.cwd, ["log", "-1", "--format=%b"]);
  return {
    sha: sha.stdout.trim(),
    parentSha,
    subject: subject.stdout.trim(),
    body: body.stdout.trim(),
  };
}

export async function finalizeScratchBranchRun(args: {
  cwd: string;
  exec: ExecLike;
  originalBranchName: string;
  scratchBranchName: string;
  mergeCommitMessage?: { subject: string; body: string };
  commitBodyMaxChars?: number;
}): Promise<FinalizationResult> {
  const commitCount = await countCommitsBetween({
    exec: args.exec,
    cwd: args.cwd,
    fromRef: args.originalBranchName,
    toRef: args.scratchBranchName,
  });

  if (commitCount === 0) {
    await checkoutBranch(args.exec, args.cwd, args.originalBranchName);
    await deleteBranch(args.exec, args.cwd, args.scratchBranchName);
    return {
      mode: "cleanup",
      success: true,
      scratchBranchDeleted: true,
    };
  }

  if (commitCount === 1) {
    const rebaseResult = await runGit(args.exec, args.cwd, ["rebase", args.originalBranchName]);
    if (rebaseResult.code !== 0) {
      await runGit(args.exec, args.cwd, ["rebase", "--abort"]);
      // Stay on scratch branch — do NOT checkout original
      return {
        mode: "preserved",
        success: false,
        scratchBranchDeleted: false,
        error: `git rebase ${args.originalBranchName} failed: ${(rebaseResult.stderr || rebaseResult.stdout).trim()}`,
      };
    }

    await checkoutBranch(args.exec, args.cwd, args.originalBranchName);
    const ffResult = await runGit(args.exec, args.cwd, ["merge", "--ff-only", args.scratchBranchName]);
    if (ffResult.code !== 0) {
      // Go back to scratch branch
      await runGit(args.exec, args.cwd, ["checkout", args.scratchBranchName]);
      return {
        mode: "preserved",
        success: false,
        scratchBranchDeleted: false,
        error: `git merge --ff-only ${args.scratchBranchName} failed: ${(ffResult.stderr || ffResult.stdout).trim()}`,
      };
    }

    await deleteBranch(args.exec, args.cwd, args.scratchBranchName);
    return {
      mode: "rebase-fast-forward",
      success: true,
      scratchBranchDeleted: true,
    };
  }

  if (!args.mergeCommitMessage) {
    throw new Error("Ultrathink needs a final merge commit message when reintegrating multiple scratch-branch commits.");
  }

  await checkoutBranch(args.exec, args.cwd, args.originalBranchName);
  const mergeResult = await runGit(args.exec, args.cwd, ["merge", "--no-ff", "--no-commit", args.scratchBranchName]);
  if (mergeResult.code !== 0) {
    await runGit(args.exec, args.cwd, ["merge", "--abort"]);
    // Go back to scratch branch
    await runGit(args.exec, args.cwd, ["checkout", args.scratchBranchName]);
    return {
      mode: "preserved",
      success: false,
      scratchBranchDeleted: false,
      error: `git merge ${args.scratchBranchName} failed: ${(mergeResult.stderr || mergeResult.stdout).trim()}`,
    };
  }

  const mergeBody = truncateCommitBody(args.mergeCommitMessage.body.trim(), args.commitBodyMaxChars);
  await runGitStrict(args.exec, args.cwd, ["commit", "-m", args.mergeCommitMessage.subject.trim(), "-m", mergeBody]);
  const mergeSha = await runGitStrict(args.exec, args.cwd, ["rev-parse", "--short", "HEAD"]);
  await deleteBranch(args.exec, args.cwd, args.scratchBranchName);
  return {
    mode: "merge-commit",
    success: true,
    scratchBranchDeleted: true,
    mergeCommitSha: mergeSha.stdout.trim(),
    mergeCommitSubject: args.mergeCommitMessage.subject.trim(),
    mergeCommitBody: mergeBody,
  };
}
