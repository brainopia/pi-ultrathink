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

describe("Ultrathink git integration", () => {
  it("creates v1/v2/v3 commits and stops on the first unchanged verification pass", async () => {
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
    await writeRepoFile(cwd, "work.txt", "v3\n");
    env.setLeafAssistantEntry("assistant-3", "Answer three");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt2), assistant("Answer three")],
    });

    const reviewPrompt3 = String(env.userMessages[3]?.content);
    env.setLeafAssistantEntry("assistant-4", "No further substantial changes");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user(reviewPrompt3), assistant("No further substantial changes")],
    });

    const subjects = (await gitStdout(cwd, ["log", "--format=%s", "-5"]))
      .trim()
      .split("\n")
      .slice(0, 3);

    expect(subjects[0]).toMatch(/ultrathink\(.+\): v3/);
    expect(subjects[1]).toMatch(/ultrathink\(.+\): v2/);
    expect(subjects[2]).toMatch(/ultrathink\(.+\): v1/);
    expect(env.customMessages[0]?.message.content).toContain("produced no repository changes");
  });

  it("skips unchanged iterations and stores assistant output in the commit body", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-unchanged-");
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

    const logSubjects = (await gitStdout(cwd, ["log", "--format=%s"]))
      .trim()
      .split("\n")
      .filter((line) => line.includes("ultrathink("));
    expect(logSubjects).toHaveLength(1);
    expect(logSubjects[0]).toMatch(/: v1$/);

    const body = await gitStdout(cwd, ["log", "-1", "--format=%B"]);
    expect(body).toContain("Assistant output for iteration v1:");
    expect(body).toContain("Assistant output v1");
    expect(env.customMessages[0]?.message.content).toContain("no repository changes, no commit");
  });

  it("records a git error when the repository is already dirty", async () => {
    const cwd = await createTempGitRepo("ultrathink-git-dirty-");
    await writeRepoFile(cwd, "dirty.txt", "already dirty\n");

    const env = createFakePiEnvironment({ cwd, execImpl: execWithCwd });
    ultrathinkExtension(env.api);

    await env.invokeCommand("ultrathink", "Review despite dirty repo");

    env.setLeafAssistantEntry("assistant-1", "Answer with no commit");
    await env.emit("agent_end", {
      type: "agent_end",
      messages: [user("Review despite dirty repo"), assistant("Answer with no commit")],
    });

    expect(env.customMessages[0]?.message.content).toContain("git-backed iteration tracking failed");
    const gitStatus = await execWithCwd("git", ["status", "--porcelain"], { cwd });
    expect(gitStatus.stdout).toContain("dirty.txt");
  });
});
