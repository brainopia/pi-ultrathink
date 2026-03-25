import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getUltrathinkConfigPath } from "../src/config.js";
import ultrathinkExtension from "../src/index.js";
import { createFakePiEnvironment } from "./support/fakePi.js";
import {
  addRemote,
  createTempBareGitRepo,
  createTempGitRepo,
  execWithCwd,
  gitStdout,
  pushBranch,
  setBranchUpstream,
  writeRepoFile,
} from "./support/gitTestUtils.js";
import { installTempGlobalUltrathinkConfigPath } from "./support/globalConfigTestUtils.js";
import { installDeterministicNaming, resetDeterministicNaming } from "./support/namingTestUtils.js";

function assistant(text: string, stopReason = "stop") {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
  };
}

function user(text: string) {
  return {
    role: "user",
    content: text,
  };
}

async function createRepoWithTrackedMain(): Promise<string> {
  const cwd = await createTempGitRepo("ultrathink-review-spike-");
  const remote = await createTempBareGitRepo("ultrathink-review-spike-remote-");
  await addRemote(cwd, "origin", remote);
  await pushBranch(cwd, "origin", "main");
  return cwd;
}

describe("/ultrathink command spike", () => {
  let restoreGlobalConfigPath: (() => void) | undefined;

  beforeEach(async () => {
    restoreGlobalConfigPath = await installTempGlobalUltrathinkConfigPath();
    installDeterministicNaming();
  });
  afterEach(() => {
    restoreGlobalConfigPath?.();
    restoreGlobalConfigPath = undefined;
    resetDeterministicNaming();
  });

  it("selects and persists the naming model before the run starts", async () => {
    const cwd = await createTempGitRepo("ultrathink-spike-config-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Fix the bug");

    const config = JSON.parse(await readFile(getUltrathinkConfigPath(), "utf8")) as {
      naming?: { provider?: string; modelId?: string };
    };
    const currentBranch = (await gitStdout(cwd, ["branch", "--show-current"])).trim();

    expect(config.naming).toEqual({ provider: "test", modelId: "nano" });
    expect(currentBranch).toBe("ultrathink/deterministic-branch");
    expect(env.userMessages).toHaveLength(1);
    expect(env.userMessages[0]?.content).toBe("Fix the bug");
  });

  it("launches one initial visible prompt and one automatic visible review prompt based on git", async () => {
    const cwd = await createTempGitRepo("ultrathink-spike-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Fix the bug");

    expect(env.userMessages).toHaveLength(1);
    expect(env.userMessages[0]?.content).toBe("Fix the bug");
    expect((await gitStdout(cwd, ["branch", "--show-current"])).trim()).toBe("ultrathink/deterministic-branch");

    await writeRepoFile(cwd, "work.txt", "v1\n");
    env.setLeafAssistantEntry("assistant-1", "Initial answer");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Fix the bug"), assistant("Initial answer")],
    });

    expect(env.userMessages).toHaveLength(2);
    const reviewPrompt = String(env.userMessages[1]?.content);
    const baselineSha = (await gitStdout(cwd, ["rev-parse", "HEAD^"])).trim();
    expect(reviewPrompt).toContain("Original task:");
    expect(reviewPrompt).toContain("Fix the bug");
    expect(reviewPrompt).toContain(`git diff ${baselineSha} HEAD`);
    expect(reviewPrompt).toContain("Continue working only if you find a genuinely substantial reason");
    expect(reviewPrompt).not.toContain("Ultrathink");
    expect(env.customMessages).toHaveLength(0);
    expect(env.labels.get("assistant-1")).toBe("ultrathink:v1");
  });

  it("lets the user override the continuation prompt template before the run starts", async () => {
    const cwd = await createTempGitRepo("ultrathink-spike-custom-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    env.queueCustomUiResult("Continue only for serious correctness or reliability issues. Literal token: {headSha}.");
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Ship the fix");
    await writeRepoFile(cwd, "work.txt", "v1\n");
    env.setLeafAssistantEntry("assistant-1", "Initial answer");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Ship the fix"), assistant("Initial answer")],
    });
    const reviewPrompt = String(env.userMessages[1]?.content);
    const baselineSha = (await gitStdout(cwd, ["rev-parse", "HEAD^"])).trim();
    expect(reviewPrompt).toContain("Original task:");
    expect(reviewPrompt).toContain("Ship the fix");
    expect(reviewPrompt).toContain(`git diff ${baselineSha} HEAD`);
    expect(reviewPrompt).toContain("Continue only for serious correctness or reliability issues.");
    expect(reviewPrompt).toContain("Literal token: {headSha}.");
  });

  it("starts /ultrathink-review with an English review prompt and skips the prompt editor", async () => {
    const cwd = await createRepoWithTrackedMain();
    await writeRepoFile(cwd, "review.txt", "ready for review\n");
    await execWithCwd("git", ["add", "review.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "Add review target"], { cwd });

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    env.queueCustomUiResult("THIS SHOULD NOT APPEAR");
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "");

    const diffBase = (await gitStdout(cwd, ["rev-parse", "--short", "HEAD^"])).trim();
    const reviewPrompt = String(env.userMessages[0]?.content);
    const startMessage = env.customMessages[0]?.message.content ?? "";

    expect(env.ui.customResults).toHaveLength(1);
    expect(env.userMessages).toHaveLength(1);
    expect(reviewPrompt).toContain(`Review the repository changes starting from commit ${diffBase}.`);
    expect(reviewPrompt).toContain(`git diff ${diffBase} HEAD`);
    expect(reviewPrompt).toContain("Continue working only if you find a genuinely substantial reason");
    expect(reviewPrompt).not.toContain("THIS SHOULD NOT APPEAR");
    expect(reviewPrompt).not.toContain("Original task:");
    expect(startMessage).toContain("Ultrathink review run");
    expect(startMessage).toContain("Review source: last-pushed");
    expect(startMessage).toContain("Add review target");
  });

  it("uses custom /ultrathink-review instructions without removing the fixed English header", async () => {
    const cwd = await createRepoWithTrackedMain();
    await writeRepoFile(cwd, "review.txt", "v1\n");
    await execWithCwd("git", ["add", "review.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "Prepare review scope"], { cwd });

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "Look only for test coverage gaps.");

    const diffBase = (await gitStdout(cwd, ["rev-parse", "--short", "HEAD^"])).trim();
    const reviewPrompt = String(env.userMessages[0]?.content);

    expect(reviewPrompt).toContain(`Review the repository changes starting from commit ${diffBase}.`);
    expect(reviewPrompt).toContain(`git diff ${diffBase} HEAD`);
    expect(reviewPrompt).toContain("Look only for test coverage gaps.");
    expect(reviewPrompt).not.toContain("Continue working only if you find a genuinely substantial reason");
  });

  it("persists review-mode metadata when /ultrathink-review starts", async () => {
    const cwd = await createRepoWithTrackedMain();
    await execWithCwd("git", ["checkout", "-b", "feature/review-metadata"], { cwd });
    await setBranchUpstream(cwd, "origin/main");
    await writeRepoFile(cwd, "feature.txt", "feature work\n");
    await execWithCwd("git", ["add", "feature.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "Add feature branch work"], { cwd });

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "Check the feature branch.");

    const startEntry = env.appendedEntries[0]?.data as {
      gitRunKind?: string;
      reviewSource?: string;
      reviewStartSha?: string;
      reviewExclusiveBaseSha?: string;
      reviewCommits?: Array<{ sha: string; subject: string }>;
      promptText?: string;
    };

    expect(startEntry.gitRunKind).toBe("review");
    expect(startEntry.reviewSource).toBe("first-unique");
    expect(startEntry.reviewStartSha).toBeTruthy();
    expect(startEntry.reviewExclusiveBaseSha).toBeTruthy();
    expect(startEntry.reviewCommits?.[0]?.subject).toBe("Add feature branch work");
    expect(startEntry.promptText).toBe("Check the feature branch.");
  });
});
