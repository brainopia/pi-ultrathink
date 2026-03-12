import { describe, expect, it } from "vitest";
import ultrathinkExtension from "../src/index.js";
import { createFakePiEnvironment } from "./support/fakePi.js";
import { createTempGitRepo, execWithCwd, gitStdout, writeRepoFile } from "./support/gitTestUtils.js";

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

describe("/ultrathink command spike", () => {
  it("launches one initial visible prompt and one automatic visible review prompt based on git", async () => {
    const cwd = await createTempGitRepo("ultrathink-spike-");
    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Fix the bug");

    expect(env.userMessages).toHaveLength(1);
    expect(env.userMessages[0]?.content).toBe("Fix the bug");

    await writeRepoFile(cwd, "work.txt", "v1\n");
    env.setLeafAssistantEntry("assistant-1", "Initial answer");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Fix the bug"), assistant("Initial answer")],
    });

    expect(env.userMessages).toHaveLength(2);
    const reviewPrompt = String(env.userMessages[1]?.content);
    const baselineSha = (await gitStdout(cwd, ["rev-parse", "HEAD^"]))
      .trim();
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
    const baselineSha = (await gitStdout(cwd, ["rev-parse", "HEAD^"]))
      .trim();
    expect(reviewPrompt).toContain("Original task:");
    expect(reviewPrompt).toContain("Ship the fix");
    expect(reviewPrompt).toContain(`git diff ${baselineSha} HEAD`);
    expect(reviewPrompt).toContain("Continue only for serious correctness or reliability issues.");
    expect(reviewPrompt).toContain("Literal token: {headSha}.");
  });
});
