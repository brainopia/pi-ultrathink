export interface NamingModelConfig {
  provider: string;
  modelId: string;
}
export interface GeneratedCommitMessage {
  subject: string;
  body: string;
}
export interface UltrathinkConfig {
  maxIterations: number;
  continuationPromptTemplate: string;
  commitBodyMaxChars?: number;
  naming?: NamingModelConfig;
  git: {
    allowDirty: boolean;
  };
}

export type StopReason =
  | "no-git-changes"
  | "max-iterations"
  | "git-error"
  | "cancelled-by-user"
  | "cancelled-by-interrupt";

export interface GitSnapshot {
  repoExists: boolean;
  head: string | null;
  status: string;
}

export interface FinalizationResult {
  mode: "none" | "cleanup" | "rebase-fast-forward" | "merge-commit" | "preserved";
  success: boolean;
  scratchBranchDeleted: boolean;
  mergeCommitSha?: string;
  mergeCommitSubject?: string;
  mergeCommitBody?: string;
  error?: string;
}

export interface IterationRecord {
  iteration: number;
  label: string;
  answerDigest: string;
  previousDigest?: string;
  commitCreated: boolean;
  commitSha?: string;
  commitParentSha?: string;
  commitSubject?: string;
  commitBody?: string;
  stopReason?: StopReason;
  commitNote?: string;
}

export interface ActiveRun {
  runId: string;
  originalPromptText: string;
  iteration: number;
  maxIterations: number;
  previousDigest?: string;
  reviewBaseSha?: string;
  originalHeadSha?: string;
  originalBranchName?: string;
  scratchBranchName?: string;
  namingModel?: NamingModelConfig;
  awaitingExtensionFollowUp: boolean;
  expectedPromptText?: string;
  cancelRequested?: "user";
  continuationPromptTemplate: string;
  commitBodyMaxChars?: number;
  gitBaseline?: GitSnapshot;
  iterations: IterationRecord[];
  finalization?: FinalizationResult;
  startedAt: string;
}

export interface PrepareScratchBranchRunResult {
  originalBranchName: string;
  originalHeadSha: string;
  scratchBranchName: string;
  baseline: GitSnapshot;
}

export interface PendingCommitResult {
  readyToCommit: boolean;
  agentCommitted?: boolean;
  changedFiles: string[];
  diffSummary: string;
  noCommitReason?: string;
}

export interface CommitIterationResult {
  commitCreated: boolean;
  commitSha?: string;
  commitParentSha?: string;
  commitSubject?: string;
  commitBody?: string;
  noCommitReason?: string;
}

export interface UltrathinkStateEntry {
  kind: "start" | "iteration" | "stop";
  runId: string;
  promptText?: string;
  startedAt?: string;
  reviewBaseSha?: string;
  originalHeadSha?: string;
  continuationPromptTemplate?: string;
  iteration?: number;
  label?: string;
  answerDigest?: string;
  previousDigest?: string;
  commitCreated?: boolean;
  commitSha?: string;
  commitParentSha?: string;
  commitSubject?: string;
  commitBody?: string;
  commitNote?: string;
  stopReason?: StopReason;
  originalBranchName?: string;
  scratchBranchName?: string;
  namingModel?: NamingModelConfig;
  finalization?: FinalizationResult;
}
