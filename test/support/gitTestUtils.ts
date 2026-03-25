import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExecOptions, ExecResult } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);

export async function execWithCwd(
  command: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options?.cwd,
      timeout: options?.timeout,
      signal: options?.signal,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
      killed: false,
    } as ExecResult;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message,
      code: typeof execError.code === "number" ? execError.code : 1,
      killed: execError.killed ?? false,
    } as ExecResult;
  }
}

export async function createTempGitRepo(prefix = "ultrathink-test-"): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), prefix));
  await execWithCwd("git", ["init"], { cwd });
  await execWithCwd("git", ["config", "user.name", "Ultrathink Test"], { cwd });
  await execWithCwd("git", ["config", "user.email", "ultrathink@example.com"], { cwd });
  await writeRepoFile(cwd, "README.md", "# temp repo\n");
  await execWithCwd("git", ["add", "README.md"], { cwd });
  await execWithCwd("git", ["commit", "-m", "initial"], { cwd });
  return cwd;
}

export async function createTempBareGitRepo(prefix = "ultrathink-remote-"): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), prefix));
  await execWithCwd("git", ["init", "--bare"], { cwd });
  return cwd;
}

export async function addRemote(cwd: string, name: string, remotePath: string): Promise<void> {
  const result = await execWithCwd("git", ["remote", "add", name, remotePath], { cwd });
  if (result.code !== 0) {
    throw new Error(`git remote add ${name} ${remotePath} failed: ${result.stderr || result.stdout}`);
  }
}

export async function pushBranch(cwd: string, remoteName: string, branchName: string, setUpstream = true): Promise<void> {
  const args = setUpstream
    ? ["push", "-u", remoteName, `${branchName}:${branchName}`]
    : ["push", remoteName, `${branchName}:${branchName}`];
  const result = await execWithCwd("git", args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

export async function setBranchUpstream(cwd: string, upstreamRef: string, branchName?: string): Promise<void> {
  const args = branchName
    ? ["branch", "--set-upstream-to", upstreamRef, branchName]
    : ["branch", "--set-upstream-to", upstreamRef];
  const result = await execWithCwd("git", args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

export async function writeRepoFile(cwd: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(cwd, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

export async function gitStdout(cwd: string, args: string[]): Promise<string> {
  const result = await execWithCwd("git", args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}
