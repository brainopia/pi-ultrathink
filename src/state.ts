import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ActiveRun, IterationRecord, StopReason, UltrathinkConfig, UltrathinkStateEntry } from "./types.js";

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
  runId: string;
  promptText: string;
  config: UltrathinkConfig;
  continuationPromptTemplate: string;
  reviewBaseSha?: string;
  originalBranchName?: string;
  currentBranchName?: string;
  commitsEnabled: boolean;
  preflightGitFailure?: string;
}): ActiveRun {
  return {
    runId: args.runId,
    originalPromptText: args.promptText,
    iteration: 0,
    maxIterations: args.config.maxIterations,
    stableRepeats: 0,
    originalBranchName: args.originalBranchName,
    currentBranchName: args.currentBranchName,
    gitMode: args.config.git.mode,
    commitsEnabled: args.commitsEnabled,
    awaitingExtensionFollowUp: false,
    expectedPromptText: args.promptText,
    reviewBaseSha: args.reviewBaseSha,
    continuationPromptTemplate: args.continuationPromptTemplate,
    commitBodyMaxChars: args.config.commitBodyMaxChars,
    preflightGitFailure: args.preflightGitFailure,
    iterations: [],
    startedAt: new Date().toISOString(),
  };
}

export function persistRunStart(pi: ExtensionAPI, run: ActiveRun): void {
  const entry: UltrathinkStateEntry = {
    kind: "start",
    runId: run.runId,
    promptText: run.originalPromptText,
    startedAt: run.startedAt,
    reviewBaseSha: run.reviewBaseSha,
    continuationPromptTemplate: run.continuationPromptTemplate,
    originalBranchName: run.originalBranchName,
    currentBranchName: run.currentBranchName,
  };
  pi.appendEntry(CUSTOM_ENTRY_TYPE, entry);
}

export function persistIteration(pi: ExtensionAPI, run: ActiveRun, record: IterationRecord): void {
  const entry: UltrathinkStateEntry = {
    kind: "iteration",
    runId: run.runId,
    iteration: record.iteration,
    label: record.label,
    answerDigest: record.answerDigest,
    previousDigest: record.previousDigest,
    stableRepeats: record.stableRepeats,
    commitCreated: record.commitCreated,
    commitSha: record.commitSha,
    commitParentSha: record.commitParentSha,
    commitNote: record.commitNote,
    stopReason: record.stopReason,
  };
  pi.appendEntry(CUSTOM_ENTRY_TYPE, entry);
}

export function persistStop(pi: ExtensionAPI, run: ActiveRun, stopReason: StopReason): void {
  const entry: UltrathinkStateEntry = {
    kind: "stop",
    runId: run.runId,
    stopReason,
    reviewBaseSha: run.reviewBaseSha,
    iteration: run.iteration,
    continuationPromptTemplate: run.continuationPromptTemplate,
    originalBranchName: run.originalBranchName,
    currentBranchName: run.currentBranchName,
  };
  pi.appendEntry(CUSTOM_ENTRY_TYPE, entry);
}
