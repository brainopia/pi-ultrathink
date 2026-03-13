export type GitMode = "current-branch" | "scratch-branch" | "off";

export interface UltrathinkConfig {
  maxIterations: number;
  continuationPromptTemplate: string;
  commitBodyMaxChars?: number;
  git: {
    mode: GitMode;
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

export interface IterationRecord {
  iteration: number;
  label: string;
  answerDigest: string;
  previousDigest?: string;
  stableRepeats: number;
  commitCreated: boolean;
  commitSha?: string;
  commitParentSha?: string;
  stopReason?: StopReason;
  commitNote?: string;
}

export interface ActiveRun {
  runId: string;
  originalPromptText: string;
  iteration: number;
  maxIterations: number;
  stableRepeats: number;
  previousDigest?: string;
  reviewBaseSha?: string;
  originalBranchName?: string;
  currentBranchName?: string;
  gitMode: GitMode;
  commitsEnabled: boolean;
  awaitingExtensionFollowUp: boolean;
  expectedPromptText?: string;
  cancelRequested?: "user";
  continuationPromptTemplate: string;
  commitBodyMaxChars?: number;
  preflightGitFailure?: string;
  gitBaseline?: GitSnapshot;
  iterations: IterationRecord[];
  startedAt: string;
}

export interface PrepareGitRunResult {
  originalBranchName?: string;
  currentBranchName?: string;
  commitsEnabled: boolean;
  baseline?: GitSnapshot;
  failureReason?: string;
}

export interface CommitIterationResult {
  commitCreated: boolean;
  commitSha?: string;
  commitParentSha?: string;
  noCommitReason?: string;
}

export interface UltrathinkStateEntry {
  kind: "start" | "iteration" | "stop";
  runId: string;
  promptText?: string;
  startedAt?: string;
  reviewBaseSha?: string;
  continuationPromptTemplate?: string;
  iteration?: number;
  label?: string;
  answerDigest?: string;
  previousDigest?: string;
  stableRepeats?: number;
  commitCreated?: boolean;
  commitSha?: string;
  commitParentSha?: string;
  commitNote?: string;
  stopReason?: StopReason;
  originalBranchName?: string;
  currentBranchName?: string;
}
