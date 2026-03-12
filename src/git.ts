import type { ExecOptions, ExecResult } from "@mariozechner/pi-coding-agent";
import type { CommitIterationResult, GitMode, GitSnapshot, PrepareGitRunResult } from "./types.js";

export type ExecLike = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export const NO_REPOSITORY_CHANGES_NOTE = "no repository changes, no commit";

async function runGit(exec: ExecLike, cwd: string, args: string[]): Promise<ExecResult> {
  const result = await exec("git", args, { cwd, timeout: 30_000 });
  return result;
}

async function runGitStrict(exec: ExecLike, cwd: string, args: string[]): Promise<ExecResult> {
  const result = await runGit(exec, cwd, args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown git error").trim()}`);
  }
  return result;
}

async function isGitRepository(exec: ExecLike, cwd: string): Promise<boolean> {
  const result = await runGit(exec, cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

async function getCurrentBranch(exec: ExecLike, cwd: string): Promise<string | undefined> {
  const branch = await runGitStrict(exec, cwd, ["branch", "--show-current"]);
  const value = branch.stdout.trim();
  if (value) return value;
  const detached = await runGitStrict(exec, cwd, ["rev-parse", "--short", "HEAD"]);
  const sha = detached.stdout.trim();
  return sha ? `detached-${sha}` : undefined;
}

async function getCommitParentSha(exec: ExecLike, cwd: string, ref = "HEAD"): Promise<string | undefined> {
  const result = await runGit(exec, cwd, ["rev-parse", "--short", `${ref}^`]);
  if (result.code !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

export async function captureGitSnapshot(exec: ExecLike, cwd: string): Promise<GitSnapshot> {
  if (!(await isGitRepository(exec, cwd))) {
    return { repoExists: false, head: null, status: "" };
  }

  const headResult = await runGit(exec, cwd, ["rev-parse", "HEAD"]);
  const statusResult = await runGitStrict(exec, cwd, ["status", "--porcelain", "--untracked-files=all"]);
  return {
    repoExists: true,
    head: headResult.code === 0 ? headResult.stdout.trim() : null,
    status: statusResult.stdout,
  };
}

function sanitizeBranchName(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function truncateCommitBody(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) {
    return text;
  }

  const truncated = text.slice(0, maxChars).trimEnd();
  return `${truncated}\n\n[truncated to ${maxChars} characters]`;
}

export async function prepareGitRun(args: {
  cwd: string;
  runId: string;
  mode: GitMode;
  allowDirty: boolean;
  exec: ExecLike;
}): Promise<PrepareGitRunResult> {
  if (args.mode === "off") {
    return { commitsEnabled: false };
  }

  if (!(await isGitRepository(args.exec, args.cwd))) {
    return { commitsEnabled: false };
  }

  const status = await runGitStrict(args.exec, args.cwd, ["status", "--porcelain", "--untracked-files=all"]);
  const currentBranch = await getCurrentBranch(args.exec, args.cwd);
  const dirty = status.stdout.trim().length > 0;

  if (!args.allowDirty && dirty) {
    return {
      commitsEnabled: false,
      failureReason: "the repository already had uncommitted changes before Ultrathink started",
      originalBranchName: currentBranch,
      currentBranchName: currentBranch,
      baseline: await captureGitSnapshot(args.exec, args.cwd),
    };
  }

  if (args.mode === "scratch-branch") {
    const scratchBranch = `ultrathink/${sanitizeBranchName(args.runId)}`;
    const checkoutResult = await runGit(args.exec, args.cwd, ["checkout", "-b", scratchBranch]);
    if (checkoutResult.code !== 0) {
      return {
        commitsEnabled: false,
        failureReason: `failed to create scratch branch ${scratchBranch}`,
        originalBranchName: currentBranch,
        currentBranchName: currentBranch,
        baseline: await captureGitSnapshot(args.exec, args.cwd),
      };
    }

    return {
      commitsEnabled: true,
      originalBranchName: currentBranch,
      currentBranchName: scratchBranch,
      baseline: await captureGitSnapshot(args.exec, args.cwd),
    };
  }

  return {
    commitsEnabled: true,
    originalBranchName: currentBranch,
    currentBranchName: currentBranch,
    baseline: await captureGitSnapshot(args.exec, args.cwd),
  };
}

export async function commitIterationIfChanged(args: {
  cwd: string;
  runId: string;
  iteration: number;
  assistantOutput: string;
  mode: GitMode;
  commitBodyMaxChars?: number;
  exec: ExecLike;
}): Promise<CommitIterationResult> {
  if (args.mode === "off") {
    return { commitCreated: false, noCommitReason: "git mode is off" };
  }

  if (!(await isGitRepository(args.exec, args.cwd))) {
    return { commitCreated: false, noCommitReason: "not a git repository" };
  }

  const status = await runGitStrict(args.exec, args.cwd, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.stdout.trim().length === 0) {
    return { commitCreated: false, noCommitReason: NO_REPOSITORY_CHANGES_NOTE };
  }

  await runGitStrict(args.exec, args.cwd, ["add", "-A"]);
  const subject = `ultrathink(${args.runId}): v${args.iteration}`;
  const body = truncateCommitBody(
    `Assistant output for iteration v${args.iteration}:\n${args.assistantOutput}`,
    args.commitBodyMaxChars,
  );

  await runGitStrict(args.exec, args.cwd, ["commit", "-m", subject, "-m", body]);
  const sha = await runGitStrict(args.exec, args.cwd, ["rev-parse", "--short", "HEAD"]);
  const parentSha = await getCommitParentSha(args.exec, args.cwd, "HEAD");
  return {
    commitCreated: true,
    commitSha: sha.stdout.trim(),
    commitParentSha: parentSha,
  };
}
