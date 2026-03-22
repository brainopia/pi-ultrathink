import type {
  ActiveRun,
  IterationRecord,
  NamingModelConfig,
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
  runId: string;
  promptText: string;
  config: UltrathinkConfig;
  continuationPromptTemplate: string;
  namingModel: NamingModelConfig;
  reviewBaseSha?: string;
  originalHeadSha?: string;
  originalBranchName?: string;
  scratchBranchName?: string;
}): ActiveRun {
  return {
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
    continuationPromptTemplate: args.continuationPromptTemplate,
    commitBodyMaxChars: args.config.commitBodyMaxChars,
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
    stopReason,
    reviewBaseSha: run.reviewBaseSha,
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
