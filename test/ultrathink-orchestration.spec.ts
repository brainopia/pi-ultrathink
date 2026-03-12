import { describe, expect, it } from "vitest";
import ultrathinkExtension from "../src/index.js";
import { createFakePiEnvironment } from "./support/fakePi.js";
import { createTempGitRepo, execWithCwd, writeRepoFile } from "./support/gitTestUtils.js";

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
  it("stops when an iteration produces no repository changes", async () => {
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
    expect(env.customMessages[0]?.message.content).toContain("produced no repository changes");
    expect(env.labels.get("assistant-2")).toBe("ultrathink:v2");
  });

  it("cancels the loop when the user types another prompt", async () => {
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
    expect(env.customMessages[0]?.message.content).toContain("user sent another prompt");
  });

  it("cancels the active streaming turn when Escape is pressed", async () => {
    const cwd = await createTempGitRepo("ultrathink-orchestration-escape-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Refine the draft");
    await writeRepoFile(cwd, "draft.txt", "v1\n");

    env.setLeafAssistantEntry("assistant-1", "Draft v1");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Refine the draft"), assistant("Draft v1")],
    });

    env.idle = false;
    await env.invokeShortcut("escape");
    expect(env.aborted).toBe(1);

    const reviewPrompt = String(env.userMessages[1]?.content);
    env.setLeafAssistantEntry("assistant-2", "Partial draft", "aborted");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt), assistant("Partial draft", "aborted")],
    });

    expect(env.customMessages).toHaveLength(1);
    expect(env.customMessages[0]?.message.content).toContain("Escape cancelled");
    expect(env.userMessages).toHaveLength(2);
  });
});
