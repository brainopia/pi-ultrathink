import path from "node:path";
import { DefaultResourceLoader, SessionManager, createAgentSession } from "@mariozechner/pi-coding-agent";
import { DEMO_MODEL, createScriptedProviderExtension, demoApplyChangeTool, type DemoStep } from "./fakeProvider.js";
import { createTempGitRepo, gitStdout } from "../test/support/gitTestUtils.js";

interface ScenarioResult {
  cwd: string;
  stopReason: string | undefined;
  iterationSummaries: string[];
  transcriptLines: string[];
  gitLogLines: string[];
}

type UltrathinkStateEntry = {
  type: "custom";
  id: string;
  parentId: string | null;
  timestamp: string;
  customType: "ultrathink-state";
  data?: {
    kind?: "start" | "iteration" | "stop";
    label?: string;
    commitCreated?: boolean;
    commitSha?: string;
    commitNote?: string;
    stopReason?: string;
  };
};

function isUltrathinkStateEntry(entry: unknown): entry is UltrathinkStateEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "type" in entry &&
    "customType" in entry &&
    (entry as { type?: unknown }).type === "custom" &&
    (entry as { customType?: unknown }).customType === "ultrathink-state"
  );
}

function findLastEntry<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      return item;
    }
  }
  return undefined;
}


async function waitForStopEntry(sessionManager: SessionManager, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries: UltrathinkStateEntry[] = sessionManager.getEntries().filter(isUltrathinkStateEntry);
    const stopEntry = findLastEntry(entries, (entry) => entry.data?.kind === "stop");
    if (stopEntry) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the Ultrathink run to finish.");
}

async function runScenario(name: string, steps: DemoStep[]): Promise<ScenarioResult> {
  const cwd = await createTempGitRepo(`ultrathink-demo-${name}-`);
  const sessionManager = SessionManager.inMemory(cwd);
  const loader = new DefaultResourceLoader({
    cwd,
    additionalExtensionPaths: [path.resolve("src/index.ts")],
    extensionFactories: [createScriptedProviderExtension(steps)],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    model: { ...DEMO_MODEL, input: [...DEMO_MODEL.input] } as typeof DEMO_MODEL & { input: Array<"text" | "image"> },
    resourceLoader: loader,
    sessionManager,
    customTools: [demoApplyChangeTool as any],
  });

  await session.prompt("/ultrathink Fix the task and keep improving until stable");
  await session.agent.waitForIdle();
  await waitForStopEntry(sessionManager);

  const transcriptLines = session.messages.flatMap((message) => {
    if (message.role === "user") {
      return [`user: ${typeof message.content === "string" ? message.content : "[structured user message]"}`];
    }
    if (message.role === "assistant") {
      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return [`assistant: ${text}`];
    }
    if (message.role === "custom") {
      return [`custom: ${String(message.content)}`];
    }
    return [];
  });

  const stateEntries: UltrathinkStateEntry[] = sessionManager.getEntries().filter(isUltrathinkStateEntry);
  const iterationEntries = stateEntries.filter((entry) => entry.data?.kind === "iteration");
  const stopEntry = findLastEntry(stateEntries, (entry) => entry.data?.kind === "stop");

  const iterationSummaries = iterationEntries.map((entry) => {
    const label = String(entry.data?.label);
    if (entry.data?.commitCreated && entry.data?.commitSha) {
      return `iteration ${label}: commit created (${entry.data.commitSha})`;
    }
    return `iteration ${label}: ${entry.data?.commitNote ?? "no repository changes, no commit"}`;
  });

  const gitLogLines = (await gitStdout(cwd, ["log", "--oneline", "--decorate", "--graph", "--all"]))
    .trim()
    .split("\n")
    .filter(Boolean);

  return {
    cwd,
    stopReason: stopEntry?.data?.stopReason,
    iterationSummaries,
    transcriptLines,
    gitLogLines,
  };
}

async function main(): Promise<void> {
  const changedEachIteration = await runScenario("changed", [
    { answer: "Iteration one answer", change: { path: "demo.txt", content: "v1\n" } },
    { answer: "Iteration two answer", change: { path: "demo.txt", content: "v2\n" } },
    { answer: "Iteration three answer", change: { path: "demo.txt", content: "v3\n" } },
    { answer: "No further substantial changes" },
  ]);

  if (changedEachIteration.stopReason !== "no-git-changes") {
    throw new Error(`Expected no-git-changes for changed scenario, got ${changedEachIteration.stopReason}`);
  }

  const unchangedFinalIteration = await runScenario("unchanged", [
    { answer: "Iteration one answer", change: { path: "demo.txt", content: "v1\n" } },
    { answer: "Iteration one answer" },
  ]);

  if (unchangedFinalIteration.stopReason !== "no-git-changes") {
    throw new Error(`Expected no-git-changes for unchanged scenario, got ${unchangedFinalIteration.stopReason}`);
  }

  console.log("> pi-ultrathink demo");
  console.log("command: /ultrathink Fix the task and keep improving until stable");
  changedEachIteration.iterationSummaries.forEach((line) => console.log(line));
  console.log(`stop reason: ${changedEachIteration.stopReason}`);
  console.log("compare with: git log --oneline --decorate --graph");
  changedEachIteration.gitLogLines.slice(0, 5).forEach((line) => console.log(`  ${line}`));
  console.log("");
  console.log("> pi-ultrathink demo");
  console.log("command: /ultrathink Fix the task and keep improving until stable");
  unchangedFinalIteration.iterationSummaries.forEach((line) => console.log(line));
  console.log(`stop reason: ${unchangedFinalIteration.stopReason}`);
  console.log(`demo repo (changed scenario): ${changedEachIteration.cwd}`);
  console.log(`demo repo (unchanged scenario): ${unchangedFinalIteration.cwd}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
