import { complete, type Message, type Model } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { ULTRATHINK_CONFIG_DISPLAY_PATH, saveUltrathinkNamingConfig } from "./config.js";
import type { GeneratedCommitMessage, NamingModelConfig, UltrathinkConfig } from "./types.js";

type GenerateBranchSlugArgs = {
  ctx: ExtensionContext;
  config: NamingModelConfig;
  promptText: string;
  existingBranchNames: string[];
};

type GenerateIterationCommitMessageArgs = {
  ctx: ExtensionContext;
  config: NamingModelConfig;
  promptText: string;
  iteration: number;
  assistantOutput: string;
  diffSummary: string;
  changedFiles: string[];
};

type GenerateMergeCommitMessageArgs = {
  ctx: ExtensionContext;
  config: NamingModelConfig;
  promptText: string;
  scratchBranchName: string;
  commits: Array<{ sha: string; subject: string; body: string }>;
  diffSummary: string;
};

type NamingTestOverrides = {
  ensureNamingModel?: (ctx: ExtensionCommandContext, config: UltrathinkConfig) => Promise<NamingModelConfig | null>;
  generateBranchSlug?: (args: GenerateBranchSlugArgs) => Promise<string>;
  generateIterationCommitMessage?: (args: GenerateIterationCommitMessageArgs) => Promise<GeneratedCommitMessage>;
  generateMergeCommitMessage?: (args: GenerateMergeCommitMessageArgs) => Promise<GeneratedCommitMessage>;
};

let testOverrides: NamingTestOverrides | undefined;

export function setNamingTestOverrides(overrides?: NamingTestOverrides): void {
  testOverrides = overrides;
}

function asText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error(`Expected JSON object from naming model, received: ${trimmed || "<empty response>"}`);
  }
}

function sanitizeSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeCommitMessage(message: GeneratedCommitMessage): GeneratedCommitMessage {
  const subject = message.subject.replace(/\s+/g, " ").trim();
  const body = message.body.trim();
  if (!subject) {
    throw new Error("Naming model returned an empty commit subject.");
  }
  if (!body) {
    throw new Error("Naming model returned an empty commit body.");
  }
  return { subject, body };
}

async function resolveNamingModel(ctx: ExtensionContext, config: NamingModelConfig): Promise<{ model: Model<any>; apiKey: string }> {
  const model = ctx.modelRegistry.find(config.provider, config.modelId);
  if (!model) {
    throw new Error(`Ultrathink naming model ${config.provider}/${config.modelId} is not available in Pi.`);
  }

  const apiKey = await ctx.modelRegistry.getApiKey(model);
  if (!apiKey) {
    throw new Error(`Ultrathink naming model ${config.provider}/${config.modelId} has no configured credentials.`);
  }

  return { model, apiKey };
}

async function runNamingCompletion<T>(
  ctx: ExtensionContext,
  config: NamingModelConfig,
  systemPrompt: string,
  userText: string,
): Promise<T> {
  const { model, apiKey } = await resolveNamingModel(ctx, config);
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: userText }],
      timestamp: Date.now(),
    },
  ];

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await complete(model, { systemPrompt, messages }, { apiKey, maxTokens: 800 });
      const text = asText(response);
      return parseJsonObject<T>(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`Ultrathink naming model failed to return valid JSON: ${lastError?.message ?? "unknown error"}`);
}

function formatModelOption(model: Model<any>): string {
  return `${model.provider}/${model.id}`;
}

function parseModelOption(value: string): NamingModelConfig {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`Invalid model option: ${value}`);
  }
  return {
    provider: value.slice(0, slash),
    modelId: value.slice(slash + 1),
  };
}

export async function ensureNamingModel(
  ctx: ExtensionCommandContext,
  config: UltrathinkConfig,
): Promise<NamingModelConfig | null> {
  if (testOverrides?.ensureNamingModel) {
    return testOverrides.ensureNamingModel(ctx, config);
  }

  if (config.naming) {
    await resolveNamingModel(ctx, config.naming);
    return config.naming;
  }

  if (!ctx.hasUI) {
    throw new Error(`Ultrathink needs a configured naming model in ${ULTRATHINK_CONFIG_DISPLAY_PATH} when no UI is available.`);
  }

  const availableModels = [...ctx.modelRegistry.getAvailable()]
    .filter((model) => model.input.includes("text"))
    .sort((a, b) => formatModelOption(a).localeCompare(formatModelOption(b)));

  if (availableModels.length === 0) {
    throw new Error("Ultrathink could not find any available Pi models to use for branch and commit naming.");
  }

  const selection = await ctx.ui.select(
    "Choose the small model Ultrathink should use for branch names and commit descriptions",
    availableModels.map(formatModelOption),
  );

  if (!selection) {
    return null;
  }

  const namingModel = parseModelOption(selection);
  await saveUltrathinkNamingConfig(namingModel);
  return namingModel;
}

export async function generateBranchSlug(args: GenerateBranchSlugArgs): Promise<string> {
  if (testOverrides?.generateBranchSlug) {
    return testOverrides.generateBranchSlug(args);
  }

  const response = await runNamingCompletion<{ slug: string }>(
    args.ctx,
    args.config,
    [
      "You generate short git branch slugs for software engineering work.",
      "Return strict JSON with exactly one key: slug.",
      "The slug must be 2 to 5 lowercase kebab-case words, descriptive, and must not include the ultrathink/ prefix.",
      "Do not include quotes outside JSON. Do not include explanations.",
    ].join(" "),
    [
      "Task type: branch-slug",
      `Original prompt:\n${args.promptText.trim()}`,
      args.existingBranchNames.length === 0
        ? "Existing local branches with ultrathink/ prefix: none"
        : `Existing local branches with ultrathink/ prefix:\n${args.existingBranchNames.join("\n")}`,
      "Return JSON now.",
    ].join("\n\n"),
  );

  const slug = sanitizeSlug(response.slug ?? "");
  if (!slug) {
    throw new Error("Naming model returned an empty branch slug.");
  }
  return slug;
}

export async function generateIterationCommitMessage(
  args: GenerateIterationCommitMessageArgs,
): Promise<GeneratedCommitMessage> {
  if (testOverrides?.generateIterationCommitMessage) {
    return testOverrides.generateIterationCommitMessage(args);
  }

  const response = await runNamingCompletion<GeneratedCommitMessage>(
    args.ctx,
    args.config,
    [
      "You write concise, high-signal git commit messages for code changes.",
      "Return strict JSON with exactly two keys: subject and body.",
      "The subject must be one line, imperative or descriptive, under 72 characters when possible.",
      "The body must explain what changed and why in plain language, using short bullet points when helpful.",
      "Do not mention that an AI wrote the message. Do not include markdown fences.",
    ].join(" "),
    [
      "Task type: iteration-commit",
      `Original prompt:\n${args.promptText.trim()}`,
      `Iteration: v${args.iteration}`,
      args.changedFiles.length === 0 ? "Changed files: none" : `Changed files:\n${args.changedFiles.join("\n")}`,
      `Diff summary:\n${args.diffSummary.trim() || "(no diff summary available)"}`,
      `Assistant output:\n${args.assistantOutput.trim() || "(empty assistant output)"}`,
      "Return JSON now.",
    ].join("\n\n"),
  );

  return normalizeCommitMessage(response);
}

export async function generateMergeCommitMessage(args: GenerateMergeCommitMessageArgs): Promise<GeneratedCommitMessage> {
  if (testOverrides?.generateMergeCommitMessage) {
    return testOverrides.generateMergeCommitMessage(args);
  }

  const commitText = args.commits
    .map((commit) => [`- ${commit.sha} ${commit.subject}`, commit.body].filter(Boolean).join("\n"))
    .join("\n\n");

  const response = await runNamingCompletion<GeneratedCommitMessage>(
    args.ctx,
    args.config,
    [
      "You write final merge commit messages that summarize a completed implementation branch.",
      "Return strict JSON with exactly two keys: subject and body.",
      "The subject must clearly describe the integrated outcome.",
      "The body must summarize the branch's main changes and why they matter, based on the provided commit history and diff summary.",
      "Do not mention that an AI wrote the message. Do not include markdown fences.",
    ].join(" "),
    [
      "Task type: merge-commit",
      `Original prompt:\n${args.promptText.trim()}`,
      `Scratch branch: ${args.scratchBranchName}`,
      `Scratch-branch commits:\n${commitText || "(none)"}`,
      `Combined diff summary:\n${args.diffSummary.trim() || "(no diff summary available)"}`,
      "Return JSON now.",
    ].join("\n\n"),
  );

  return normalizeCommitMessage(response);
}
