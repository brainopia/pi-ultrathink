export interface NamingModelConfig {
  provider: string;
  modelId: string;
}

export interface GeneratedCommitMessage {
  subject: string;
  body: string;
}

export interface OracleConfig {
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  systemPromptTemplate?: string;
  maxRounds?: number;
}

export interface UltrathinkConfig {
  maxIterations: number;
  continuationPromptTemplate: string;
  commitBodyMaxChars?: number;
  naming?: NamingModelConfig;
  oracle?: OracleConfig;
}

export type StopReason =
  | "no-git-changes"
  | "max-iterations"
  | "git-error"
  | "cancelled-by-user"
  | "cancelled-by-interrupt"
  | "oracle-accepted"
  | "oracle-max-rounds";

export interface GitSnapshot {
  repoExists: boolean;
  head: string | null;
  status: string;
}

export type GitRunKind = "task" | "review";
export type ReviewSource = "dirty-bootstrap" | "last-pushed" | "first-unique";

export interface ReviewCommitSummary {
  sha: string;
  subject: string;
}

export interface ReviewCommitDetails extends ReviewCommitSummary {
  body: string;
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
  mode: "git" | "oracle";
  gitRunKind?: GitRunKind;
  runId: string;
  originalPromptText: string;
  iteration: number;
  maxIterations: number;
  previousDigest?: string;
  reviewBaseSha?: string;
  reviewSource?: ReviewSource;
  reviewStartSha?: string;
  reviewExclusiveBaseSha?: string;
  reviewCommits?: ReviewCommitSummary[];
  seedScratchCommits?: ReviewCommitDetails[];
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
  /** Oracle-mode fields */
  oracleRound?: number;
  oracleMaxRounds?: number;
  oracleAcceptSummary?: string;
}

export interface PrepareScratchBranchRunResult {
  originalBranchName: string;
  originalHeadSha: string;
  scratchBranchName: string;
  baseline: GitSnapshot;
}

export interface PrepareReviewRunResult extends PrepareScratchBranchRunResult {
  reviewSource: ReviewSource;
  reviewStartSha: string;
  reviewExclusiveBaseSha: string;
  reviewCommits: ReviewCommitSummary[];
  seedScratchCommits?: ReviewCommitDetails[];
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
  gitRunKind?: GitRunKind;
  reviewBaseSha?: string;
  reviewSource?: ReviewSource;
  reviewStartSha?: string;
  reviewExclusiveBaseSha?: string;
  reviewCommits?: ReviewCommitSummary[];
  seedScratchCommits?: ReviewCommitDetails[];
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
