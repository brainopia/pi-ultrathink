import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadUltrathinkConfig } from "./config.js";
import {
  NO_REPOSITORY_CHANGES_NOTE,
  captureGitSnapshot,
  commitIterationIfChanged,
  prepareGitRun,
} from "./git.js";
import { buildReviewPrompt, computeAnswerDigest, decideStop } from "./review.js";
import { createActiveRun, createRunId, persistIteration, persistRunStart, persistStop } from "./state.js";
import type { ActiveRun, IterationRecord, StopReason } from "./types.js";
import { promptForContinuationTemplate, sendCompletionMessage, setUltrathinkStatus } from "./ui.js";

type AssistantLike = {
  role: "assistant";
  content: Array<{ type: string; text?: string }>;
  stopReason?: string;
};

type UserLike = {
  role: "user";
  content: string | Array<{ type: string; text?: string }>;
};

type AgentMessageLike = {
  role: string;
  content?: unknown;
  stopReason?: string;
};

type SessionMessageEntryLike = {
  type: "message";
  id: string;
  message: AgentMessageLike;
};

function isAssistantMessage(message: AgentMessageLike): message is AssistantLike {
  return message.role === "assistant" && Array.isArray(message.content);
}

function isUserMessage(message: AgentMessageLike): message is UserLike {
  return message.role === "user";
}

function getAssistantText(message: AssistantLike): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function getPromptText(message: UserLike): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function getAgentPromptText(messages: AgentMessageLike[]): string | undefined {
  const userMessage = messages.find(isUserMessage);
  return userMessage ? getPromptText(userMessage) : undefined;
}

function getLastAssistant(messages: AgentMessageLike[]): AssistantLike | undefined {
  return [...messages].reverse().find(isAssistantMessage);
}

function getLeafAssistantEntryId(ctx: ExtensionContext): string | undefined {
  const leaf = ctx.sessionManager.getLeafEntry() as SessionMessageEntryLike | undefined;
  if (!leaf || leaf.type !== "message") return undefined;
  if (!isAssistantMessage(leaf.message)) return undefined;
  return leaf.id;
}

export default function ultrathinkExtension(pi: ExtensionAPI): void {
  let activeRun: ActiveRun | undefined;

  function clearRunState(ctx: ExtensionContext): void {
    activeRun = undefined;
    setUltrathinkStatus(ctx, undefined);
  }

  function finishRun(ctx: ExtensionContext, stopReason: StopReason): void {
    const run = activeRun;
    if (!run) return;

    const lastIteration = run.iterations.at(-1);
    if (lastIteration && !lastIteration.stopReason) {
      lastIteration.stopReason = stopReason;
    }

    persistStop(pi, run, stopReason);
    sendCompletionMessage(pi, { run, stopReason, iterations: run.iterations });
    clearRunState(ctx);
  }

  async function startRun(promptText: string, ctx: ExtensionCommandContext): Promise<void> {
    if (activeRun) {
      finishRun(ctx, "cancelled-by-user");
    }

    if (!ctx.isIdle()) {
      ctx.abort();
      await ctx.waitForIdle();
    }

    const config = await loadUltrathinkConfig(ctx.cwd);
    const continuationPromptTemplate = await promptForContinuationTemplate(ctx, config.continuationPromptTemplate);
    if (continuationPromptTemplate === null) {
      ctx.ui.notify("Ultrathink start cancelled.", "info");
      return;
    }

    const runId = createRunId();
    const gitSetup = await prepareGitRun({
      cwd: ctx.cwd,
      runId,
      mode: config.git.mode,
      allowDirty: config.git.allowDirty,
      exec: pi.exec,
    });

    activeRun = createActiveRun({
      runId,
      promptText,
      config,
      continuationPromptTemplate,
      originalBranchName: gitSetup.originalBranchName,
      currentBranchName: gitSetup.currentBranchName,
      commitsEnabled: gitSetup.commitsEnabled,
      preflightGitFailure: gitSetup.failureReason,
      reviewBaseSha: gitSetup.baseline?.head ?? undefined,
    });
    activeRun.gitBaseline = gitSetup.baseline;

    persistRunStart(pi, activeRun);
    setUltrathinkStatus(ctx, activeRun);
    pi.sendUserMessage(promptText);
  }

  pi.registerCommand("ultrathink", {
    description: "Run a prompt and continue only while each iteration still changes git-tracked work",
    handler: async (args, ctx) => {
      const promptText = args.trim();
      if (!promptText) {
        ctx.ui.notify("Usage: /ultrathink <prompt>", "warning");
        return;
      }

      await startRun(promptText, ctx);
    },
  });


  pi.on("session_start", async (_event, ctx) => {
    clearRunState(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (!activeRun) {
      return { action: "continue" };
    }

    if (event.source === "extension") {
      activeRun.awaitingExtensionFollowUp = false;
      return { action: "continue" };
    }

    activeRun.cancelRequested = "user";
    activeRun.awaitingExtensionFollowUp = false;

    if (ctx.isIdle()) {
      finishRun(ctx, "cancelled-by-user");
    }

    return { action: "continue" };
  });

  pi.on("agent_end", async (event, ctx) => {
    const run = activeRun;
    if (!run) return;

    const promptText = getAgentPromptText(event.messages);
    if (!promptText || promptText !== run.expectedPromptText) {
      return;
    }

    const assistantMessage = getLastAssistant(event.messages);
    if (!assistantMessage) {
      return;
    }

    if (assistantMessage.stopReason === "aborted") {
      finishRun(ctx, "cancelled-by-interrupt");
      return;
    }

    const assistantText = getAssistantText(assistantMessage);
    const answerDigest = computeAnswerDigest(assistantText);
    const previousDigest = run.previousDigest;
    run.iteration += 1;

    if (previousDigest === answerDigest) {
      run.stableRepeats += 1;
    } else {
      run.stableRepeats = 0;
    }
    run.previousDigest = answerDigest;

    let commitCreated = false;
    let commitSha: string | undefined;
    let commitParentSha: string | undefined;
    let commitNote: string | undefined;
    let stopReason: StopReason | null = null;

    if (run.preflightGitFailure) {
      commitNote = run.preflightGitFailure;
      stopReason = "git-error";
    } else if (!run.commitsEnabled) {
      commitNote = "git-backed iteration tracking was unavailable for this run";
      stopReason = "git-error";
    } else {
      try {
        const commitResult = await commitIterationIfChanged({
          cwd: ctx.cwd,
          runId: run.runId,
          iteration: run.iteration,
          assistantOutput: assistantText,
          mode: run.gitMode,
          commitBodyMaxChars: run.commitBodyMaxChars,
          exec: pi.exec,
        });
        commitCreated = commitResult.commitCreated;
        commitSha = commitResult.commitSha;
        commitParentSha = commitResult.commitParentSha;
        commitNote = commitResult.noCommitReason;
        run.gitBaseline = await captureGitSnapshot(pi.exec, ctx.cwd);
      } catch (error) {
        commitNote = error instanceof Error ? error.message : String(error);
        stopReason = "git-error";
      }
    }

    if (!stopReason) {
      if (run.cancelRequested === "user") {
        stopReason = "cancelled-by-user";
      } else {
        stopReason = decideStop({
          iteration: run.iteration,
          maxIterations: run.maxIterations,
          noGitChangesDetected: !commitCreated && commitNote === NO_REPOSITORY_CHANGES_NOTE,
        });
      }
    }

    const record: IterationRecord = {
      iteration: run.iteration,
      label: `v${run.iteration}`,
      answerDigest,
      previousDigest,
      stableRepeats: run.stableRepeats,
      commitCreated,
      commitSha,
      commitParentSha,
      commitNote,
      stopReason: stopReason ?? undefined,
    };

    run.iterations.push(record);
    persistIteration(pi, run, record);

    const assistantEntryId = getLeafAssistantEntryId(ctx);
    if (assistantEntryId) {
      pi.setLabel(assistantEntryId, `ultrathink:${record.label}`);
    }

    if (stopReason) {
      finishRun(ctx, stopReason);
      return;
    }

    if (!commitSha) {
      record.stopReason = "git-error";
      finishRun(ctx, "git-error");
      return;
    }

    const reviewPrompt = buildReviewPrompt({
      template: run.continuationPromptTemplate,
      originalPromptText: run.originalPromptText,
      reviewBaseSha: run.reviewBaseSha,
    });

    run.awaitingExtensionFollowUp = true;
    run.expectedPromptText = reviewPrompt;
    setUltrathinkStatus(ctx, run);
    if (ctx.isIdle()) {
      pi.sendUserMessage(reviewPrompt);
    } else {
      pi.sendUserMessage(reviewPrompt, { deliverAs: "followUp" });
    }
  });
}
