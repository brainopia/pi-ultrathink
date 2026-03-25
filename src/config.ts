import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONTINUATION_PROMPT_TEMPLATE } from "./promptTemplate.js";
import type { NamingModelConfig, OracleConfig, UltrathinkConfig } from "./types.js";

export const ULTRATHINK_CONFIG_DISPLAY_PATH = "~/.pi/ultrathink.json";
export const ULTRATHINK_CONFIG_PATH_ENV = "PI_ULTRATHINK_CONFIG_PATH";

export const DEFAULT_CONFIG: UltrathinkConfig = {
  maxIterations: 4,
  continuationPromptTemplate: DEFAULT_CONTINUATION_PROMPT_TEMPLATE,
  commitBodyMaxChars: 4000,
  git: {
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


function parseNamingModel(value: unknown): NamingModelConfig {
  if (!isObject(value)) {
    throw new Error("naming must be a JSON object when provided.");
  }

  if (typeof value.provider !== "string" || value.provider.trim() === "") {
    throw new Error("naming.provider must be a non-empty string.");
  }

  if (typeof value.modelId !== "string" || value.modelId.trim() === "") {
    throw new Error("naming.modelId must be a non-empty string.");
  }

  return {
    provider: value.provider.trim(),
    modelId: value.modelId.trim(),
  };
}

function parseOracleConfig(value: unknown): OracleConfig {
  if (!isObject(value)) {
    throw new Error("oracle must be a JSON object when provided.");
  }

  const result: OracleConfig = {};

  if (value.provider !== undefined) {
    if (typeof value.provider !== "string" || value.provider.trim() === "") {
      throw new Error("oracle.provider must be a non-empty string.");
    }
    result.provider = value.provider.trim();
  }

  if (value.modelId !== undefined) {
    if (typeof value.modelId !== "string" || value.modelId.trim() === "") {
      throw new Error("oracle.modelId must be a non-empty string.");
    }
    result.modelId = value.modelId.trim();
  }

  if (value.thinkingLevel !== undefined) {
    if (typeof value.thinkingLevel !== "string" || value.thinkingLevel.trim() === "") {
      throw new Error("oracle.thinkingLevel must be a non-empty string.");
    }
    result.thinkingLevel = value.thinkingLevel.trim();
  }

  if (value.systemPromptTemplate !== undefined) {
    if (typeof value.systemPromptTemplate !== "string") {
      throw new Error("oracle.systemPromptTemplate must be a string.");
    }
    result.systemPromptTemplate = value.systemPromptTemplate;
  }

  if (value.maxRounds !== undefined) {
    result.maxRounds = parsePositiveInteger(value.maxRounds, "oracle.maxRounds");
  }

  return result;
}

export function getUltrathinkConfigPath(): string {
  const override = process.env[ULTRATHINK_CONFIG_PATH_ENV]?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".pi", "ultrathink.json");
}

async function readRawConfig(): Promise<Record<string, unknown> | undefined> {
  const configPath = getUltrathinkConfigPath();
  try {
    await access(configPath);
  } catch {
    return undefined;
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`${ULTRATHINK_CONFIG_DISPLAY_PATH} must contain a JSON object.`);
  }

  return parsed;
}

export async function loadUltrathinkConfig(): Promise<UltrathinkConfig> {
  const parsed = await readRawConfig();
  if (!parsed) {
    return structuredClone(DEFAULT_CONFIG);
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
    naming: parsed.naming === undefined ? undefined : parseNamingModel(parsed.naming),
    oracle: parsed.oracle === undefined ? undefined : parseOracleConfig(parsed.oracle),
    git: {
      allowDirty:
        gitInput?.allowDirty === undefined
          ? DEFAULT_CONFIG.git.allowDirty
          : parseBoolean(gitInput.allowDirty, "git.allowDirty"),
    },
  };
}

export async function saveUltrathinkNamingConfig(naming: NamingModelConfig): Promise<void> {
  const configPath = getUltrathinkConfigPath();
  const raw = (await readRawConfig()) ?? {};
  raw.naming = {
    provider: naming.provider,
    modelId: naming.modelId,
  };

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}
