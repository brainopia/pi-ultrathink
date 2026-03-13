import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ActiveRun, IterationRecord, StopReason } from "./types.js";

function describeStopReason(stopReason: StopReason): string {
  switch (stopReason) {
    case "no-git-changes":
      return "the latest iteration produced no repository changes, so the loop stopped";
    case "max-iterations":
      return "the configured iteration limit was reached";
    case "git-error":
      return "git-backed iteration tracking failed, so no further automatic reviews were queued";
    case "cancelled-by-user":
      return "the user sent another prompt, so the active loop was cancelled";
    case "cancelled-by-interrupt":
      return "the active agent turn was interrupted, so the loop was cancelled";
  }
}

export function setUltrathinkStatus(ctx: ExtensionContext, run?: ActiveRun): void {
  if (!run) {
    ctx.ui.setStatus("ultrathink", undefined);
    return;
  }

  const nextIteration = Math.min(run.iteration + 1, run.maxIterations);
  ctx.ui.setStatus("ultrathink", `🧠 ultrathink v${nextIteration}/${run.maxIterations}`);
}

export function sendCompletionMessage(
  pi: ExtensionAPI,
  args: {
    run: ActiveRun;
    stopReason: StopReason;
    iterations: IterationRecord[];
  },
): void {
  const iterationLines =
    args.iterations.length === 0
      ? ["- no completed assistant iteration was recorded"]
      : args.iterations.map((iteration) => {
          if (iteration.commitCreated && iteration.commitSha) {
            return `- ${iteration.label}: commit ${iteration.commitSha}`;
          }
          if (iteration.commitNote) {
            return `- ${iteration.label}: ${iteration.commitNote}`;
          }
          return `- ${iteration.label}: no repository changes, no commit`;
        });

  const branchSummary =
    args.run.gitMode === "scratch-branch" && args.run.currentBranchName
      ? `\nScratch branch: ${args.run.currentBranchName}${args.run.originalBranchName ? ` (from ${args.run.originalBranchName})` : ""}`
      : "";

  pi.sendMessage(
    {
      customType: "ultrathink-summary",
      display: true,
      content: [
        `Ultrathink run ${args.run.runId} finished because ${describeStopReason(args.stopReason)}.`,
        branchSummary.trim(),
        "Iterations:",
        ...iterationLines,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { triggerTurn: false },
  );
}
