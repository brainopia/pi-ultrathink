import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ActiveRun, FinalizationResult, IterationRecord, StopReason } from "./types.js";
import { sendCompletionMessage, setUltrathinkStatus } from "./ui.js";

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

let configModulePromise: Promise<typeof import("./config.js")> | undefined;
let gitModulePromise: Promise<typeof import("./git.js")> | undefined;
let namingModulePromise: Promise<typeof import("./naming.js")> | undefined;
let promptEditorModulePromise: Promise<typeof import("./promptEditor.js")> | undefined;
let reviewModulePromise: Promise<typeof import("./review.js")> | undefined;
let stateModulePromise: Promise<typeof import("./state.js")> | undefined;

function loadConfigModule(): Promise<typeof import("./config.js")> {
  return (configModulePromise ??= import("./config.js"));
}

function loadGitModule(): Promise<typeof import("./git.js")> {
  return (gitModulePromise ??= import("./git.js"));
}

function loadNamingModule(): Promise<typeof import("./naming.js")> {
  return (namingModulePromise ??= import("./naming.js"));
}

function loadPromptEditorModule(): Promise<typeof import("./promptEditor.js")> {
  return (promptEditorModulePromise ??= import("./promptEditor.js"));
}

function loadReviewModule(): Promise<typeof import("./review.js")> {
  return (reviewModulePromise ??= import("./review.js"));
}

function loadStateModule(): Promise<typeof import("./state.js")> {
  return (stateModulePromise ??= import("./state.js"));
}

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

function isNormalCompletion(stopReason: StopReason): boolean {
  return stopReason === "no-git-changes" || stopReason === "max-iterations";
}

function createPreservedFinalization(run: ActiveRun, stopReason: StopReason): FinalizationResult {
  return {
    mode: "preserved",
    success: false,
    scratchBranchDeleted: false,
    error: run.scratchBranchName
      ? `Automatic reintegration was skipped because the run ended with ${stopReason}; scratch branch ${run.scratchBranchName} was preserved.`
      : `Automatic reintegration was skipped because the run ended with ${stopReason}.`,
  };
}

export default function ultrathinkExtension(pi: ExtensionAPI): void {
  let activeRun: ActiveRun | undefined;

  function clearRunState(ctx: ExtensionContext): void {
    activeRun = undefined;
    setUltrathinkStatus(ctx, undefined);
  }

  async function finalizeRunIfNeeded(ctx: ExtensionContext, run: ActiveRun, stopReason: StopReason): Promise<void> {
    if (!run.originalBranchName || !run.scratchBranchName) {
      return;
    }

    if (!isNormalCompletion(stopReason)) {
      run.finalization = createPreservedFinalization(run, stopReason);
      return;
    }

    try {
      const gitModule = await loadGitModule();

      const actualCommitCount = await gitModule.countCommitsBetween({
        exec: pi.exec,
        cwd: ctx.cwd,
        fromRef: run.originalBranchName,
        toRef: run.scratchBranchName,
      });

      let mergeCommitMessage:
        | {
            subject: string;
            body: string;
          }
        | undefined;

      if (actualCommitCount > 1 && run.namingModel && run.originalHeadSha) {
        const namingModule = await loadNamingModule();
        const branchDiff = await gitModule.describeCommitRange({
          cwd: ctx.cwd,
          exec: pi.exec,
          fromRef: run.originalHeadSha,
          toRef: run.scratchBranchName,
        });
        const committedIterations = run.iterations.filter(
          (iteration) => iteration.commitCreated && iteration.commitSha && iteration.commitSubject && iteration.commitBody,
        );
        mergeCommitMessage = await namingModule.generateMergeCommitMessage({
          ctx,
          config: run.namingModel,
          promptText: run.originalPromptText,
          scratchBranchName: run.scratchBranchName,
          commits: committedIterations.map((iteration) => ({
            sha: iteration.commitSha!,
            subject: iteration.commitSubject!,
            body: iteration.commitBody!,
          })),
          diffSummary: branchDiff.diffSummary,
        });
      }

      run.finalization = await gitModule.finalizeScratchBranchRun({
        cwd: ctx.cwd,
        exec: pi.exec,
        originalBranchName: run.originalBranchName,
        scratchBranchName: run.scratchBranchName,
        mergeCommitMessage,
        commitBodyMaxChars: run.commitBodyMaxChars,
      });
    } catch (error) {
      run.finalization = {
        mode: "preserved",
        success: false,
        scratchBranchDeleted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function finishRun(ctx: ExtensionContext, stopReason: StopReason): Promise<void> {
    const run = activeRun;
    if (!run) return;

    const lastIteration = run.iterations.at(-1);
    if (lastIteration && !lastIteration.stopReason) {
      lastIteration.stopReason = stopReason;
    }

    await finalizeRunIfNeeded(ctx, run, stopReason);
    const { persistStop } = await loadStateModule();
    persistStop(pi, run, stopReason);
    sendCompletionMessage(pi, { run, stopReason, iterations: run.iterations });
    clearRunState(ctx);
  }

  async function startRun(promptText: string, ctx: ExtensionCommandContext): Promise<void> {
    if (activeRun) {
      await finishRun(ctx, "cancelled-by-user");
    }

    if (!ctx.isIdle()) {
      ctx.abort();
      await ctx.waitForIdle();
    }

    const promptEditorPromise = ctx.hasUI ? loadPromptEditorModule() : undefined;
    const [{ loadUltrathinkConfig }, gitModule, namingModule, stateModule] = await Promise.all([
      loadConfigModule(),
      loadGitModule(),
      loadNamingModule(),
      loadStateModule(),
    ]);

    const config = await loadUltrathinkConfig();
    const continuationPromptTemplate = promptEditorPromise
      ? await (await promptEditorPromise).promptForContinuationTemplate(ctx, config.continuationPromptTemplate)
      : config.continuationPromptTemplate;
    if (continuationPromptTemplate === null) {
      ctx.ui.notify("Ultrathink start cancelled.", "info");
      return;
    }

    let namingModel;
    try {
      namingModel = await namingModule.ensureNamingModel(ctx, config);
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    if (!namingModel) {
      ctx.ui.notify("Ultrathink start cancelled.", "info");
      return;
    }

    const runId = stateModule.createRunId();
    let gitSetup;
    try {
      gitSetup = await gitModule.prepareScratchBranchRun({
        cwd: ctx.cwd,
        exec: pi.exec,
        generateBranchSlug: async (existingBranchNames) =>
          await namingModule.generateBranchSlug({
            ctx,
            config: namingModel,
            promptText,
            existingBranchNames: existingBranchNames.filter((branchName) => branchName.startsWith("ultrathink/")),
          }),
      });
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      return;
    }

    activeRun = stateModule.createActiveRun({
      runId,
      promptText,
      config,
      continuationPromptTemplate,
      namingModel,
      originalHeadSha: gitSetup.originalHeadSha,
      reviewBaseSha: gitSetup.originalHeadSha,
      originalBranchName: gitSetup.originalBranchName,
      scratchBranchName: gitSetup.scratchBranchName,
    });
    activeRun.gitBaseline = gitSetup.baseline;

    stateModule.persistRunStart(pi, activeRun);
    setUltrathinkStatus(ctx, activeRun);
    pi.sendUserMessage(promptText);
  }

  pi.registerCommand("ultrathink", {
    description: "Run a prompt in an Ultrathink scratch branch and continue only while each iteration still changes git-tracked work",
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
      await finishRun(ctx, "cancelled-by-user");
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
      await finishRun(ctx, "cancelled-by-interrupt");
      return;
    }

    const assistantText = getAssistantText(assistantMessage);
    const [reviewModule, gitModule, namingModule, stateModule] = await Promise.all([
      loadReviewModule(),
      loadGitModule(),
      loadNamingModule(),
      loadStateModule(),
    ]);
    const { buildReviewPrompt, computeAnswerDigest, decideStop } = reviewModule;
    const { NO_REPOSITORY_CHANGES_NOTE, captureGitSnapshot, commitPreparedIteration, getHeadCommitInfo, prepareIterationCommit } = gitModule;
    const { persistIteration } = stateModule;
    const answerDigest = computeAnswerDigest(assistantText);
    const previousDigest = run.previousDigest;
    run.iteration += 1;

    run.previousDigest = answerDigest;

    let commitCreated = false;
    let commitSha: string | undefined;
    let commitParentSha: string | undefined;
    let commitSubject: string | undefined;
    let commitBody: string | undefined;
    let commitNote: string | undefined;
    let stopReason: StopReason | null = null;

    try {
      const pendingCommit = await prepareIterationCommit({
        cwd: ctx.cwd,
        exec: pi.exec,
        baselineHead: run.gitBaseline?.head ?? undefined,
      });

      if (pendingCommit.agentCommitted) {
        // Agent committed changes directly — record the HEAD commit info
        const headInfo = await getHeadCommitInfo({ exec: pi.exec, cwd: ctx.cwd });
        commitCreated = true;
        commitSha = headInfo.sha;
        commitParentSha = headInfo.parentSha;
        commitSubject = headInfo.subject || `ultrathink iteration ${run.iteration}`;
        commitBody = headInfo.body || "Agent committed changes directly";
        commitNote = "agent committed changes directly";
        run.gitBaseline = await captureGitSnapshot(pi.exec, ctx.cwd);
      } else if (!pendingCommit.readyToCommit) {
        commitNote = pendingCommit.noCommitReason;
      } else if (!run.namingModel) {
        commitNote = "Ultrathink naming model was unavailable during commit creation";
        stopReason = "git-error";
      } else {
        const generatedCommit = await namingModule.generateIterationCommitMessage({
          ctx,
          config: run.namingModel,
          promptText: run.originalPromptText,
          iteration: run.iteration,
          assistantOutput: assistantText,
          diffSummary: pendingCommit.diffSummary,
          changedFiles: pendingCommit.changedFiles,
        });
        const commitResult = await commitPreparedIteration({
          cwd: ctx.cwd,
          subject: generatedCommit.subject,
          body: generatedCommit.body,
          commitBodyMaxChars: run.commitBodyMaxChars,
          exec: pi.exec,
        });
        commitCreated = commitResult.commitCreated;
        commitSha = commitResult.commitSha;
        commitParentSha = commitResult.commitParentSha;
        commitSubject = commitResult.commitSubject;
        commitBody = commitResult.commitBody;
        commitNote = commitResult.noCommitReason;
        run.gitBaseline = await captureGitSnapshot(pi.exec, ctx.cwd);
      }
    } catch (error) {
      commitNote = error instanceof Error ? error.message : String(error);
      stopReason = "git-error";
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
      commitCreated,
      commitSha,
      commitParentSha,
      commitSubject,
      commitBody,
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
      await finishRun(ctx, stopReason);
      return;
    }

    if (!commitSha) {
      record.stopReason = "git-error";
      await finishRun(ctx, "git-error");
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
