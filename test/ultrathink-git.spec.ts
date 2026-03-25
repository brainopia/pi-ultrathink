import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

async function createRepoWithTrackedMain(prefix = "ultrathink-git-review-"): Promise<string> {
  const cwd = await createTempGitRepo(prefix);
  const remote = await createTempBareGitRepo(`${prefix}remote-`);
  await addRemote(cwd, "origin", remote);
  await pushBranch(cwd, "origin", "main");
  return cwd;
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

    const headSubject = (await gitStdout(cwd, ["log", "-1", "--format=%s"])).trim();
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

    await writeRepoFile(cwd, "conflict.txt", "from-ultrathink\n");
    env.setLeafAssistantEntry("assistant-1", "Wrote conflict.txt");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Make conflicting changes"), assistant("Wrote conflict.txt")],
    });

    await execWithCwd("git", ["checkout", "main"], { cwd });
    await writeRepoFile(cwd, "conflict.txt", "from-main\n");
    await execWithCwd("git", ["add", "conflict.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "main-side conflict"], { cwd });
    await execWithCwd("git", ["checkout", "ultrathink/deterministic-branch"], { cwd });

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

    const currentBranch = (await gitStdout(cwd, ["branch", "--show-current"])).trim();
    expect(currentBranch).toBe("ultrathink/deterministic-branch");
  });

  it("continues the loop when the agent commits changes directly (not via extension)", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-agent-commit-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Implement feature");

    await writeRepoFile(cwd, "feature.ts", "export function feature() {}\n");
    await execWithCwd("git", ["add", "-A"], { cwd });
    await execWithCwd("git", ["commit", "-m", "feat: implement feature", "-m", "Agent committed this directly."], { cwd });

    env.setLeafAssistantEntry("assistant-1", "Implemented the feature and committed");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Implement feature"), assistant("Implemented the feature and committed")],
    });

    expect(env.userMessages).toHaveLength(2);
    expect(env.customMessages).toHaveLength(0);

    const reviewPrompt = String(env.userMessages[1]?.content);
    env.setLeafAssistantEntry("assistant-2", "Everything looks good");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("Everything looks good")],
    });

    expect(env.customMessages).toHaveLength(1);
    const summary = env.customMessages[0]?.message.content ?? "";
    expect(summary).toContain("Scratch branch deleted: yes");

    const currentBranch = (await gitStdout(cwd, ["branch", "--show-current"])).trim();
    expect(currentBranch).toBe("main");

    const branches = await gitStdout(cwd, ["branch", "--list", "ultrathink/*"]);
    expect(branches.trim()).toBe("");

    const log = await gitStdout(cwd, ["log", "--oneline", "-3"]);
    expect(log).toContain("feat: implement feature");
  });

  it("handles agent committing plus leftover uncommitted changes in the same iteration", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-mixed-commit-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Build something");

    await writeRepoFile(cwd, "committed.ts", "export const a = 1;\n");
    await execWithCwd("git", ["add", "-A"], { cwd });
    await execWithCwd("git", ["commit", "-m", "feat: partial work"], { cwd });
    await writeRepoFile(cwd, "uncommitted.ts", "export const b = 2;\n");

    env.setLeafAssistantEntry("assistant-1", "Built most of it");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Build something"), assistant("Built most of it")],
    });

    expect(env.userMessages).toHaveLength(2);
    expect(env.customMessages).toHaveLength(0);

    const reviewPrompt = String(env.userMessages[1]?.content);
    env.setLeafAssistantEntry("assistant-2", "All done");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("All done")],
    });

    expect(env.customMessages).toHaveLength(1);
    const summary = env.customMessages[0]?.message.content ?? "";
    expect(summary).toContain("Scratch branch deleted: yes");

    const log = await gitStdout(cwd, ["log", "--oneline", "-5"]);
    expect(log).toContain("feat: partial work");
    expect(log).toContain("Merge ultrathink/deterministic-branch");
  });

  it("turns dirty changes into a bootstrap review commit and keeps them in the reviewed range", async () => {
    const cwd = await createTempGitRepo("ultrathink-review-dirty-");
    await writeRepoFile(cwd, "dirty.txt", "already changed\n");

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "");

    const startMessage = env.customMessages[0]?.message.content ?? "";
    const reviewPrompt = String(env.userMessages[0]?.content);
    const currentBranch = (await gitStdout(cwd, ["branch", "--show-current"])).trim();
    const bootstrapSubject = (await gitStdout(cwd, ["log", "-1", "--format=%s"])).trim();
    const diffBase = (await gitStdout(cwd, ["rev-parse", "--short", "HEAD^"])).trim();

    expect(currentBranch).toBe("ultrathink/deterministic-branch");
    expect(bootstrapSubject).toBe("Bootstrap review touches dirty.txt");
    expect(startMessage).toContain("Review source: dirty-bootstrap");
    expect(startMessage).toContain("Bootstrap review touches dirty.txt");
    expect(reviewPrompt).toContain(`git diff ${diffBase} HEAD`);

    env.setLeafAssistantEntry("assistant-review-1", "No substantial review changes needed");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("No substantial review changes needed")],
    });

    expect(env.customMessages).toHaveLength(2);
    const summary = env.customMessages[1]?.message.content ?? "";
    expect(summary).toContain("Ultrathink review run");
    expect(summary).toContain("Review source: dirty-bootstrap");
    expect(summary).toContain("Bootstrap review touches dirty.txt");
    expect((await gitStdout(cwd, ["branch", "--show-current"])).trim()).toBe("main");
    expect((await gitStdout(cwd, ["log", "-1", "--format=%s"])).trim()).toBe("Bootstrap review touches dirty.txt");
  });

  it("reviews local commits after the last push using the last pushed commit as the diff base", async () => {
    const cwd = await createRepoWithTrackedMain("ultrathink-review-last-pushed-");
    await writeRepoFile(cwd, "one.txt", "one\n");
    await execWithCwd("git", ["add", "one.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "Add first local change"], { cwd });
    await writeRepoFile(cwd, "two.txt", "two\n");
    await execWithCwd("git", ["add", "two.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "Add second local change"], { cwd });

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "");

    const diffBase = (await gitStdout(cwd, ["rev-parse", "--short", "HEAD~2"])).trim();
    const reviewPrompt = String(env.userMessages[0]?.content);
    const startMessage = env.customMessages[0]?.message.content ?? "";

    expect(startMessage).toContain("Review source: last-pushed");
    expect(startMessage).toContain("Add first local change");
    expect(startMessage).toContain("Add second local change");
    expect(reviewPrompt).toContain(`git diff ${diffBase} HEAD`);
  });

  it("reviews the first unique local commit when the branch tracks another upstream branch", async () => {
    const cwd = await createRepoWithTrackedMain("ultrathink-review-first-unique-");
    await execWithCwd("git", ["checkout", "-b", "feature/first-unique"], { cwd });
    await setBranchUpstream(cwd, "origin/main");
    await writeRepoFile(cwd, "feature1.txt", "one\n");
    await execWithCwd("git", ["add", "feature1.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "Feature commit one"], { cwd });
    await writeRepoFile(cwd, "feature2.txt", "two\n");
    await execWithCwd("git", ["add", "feature2.txt"], { cwd });
    await execWithCwd("git", ["commit", "-m", "Feature commit two"], { cwd });

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "Audit this feature branch.");

    const diffBase = (await gitStdout(cwd, ["rev-parse", "--short", "HEAD~2"])).trim();
    const reviewPrompt = String(env.userMessages[0]?.content);
    const startMessage = env.customMessages[0]?.message.content ?? "";

    expect(startMessage).toContain("Review source: first-unique");
    expect(startMessage).toContain("Feature commit one");
    expect(startMessage).toContain("Feature commit two");
    expect(reviewPrompt).toContain(`git diff ${diffBase} HEAD`);
    expect(reviewPrompt).toContain("Audit this feature branch.");
  });

  it("reports nothing to review when the tracked branch has no local commits after its upstream", async () => {
    const cwd = await createRepoWithTrackedMain("ultrathink-review-nothing-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "");

    expect(env.userMessages).toHaveLength(0);
    expect(env.customMessages).toHaveLength(0);
    expect(env.ui.notifications.at(-1)?.message).toContain("nothing to review");
    expect((await gitStdout(cwd, ["branch", "--show-current"])).trim()).toBe("main");
    expect((await gitStdout(cwd, ["branch", "--list", "ultrathink/*"])).trim()).toBe("");
  });

  it("fails clearly when /ultrathink-review needs an upstream but the branch has none", async () => {
    const cwd = await createTempGitRepo("ultrathink-review-no-upstream-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink-review", "");

    expect(env.userMessages).toHaveLength(0);
    expect(env.customMessages).toHaveLength(0);
    expect(env.ui.notifications.at(-1)?.message).toContain("upstream or pushed history");
    expect((await gitStdout(cwd, ["branch", "--show-current"])).trim()).toBe("main");
    expect((await gitStdout(cwd, ["branch", "--list", "ultrathink/*"])).trim()).toBe("");
  });
});
