import type {
  ActiveRun,
  GitRunKind,
  IterationRecord,
  NamingModelConfig,
  ReviewCommitDetails,
  ReviewCommitSummary,
  ReviewSource,
  StopReason,
  UltrathinkConfig,
  UltrathinkStateEntry,
} from "./types.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CUSTOM_ENTRY_TYPE = "ultrathink-state";

function formatRunIdPart(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function createRunId(date = new Date()): string {
  return [
    date.getUTCFullYear(),
    formatRunIdPart(date.getUTCMonth() + 1),
    formatRunIdPart(date.getUTCDate()),
    "T",
    formatRunIdPart(date.getUTCHours()),
    formatRunIdPart(date.getUTCMinutes()),
    formatRunIdPart(date.getUTCSeconds()),
    "-",
    Math.random().toString(36).slice(2, 8),
  ].join("");
}

export function createActiveRun(args: {
  mode?: "git" | "oracle";
  gitRunKind?: GitRunKind;
  runId: string;
  promptText: string;
  config: UltrathinkConfig;
  continuationPromptTemplate: string;
  namingModel?: NamingModelConfig;
  reviewBaseSha?: string;
  reviewSource?: ReviewSource;
  reviewStartSha?: string;
  reviewExclusiveBaseSha?: string;
  reviewCommits?: ReviewCommitSummary[];
  seedScratchCommits?: ReviewCommitDetails[];
  originalHeadSha?: string;
  originalBranchName?: string;
  scratchBranchName?: string;
  oracleMaxRounds?: number;
}): ActiveRun {
  return {
    mode: args.mode ?? "git",
    gitRunKind: args.mode === "git" || args.mode === undefined ? args.gitRunKind ?? "task" : undefined,
    runId: args.runId,
    originalPromptText: args.promptText,
    iteration: 0,
    maxIterations: args.config.maxIterations,
    originalHeadSha: args.originalHeadSha,
    originalBranchName: args.originalBranchName,
    scratchBranchName: args.scratchBranchName,
    namingModel: args.namingModel,
    awaitingExtensionFollowUp: false,
    expectedPromptText: args.promptText,
    reviewBaseSha: args.reviewBaseSha,
    reviewSource: args.reviewSource,
    reviewStartSha: args.reviewStartSha,
    reviewExclusiveBaseSha: args.reviewExclusiveBaseSha,
    reviewCommits: args.reviewCommits,
    seedScratchCommits: args.seedScratchCommits,
    continuationPromptTemplate: args.continuationPromptTemplate,
    commitBodyMaxChars: args.config.commitBodyMaxChars,
    iterations: [],
    startedAt: new Date().toISOString(),
    oracleRound: args.mode === "oracle" ? 0 : undefined,
    oracleMaxRounds: args.oracleMaxRounds,
  };
}

export function persistRunStart(pi: ExtensionAPI, run: ActiveRun): void {
  const entry: UltrathinkStateEntry = {
    kind: "start",
    runId: run.runId,
    promptText: run.originalPromptText,
    startedAt: run.startedAt,
    gitRunKind: run.gitRunKind,
    reviewBaseSha: run.reviewBaseSha,
    reviewSource: run.reviewSource,
    reviewStartSha: run.reviewStartSha,
    reviewExclusiveBaseSha: run.reviewExclusiveBaseSha,
    reviewCommits: run.reviewCommits,
    seedScratchCommits: run.seedScratchCommits,
    originalHeadSha: run.originalHeadSha,
    continuationPromptTemplate: run.continuationPromptTemplate,
    originalBranchName: run.originalBranchName,
    scratchBranchName: run.scratchBranchName,
    namingModel: run.namingModel,
  };
  pi.appendEntry(CUSTOM_ENTRY_TYPE, entry);
}

export function persistIteration(pi: ExtensionAPI, run: ActiveRun, record: IterationRecord): void {
  const entry: UltrathinkStateEntry = {
    kind: "iteration",
    runId: run.runId,
    gitRunKind: run.gitRunKind,
    reviewSource: run.reviewSource,
    reviewStartSha: run.reviewStartSha,
    reviewExclusiveBaseSha: run.reviewExclusiveBaseSha,
    reviewCommits: run.reviewCommits,
    seedScratchCommits: run.seedScratchCommits,
    iteration: record.iteration,
    label: record.label,
    answerDigest: record.answerDigest,
    previousDigest: record.previousDigest,
    commitCreated: record.commitCreated,
    commitSha: record.commitSha,
    commitParentSha: record.commitParentSha,
    commitSubject: record.commitSubject,
    commitBody: record.commitBody,
    commitNote: record.commitNote,
    stopReason: record.stopReason,
  };
  pi.appendEntry(CUSTOM_ENTRY_TYPE, entry);
}

export function persistStop(pi: ExtensionAPI, run: ActiveRun, stopReason: StopReason): void {
  const entry: UltrathinkStateEntry = {
    kind: "stop",
    runId: run.runId,
    gitRunKind: run.gitRunKind,
    stopReason,
    reviewBaseSha: run.reviewBaseSha,
    reviewSource: run.reviewSource,
    reviewStartSha: run.reviewStartSha,
    reviewExclusiveBaseSha: run.reviewExclusiveBaseSha,
    reviewCommits: run.reviewCommits,
    seedScratchCommits: run.seedScratchCommits,
    originalHeadSha: run.originalHeadSha,
    iteration: run.iteration,
    continuationPromptTemplate: run.continuationPromptTemplate,
    originalBranchName: run.originalBranchName,
    scratchBranchName: run.scratchBranchName,
    namingModel: run.namingModel,
    finalization: run.finalization,
  };
  pi.appendEntry(CUSTOM_ENTRY_TYPE, entry);
}
