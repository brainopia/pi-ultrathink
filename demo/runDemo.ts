import { DefaultResourceLoader, SessionManager, createAgentSession } from "@mariozechner/pi-coding-agent";
import ultrathinkExtension from "../src/index.js";
import { DEMO_CODING_MODEL, createScriptedProviderExtension, demoApplyChangeTool, type DemoStep } from "./fakeProvider.js";
import { setNamingTestOverrides } from "../src/naming.js";
import { installTempGlobalUltrathinkConfigPath } from "../test/support/globalConfigTestUtils.js";
import { createTempGitRepo, gitStdout } from "../test/support/gitTestUtils.js";

interface ScenarioResult {
  cwd: string;
  stopReason: string | undefined;
  iterationSummaries: string[];
  gitLogLines: string[];
  finalizationLine: string | undefined;
}

type UltrathinkStateEntry = {
  type: "custom";
  customType: "ultrathink-state";
  data?: {
    kind?: "start" | "iteration" | "stop";
    label?: string;
    commitCreated?: boolean;
    commitSha?: string;
    commitSubject?: string;
    commitNote?: string;
    stopReason?: string;
    finalization?: {
      mode?: string;
      scratchBranchDeleted?: boolean;
      mergeCommitSha?: string;
      mergeCommitSubject?: string;
    };
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

async function waitForStopEntry(sessionManager: SessionManager, timeoutMs = 5_000): Promise<UltrathinkStateEntry> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = sessionManager.getEntries().filter(isUltrathinkStateEntry) as UltrathinkStateEntry[];
    const stopEntry = findLastEntry(entries, (entry) => entry.data?.kind === "stop");
    if (stopEntry) {
      return stopEntry;
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
    noExtensions: true,
    extensionFactories: [ultrathinkExtension, createScriptedProviderExtension(steps)],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    model: { ...DEMO_CODING_MODEL, input: [...DEMO_CODING_MODEL.input] } as typeof DEMO_CODING_MODEL & {
      input: Array<"text" | "image">;
    },
    resourceLoader: loader,
    sessionManager,
    customTools: [demoApplyChangeTool as any],
  });

  await session.prompt("/ultrathink Fix the task and keep improving until stable");
  await session.agent.waitForIdle();
  const stopEntry = await waitForStopEntry(sessionManager);

  const stateEntries = sessionManager.getEntries().filter(isUltrathinkStateEntry) as UltrathinkStateEntry[];
  const iterationEntries = stateEntries.filter((entry) => entry.data?.kind === "iteration");
  const iterationSummaries = iterationEntries.map((entry) => {
    const label = String(entry.data?.label);
    if (entry.data?.commitCreated && entry.data?.commitSha && entry.data?.commitSubject) {
      return `iteration ${label}: ${entry.data.commitSha} ${entry.data.commitSubject}`;
    }
    return `iteration ${label}: ${entry.data?.commitNote ?? "no repository changes, no commit"}`;
  });

  const gitLogLines = (await gitStdout(cwd, ["log", "--oneline", "--decorate", "--graph", "--all"]))
    .trim()
    .split("\n")
    .filter(Boolean);

  const finalizationLine = stopEntry.data?.finalization?.mergeCommitSubject
    ? `final merge commit: ${stopEntry.data.finalization.mergeCommitSha ?? "(no sha)"} ${stopEntry.data.finalization.mergeCommitSubject}`
    : `finalization mode: ${stopEntry.data?.finalization?.mode ?? "unknown"}; scratch branch deleted: ${stopEntry.data?.finalization?.scratchBranchDeleted ? "yes" : "no"}`;

  return {
    cwd,
    stopReason: stopEntry.data?.stopReason,
    iterationSummaries,
    gitLogLines,
    finalizationLine,
  };
}

async function main(): Promise<void> {
  const restoreGlobalConfigPath = await installTempGlobalUltrathinkConfigPath("ultrathink-demo-config-");

  setNamingTestOverrides({
    async ensureNamingModel() {
      return { provider: "ultrathink-demo", modelId: "metadata" };
    },
    async generateBranchSlug() {
      return "demo-git-branching";
    },
    async generateIterationCommitMessage({ iteration, changedFiles }) {
      return {
        subject: `Demo iteration ${iteration} updates ${changedFiles[0] ?? "repo"}`,
        body: `- Update ${changedFiles[0] ?? "the repository"}.\n- Keep Ultrathink moving toward a stable result.`,
      };
    },
    async generateMergeCommitMessage({ scratchBranchName }) {
      return {
        subject: `Merge ${scratchBranchName}`,
        body: "- Integrate the scratch-branch work.\n- Preserve the detailed side history while keeping the main branch readable.",
      };
    },
  });

  try {
    const changedEachIteration = await runScenario("changed", [
      { answer: "Iteration one answer", change: { path: "demo.txt", content: "v1\n" } },
      { answer: "Iteration two answer", change: { path: "demo.txt", content: "v2\n" } },
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
    console.log(changedEachIteration.finalizationLine);
    console.log(`stop reason: ${changedEachIteration.stopReason}`);
    console.log("compare with: git log --oneline --decorate --graph");
    changedEachIteration.gitLogLines.slice(0, 6).forEach((line) => console.log(`  ${line}`));
    console.log("");
    console.log("> pi-ultrathink demo");
    console.log("command: /ultrathink Fix the task and keep improving until stable");
    unchangedFinalIteration.iterationSummaries.forEach((line) => console.log(line));
    console.log(unchangedFinalIteration.finalizationLine);
    console.log(`stop reason: ${unchangedFinalIteration.stopReason}`);
    console.log(`demo repo (changed scenario): ${changedEachIteration.cwd}`);
    console.log(`demo repo (unchanged scenario): ${unchangedFinalIteration.cwd}`);
  } finally {
    restoreGlobalConfigPath();
    setNamingTestOverrides(undefined);
  }
}

main().catch((error) => {
  setNamingTestOverrides(undefined);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
