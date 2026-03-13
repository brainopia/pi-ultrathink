import { createHash } from "node:crypto";
import { DEFAULT_CONTINUATION_PROMPT_TEMPLATE } from "./promptTemplate.js";
import type { StopReason } from "./types.js";
export function buildReviewPrompt(args: {
  template: string;
  originalPromptText: string;
  reviewBaseSha?: string;
}): string {
  const promptBody = args.template.trim() || DEFAULT_CONTINUATION_PROMPT_TEMPLATE;
  const diffCommand = args.reviewBaseSha ? `git diff ${args.reviewBaseSha} HEAD` : "git diff HEAD^ HEAD";

  return [
    "Original task:",
    args.originalPromptText.trim(),
    "",
    "Review the current repository changes with:",
    `\`${diffCommand}\``,
    "",
    promptBody,
  ]
    .filter((section, index, all) => !(section === "" && all[index - 1] === ""))
    .join("\n")
    .trim();
}

export function normalizeAnswer(text: string): string {
  const normalizedNewlines = text.replace(/\r\n?/g, "\n");
  const trimmedLines = normalizedNewlines.split("\n").map((line) => line.replace(/[\t ]+$/g, ""));

  while (trimmedLines.length > 0 && trimmedLines[0] === "") {
    trimmedLines.shift();
  }
  while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1] === "") {
    trimmedLines.pop();
  }

  return trimmedLines.join("\n");
}

export function computeAnswerDigest(text: string): string {
  const normalized = normalizeAnswer(text);
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

export function decideStop(args: {
  iteration: number;
  maxIterations: number;
  noGitChangesDetected: boolean;
}): StopReason | null {
  if (args.noGitChangesDetected) {
    return "no-git-changes";
  }

  if (args.iteration >= args.maxIterations) {
    return "max-iterations";
  }

  return null;
}
