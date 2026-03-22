import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ultrathinkExtension from "../src/index.js";
import { createFakePiEnvironment } from "./support/fakePi.js";
import { getUltrathinkConfigPath } from "../src/config.js";
import { writeFile } from "node:fs/promises";
import { createTempGitRepo, execWithCwd, writeRepoFile } from "./support/gitTestUtils.js";
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

describe("Ultrathink orchestration", () => {
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

  it("stops when an iteration produces no repository changes and reintegrates the single commit without a merge commit", async () => {
    const cwd = await createTempGitRepo("ultrathink-orchestration-stop-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Improve the answer");

    await writeRepoFile(cwd, "answer.txt", "first pass\n");
    env.setLeafAssistantEntry("assistant-1", "First answer");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Improve the answer"), assistant("First answer")],
    });

    const reviewPrompt = String(env.userMessages[1]?.content);
    env.setLeafAssistantEntry("assistant-2", "No further substantial changes");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("No further substantial changes")],
    });

    expect(env.userMessages).toHaveLength(2);
    expect(env.customMessages).toHaveLength(1);
    expect(env.customMessages[0]?.message.content).toContain("Reintegration: rebased ultrathink/deterministic-branch");
    expect(env.customMessages[0]?.message.content).toContain("Scratch branch deleted: yes");
    expect(env.labels.get("assistant-2")).toBe("ultrathink:v2");
  });

  it("cancels the loop when the user types another prompt and preserves the scratch branch", async () => {
    const cwd = await createTempGitRepo("ultrathink-orchestration-user-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Draft a plan");
    await writeRepoFile(cwd, "plan.txt", "v1\n");

    env.setLeafAssistantEntry("assistant-1", "Plan v1");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Draft a plan"), assistant("Plan v1")],
    });

    await env.emit("input", {
      type: "input",
      text: "Actually do something else",
      source: "interactive",
    });

    expect(env.customMessages).toHaveLength(1);
    expect(env.customMessages[0]?.message.content).toContain("scratch branch ultrathink/deterministic-branch was preserved");
    expect(env.customMessages[0]?.message.content).toContain("Scratch branch deleted: no");
  });

  it("cancels the loop when pi aborts the current agent turn", async () => {
    const cwd = await createTempGitRepo("ultrathink-orchestration-escape-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);
    expect(env.shortcuts.has("escape")).toBe(false);
    await env.invokeCommand("ultrathink", "Refine the draft");
    await writeRepoFile(cwd, "draft.txt", "v1\n");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Refine the draft"), assistant("Draft v1")],
    });
    const reviewPrompt = String(env.userMessages[1]?.content);
    env.setLeafAssistantEntry("assistant-2", "Partial draft", "aborted");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("Partial draft", "aborted")],
    });
    expect(env.customMessages).toHaveLength(1);
    expect(env.customMessages[0]?.message.content).toContain("agent turn was interrupted");
    expect(env.customMessages[0]?.message.content).toContain("Scratch branch deleted: no");
    expect(env.userMessages).toHaveLength(2);
  });

  it("stops with max-iterations when iteration count reaches maxIterations", async () => {
    const configPath = getUltrathinkConfigPath();
    await writeFile(configPath, JSON.stringify({ maxIterations: 2 }), "utf8");

    const cwd = await createTempGitRepo("ultrathink-orchestration-max-iter-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Improve iteratively");

    // Iteration 1: write a file, emit agent_end with changes → commit + review prompt
    await writeRepoFile(cwd, "iter1.txt", "iteration one\n");
    env.setLeafAssistantEntry("assistant-1", "First iteration done");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Improve iteratively"), assistant("First iteration done")],
    });

    // Iteration 2: write another file, emit agent_end → hits maxIterations → stop
    const reviewPrompt = String(env.userMessages[1]?.content);
    await writeRepoFile(cwd, "iter2.txt", "iteration two\n");
    env.setLeafAssistantEntry("assistant-2", "Second iteration done");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("Second iteration done")],
    });

    expect(env.customMessages).toHaveLength(1);
    expect(env.customMessages[0]?.message.content).toContain("iteration limit was reached");
    expect(env.userMessages).toHaveLength(2);
  });
});
