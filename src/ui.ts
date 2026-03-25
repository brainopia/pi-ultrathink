import type { ActiveRun, FinalizationResult, IterationRecord, StopReason } from "./types.js";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

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
    case "oracle-accepted":
      return "the oracle accepted the work";
    case "oracle-max-rounds":
      return "the oracle review round limit was reached without acceptance";
  }
}

function describeFinalization(run: ActiveRun, finalization?: FinalizationResult): string {
  if (!finalization) {
    return run.scratchBranchName
      ? `Reintegration: not attempted; scratch branch ${run.scratchBranchName} was preserved.`
      : "Reintegration: not attempted.";
  }

  switch (finalization.mode) {
    case "cleanup":
      return `Reintegration: no iteration commits were created; returned to ${run.originalBranchName ?? "the original branch"} and deleted ${run.scratchBranchName ?? "the scratch branch"}.`;
    case "rebase-fast-forward":
      return `Reintegration: rebased ${run.scratchBranchName ?? "the scratch branch"} and fast-forwarded ${run.originalBranchName ?? "the original branch"}.`;
    case "merge-commit":
      return `Reintegration: merged ${run.scratchBranchName ?? "the scratch branch"} back into ${run.originalBranchName ?? "the original branch"} with a final merge commit.`;
    case "preserved":
      return finalization.error
        ? `Reintegration: failed; preserved ${run.scratchBranchName ?? "the scratch branch"} for manual resolution. ${finalization.error}`
        : `Reintegration: not attempted; preserved ${run.scratchBranchName ?? "the scratch branch"}.`;
    case "none":
      return `Reintegration: not attempted; scratch branch ${run.scratchBranchName ?? "(unknown)"} was preserved.`;
  }
}

function formatBodyLines(body: string | undefined): string[] {
  if (!body) return [];
  return body.split("\n").map((line) => `  ${line}`);
}

function formatScratchCommit(iteration: IterationRecord): string[] {
  const firstLine = `- ${iteration.commitSha ?? "(no sha)"} ${iteration.commitSubject ?? iteration.label}`;
  return [firstLine, ...formatBodyLines(iteration.commitBody)];
}

export function setUltrathinkStatus(ctx: ExtensionContext, run?: ActiveRun): void {
  if (!run) {
    ctx.ui.setStatus("ultrathink", undefined);
    return;
  }

  if (run.mode === "oracle") {
    const round = run.oracleRound ?? 0;
    const max = run.oracleMaxRounds ?? 5;
    ctx.ui.setStatus("ultrathink", `🔮 oracle round ${round}/${max}`);
    return;
  }

  const nextIteration = Math.min(run.iteration + 1, run.maxIterations);
  const branch = run.scratchBranchName ? ` • ${run.scratchBranchName}` : "";
  ctx.ui.setStatus("ultrathink", `🧠 ultrathink v${nextIteration}/${run.maxIterations}${branch}`);
}

export function sendCompletionMessage(
  pi: ExtensionAPI,
  args: {
    run: ActiveRun;
    stopReason: StopReason;
    iterations: IterationRecord[];
  },
): void {
  if (args.run.mode === "oracle") {
    sendOracleCompletionMessage(pi, args);
    return;
  }

  const scratchCommits = args.iterations.filter((iteration) => iteration.commitCreated);
  const lines = [
    `Ultrathink run ${args.run.runId} finished because ${describeStopReason(args.stopReason)}.`,
    args.run.originalBranchName ? `Original branch: ${args.run.originalBranchName}` : "",
    args.run.scratchBranchName ? `Scratch branch: ${args.run.scratchBranchName}` : "",
    args.run.namingModel ? `Naming model: ${args.run.namingModel.provider}/${args.run.namingModel.modelId}` : "",
    describeFinalization(args.run, args.run.finalization),
    `Scratch branch deleted: ${args.run.finalization?.scratchBranchDeleted ? "yes" : "no"}`,
  ].filter(Boolean);

  lines.push("Scratch branch commits:");
  if (scratchCommits.length === 0) {
    lines.push("- none");
  } else {
    for (const iteration of scratchCommits) {
      lines.push(...formatScratchCommit(iteration));
    }
  }

  if (args.run.finalization?.mergeCommitSha || args.run.finalization?.mergeCommitSubject || args.run.finalization?.mergeCommitBody) {
    lines.push("Final merge commit:");
    lines.push(`- ${args.run.finalization.mergeCommitSha ?? "(no sha)"} ${args.run.finalization.mergeCommitSubject ?? "(no subject)"}`);
    lines.push(...formatBodyLines(args.run.finalization.mergeCommitBody));
  }

  pi.sendMessage(
    {
      customType: "ultrathink-summary",
      display: true,
      content: lines.join("\n"),
    },
    { triggerTurn: false },
  );
}

function sendOracleCompletionMessage(
  pi: ExtensionAPI,
  args: {
    run: ActiveRun;
    stopReason: StopReason;
    iterations: IterationRecord[];
  },
): void {
  const rounds = args.run.oracleRound ?? 0;
  const lines = [
    `🔮 Oracle run ${args.run.runId} finished because ${describeStopReason(args.stopReason)}.`,
    `Rounds: ${rounds}`,
  ];

  if (args.stopReason === "oracle-accepted" && args.run.oracleAcceptSummary) {
    lines.push(`Oracle verdict: ${args.run.oracleAcceptSummary}`);
  }

  pi.sendMessage(
    {
      customType: "ultrathink-summary",
      display: true,
      content: lines.join("\n"),
    },
    { triggerTurn: false },
  );
}
