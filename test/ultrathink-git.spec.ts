import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ultrathinkExtension from "../src/index.js";
import { createFakePiEnvironment } from "./support/fakePi.js";
import { createTempGitRepo, execWithCwd, gitStdout, writeRepoFile } from "./support/gitTestUtils.js";
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

describe("Ultrathink git integration", () => {
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

  it("creates iteration commits on the scratch branch and finishes with a descriptive merge commit", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-changed-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Improve the project");

    await writeRepoFile(cwd, "work.txt", "v1\n");
    env.setLeafAssistantEntry("assistant-1", "Answer one");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Improve the project"), assistant("Answer one")],
    });

    const reviewPrompt1 = String(env.userMessages[1]?.content);
    await writeRepoFile(cwd, "work.txt", "v2\n");
    env.setLeafAssistantEntry("assistant-2", "Answer two");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt1), assistant("Answer two")],
    });

    const reviewPrompt2 = String(env.userMessages[2]?.content);
    env.setLeafAssistantEntry("assistant-3", "No further substantial changes");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt2), assistant("No further substantial changes")],
    });

    const headSubject = (await gitStdout(cwd, ["log", "-1", "--format=%s"])) .trim();
    const graph = await gitStdout(cwd, ["log", "--oneline", "--decorate", "--graph", "--all", "-6"]);
    const branches = await gitStdout(cwd, ["branch", "--list", "ultrathink/*"]);

    expect(headSubject).toBe("Merge ultrathink/deterministic-branch");
    expect(graph).toContain("Iteration 2 touches work.txt");
    expect(graph).toContain("Iteration 1 touches work.txt");
    expect(branches.trim()).toBe("");
    expect(env.customMessages[0]?.message.content).toContain("Final merge commit:");
    expect(env.customMessages[0]?.message.content).toContain("Iteration 1 touches work.txt");
    expect(env.customMessages[0]?.message.content).toContain("Iteration 2 touches work.txt");
  });

  it("reintegrates a single iteration commit without creating a merge commit", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-single-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Fix the repo once");

    await writeRepoFile(cwd, "app.txt", "first pass\n");
    env.setLeafAssistantEntry("assistant-1", "Assistant output v1");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Fix the repo once"), assistant("Assistant output v1")],
    });

    const reviewPrompt = String(env.userMessages[1]?.content);
    env.setLeafAssistantEntry("assistant-2", "Assistant says nothing important remains");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("Assistant says nothing important remains")],
    });

    const logSubjects = (await gitStdout(cwd, ["log", "--format=%s", "-3"]))
      .trim()
      .split("\n")
      .filter(Boolean);
    const body = await gitStdout(cwd, ["log", "-1", "--format=%B"]);
    const branchList = await gitStdout(cwd, ["branch", "--list", "ultrathink/*"]);

    expect(logSubjects[0]).toBe("Iteration 1 touches app.txt");
    expect(logSubjects[1]).toBe("initial");
    expect(body).toContain("Summary for iteration v1.");
    expect(branchList.trim()).toBe("");
    expect(env.customMessages[0]?.message.content).not.toContain("Final merge commit:");
    expect(env.customMessages[0]?.message.content).toContain("Scratch branch deleted: yes");
  });

  it("retries branch slug generation when the first ultrathink branch name already exists", async () => {
    resetDeterministicNaming();
    installDeterministicNaming({ slugs: ["deterministic-branch", "fresh-branch"] });
    const cwd = await createTempGitRepo("ultrathink-git-branch-collision-");
    await execWithCwd("git", ["checkout", "-b", "ultrathink/deterministic-branch"], { cwd });
    await execWithCwd("git", ["checkout", "-"], { cwd });

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Handle branch collisions");

    expect((await gitStdout(cwd, ["branch", "--show-current"])).trim()).toBe("ultrathink/fresh-branch");
  });

  it("refuses to start when the repository is already dirty", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-dirty-");
    await writeRepoFile(cwd, "dirty.txt", "already dirty\n");

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Review despite dirty repo");

    expect(env.userMessages).toHaveLength(0);
    expect(env.customMessages).toHaveLength(0);
    expect(env.ui.notifications.at(-1)?.message).toContain("clean git working tree");
    expect((await gitStdout(cwd, ["branch", "--show-current"])).trim()).not.toContain("ultrathink/");
  });

  it("deletes the scratch branch and returns to main when no iteration commits were created", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-zero-commit-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Do nothing useful");

    // Emit agent_end with no file changes → no-git-changes → stop
    env.setLeafAssistantEntry("assistant-1", "Nothing to change");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Do nothing useful"), assistant("Nothing to change")],
    });

    expect(env.customMessages).toHaveLength(1);
    expect(env.customMessages[0]?.message.content).toContain("no iteration commits were created");
    expect(env.customMessages[0]?.message.content).toContain("Scratch branch deleted: yes");

    const branches = await gitStdout(cwd, ["branch", "--list", "ultrathink/*"]);
    expect(branches.trim()).toBe("");

    const currentBranch = (await gitStdout(cwd, ["branch", "--show-current"])).trim();
    expect(currentBranch).toBe("main");
  });

  it("preserves the scratch branch when rebase conflicts occur during reintegration", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-conflict-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Make conflicting changes");

    // Iteration 1: write conflict.txt on scratch branch
    await writeRepoFile(cwd, "conflict.txt", "from-ultrathink\n");
    env.setLeafAssistantEntry("assistant-1", "Wrote conflict.txt");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Make conflicting changes"), assistant("Wrote conflict.txt")],
    });

    // Simulate a conflicting commit on the original branch while on the scratch branch
    await execWithCwd("git", ["checkout", "main"], { cwd });
    await writeRepoFile(cwd, "conflict.txt", "from-main\n");
    await execWithCwd("git", ["add", "conflict.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "main-side conflict"], { cwd });
    await execWithCwd("git", ["checkout", "ultrathink/deterministic-branch"], { cwd });

    // Iteration 2: no changes → triggers stop → reintegration attempt → conflict
    const reviewPrompt = String(env.userMessages[1]?.content);
    env.setLeafAssistantEntry("assistant-2", "No further changes");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("No further changes")],
    });

    expect(env.customMessages).toHaveLength(1);
    const summary = env.customMessages[0]?.message.content ?? "";
    expect(summary).toMatch(/preserved|failed/i);
    expect(summary).toContain("Scratch branch deleted: no");

    const branches = await gitStdout(cwd, ["branch", "--list", "ultrathink/*"]);
    expect(branches.trim()).not.toBe("");
  });
});
