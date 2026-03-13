import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONTINUATION_PROMPT_TEMPLATE } from "./promptTemplate.js";
import type { UltrathinkConfig } from "./types.js";

export const ULTRATHINK_CONFIG_PATH = path.join(".pi", "ultrathink.json");

export const DEFAULT_CONFIG: UltrathinkConfig = {
  maxIterations: 4,
  continuationPromptTemplate: DEFAULT_CONTINUATION_PROMPT_TEMPLATE,
  commitBodyMaxChars: 4000,
  git: {
    mode: "current-branch",
    allowDirty: false,
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return parsePositiveInteger(value, field);
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function parseGitMode(value: unknown): UltrathinkConfig["git"]["mode"] {
  if (value === "current-branch" || value === "scratch-branch" || value === "off") {
    return value;
  }
  throw new Error('git.mode must be "current-branch", "scratch-branch", or "off".');
}

export async function loadUltrathinkConfig(cwd: string): Promise<UltrathinkConfig> {
  const configPath = path.join(cwd, ULTRATHINK_CONFIG_PATH);
  try {
    await access(configPath);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`${ULTRATHINK_CONFIG_PATH} must contain a JSON object.`);
  }

  const gitInput = parsed.git;
  if (gitInput !== undefined && !isObject(gitInput)) {
    throw new Error("git must be a JSON object when provided.");
  }

  const continuationPromptTemplateInput =
    parsed.continuationPromptTemplate ?? parsed.reviewPrompt ?? DEFAULT_CONFIG.continuationPromptTemplate;

  if (typeof continuationPromptTemplateInput !== "string") {
    throw new Error("continuationPromptTemplate must be a string when provided.");
  }

  return {
    maxIterations:
      parsed.maxIterations === undefined
        ? DEFAULT_CONFIG.maxIterations
        : parsePositiveInteger(parsed.maxIterations, "maxIterations"),
    continuationPromptTemplate: continuationPromptTemplateInput,
    commitBodyMaxChars:
      parsed.commitBodyMaxChars === undefined
        ? DEFAULT_CONFIG.commitBodyMaxChars
        : parseOptionalPositiveInteger(parsed.commitBodyMaxChars, "commitBodyMaxChars"),
    git: {
      mode: gitInput?.mode === undefined ? DEFAULT_CONFIG.git.mode : parseGitMode(gitInput.mode),
      allowDirty:
        gitInput?.allowDirty === undefined
          ? DEFAULT_CONFIG.git.allowDirty
          : parseBoolean(gitInput.allowDirty, "git.allowDirty"),
    },
  };
}
