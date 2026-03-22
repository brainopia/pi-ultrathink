import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";

export interface DemoStep {
  answer: string;
  change?: {
    path: string;
    content: string;
  };
}

const demoApplyChangeSchema = Type.Object({
  path: Type.String({ description: "Repository-relative file path" }),
  content: Type.String({ description: "Full file content to write" }),
});

type DemoApplyChangeInput = Static<typeof demoApplyChangeSchema>;

export const DEMO_CODING_MODEL = {
  provider: "ultrathink-demo",
  id: "scripted",
  api: "openai-completions",
  name: "Ultrathink Demo Scripted",
  reasoning: false,
  input: ["text"] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
  baseUrl: "https://ultrathink-demo.invalid",
};

export const DEMO_METADATA_MODEL = {
  provider: "ultrathink-demo",
  id: "metadata",
  api: "openai-completions",
  name: "Ultrathink Demo Metadata",
  reasoning: false,
  input: ["text"] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 2_048,
  baseUrl: "https://ultrathink-demo.invalid",
};

function createBaseAssistant(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function getLastUserText(context: Context): string {
  const message = [...context.messages].reverse().find((entry) => entry.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function streamTextResponse(model: Model<any>, text: string, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output = createBaseAssistant(model);
    stream.push({ type: "start", partial: output });
    try {
      output.content.push({ type: "text", text: "" });
      const contentIndex = output.content.length - 1;
      stream.push({ type: "text_start", contentIndex, partial: output });
      const textBlock = output.content[contentIndex];
      if (textBlock.type !== "text") {
        throw new Error("Unexpected content block type while building scripted text response.");
      }
      textBlock.text = text;
      stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
      stream.push({ type: "text_end", contentIndex, content: text, partial: output });
      output.stopReason = "stop";
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

function streamScriptedProvider(
  steps: DemoStep[],
  state: { iteration: number },
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output = createBaseAssistant(model);
    stream.push({ type: "start", partial: output });

    try {
      const step = steps[state.iteration];
      if (!step) {
        throw new Error(`No scripted step available for iteration ${state.iteration + 1}`);
      }

      const lastMessage = context.messages[context.messages.length - 1] as { role?: string } | undefined;
      if (lastMessage?.role !== "toolResult" && step.change) {
        const toolCall = {
          type: "toolCall" as const,
          id: `demo_change_${state.iteration + 1}`,
          name: "demo_apply_change",
          arguments: {
            path: step.change.path,
            content: step.change.content,
          },
        };
        output.content.push(toolCall);
        const contentIndex = output.content.length - 1;
        stream.push({ type: "toolcall_start", contentIndex, partial: output });
        stream.push({
          type: "toolcall_delta",
          contentIndex,
          delta: JSON.stringify(toolCall.arguments),
          partial: output,
        });
        stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
        output.stopReason = "toolUse";
        stream.push({ type: "done", reason: "toolUse", message: output });
        stream.end();
        return;
      }

      output.content.push({ type: "text", text: "" });
      const contentIndex = output.content.length - 1;
      stream.push({ type: "text_start", contentIndex, partial: output });
      const textBlock = output.content[contentIndex];
      if (textBlock.type !== "text") {
        throw new Error("Unexpected content block type while building scripted text response.");
      }
      textBlock.text = step.answer;
      stream.push({ type: "text_delta", contentIndex, delta: step.answer, partial: output });
      stream.push({ type: "text_end", contentIndex, content: step.answer, partial: output });
      output.stopReason = "stop";
      state.iteration += 1;
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

function streamMetadataProvider(model: Model<any>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const prompt = getLastUserText(context);
  const iterationMatch = prompt.match(/Iteration:\s*v(\d+)/i);
  const changedFileMatch = prompt.match(/Changed files:\n([^\n]+)/i);
  let response = '{"subject":"Ultrathink metadata fallback","body":"- No metadata task recognized."}';

  if (prompt.includes("Task type: branch-slug")) {
    response = '{"slug":"demo-git-branching"}';
  } else if (prompt.includes("Task type: iteration-commit")) {
    const iteration = iterationMatch?.[1] ?? "1";
    const changedFile = changedFileMatch?.[1]?.trim() ?? "repo";
    response = JSON.stringify({
      subject: `Demo iteration ${iteration} updates ${changedFile}`,
      body: `- Update ${changedFile}.\n- Keep Ultrathink moving toward a stable result.`,
    });
  } else if (prompt.includes("Task type: merge-commit")) {
    response = JSON.stringify({
      subject: "Merge demo Ultrathink branch",
      body: "- Integrate the scratch-branch work.\n- Preserve the detailed side history while keeping the main branch readable.",
    });
  }

  return streamTextResponse(model, response, options);
}

export function createScriptedProviderExtension(steps: DemoStep[]): ExtensionFactory {
  const state = { iteration: 0 };
  return (pi) => {
    pi.registerProvider(DEMO_CODING_MODEL.provider, {
      baseUrl: "https://ultrathink-demo.invalid",
      apiKey: "ultrathink-demo-key",
      api: DEMO_CODING_MODEL.api,
      models: [
        {
          id: DEMO_CODING_MODEL.id,
          name: DEMO_CODING_MODEL.name,
          reasoning: DEMO_CODING_MODEL.reasoning,
          input: [...DEMO_CODING_MODEL.input],
          cost: { ...DEMO_CODING_MODEL.cost },
          contextWindow: DEMO_CODING_MODEL.contextWindow,
          maxTokens: DEMO_CODING_MODEL.maxTokens,
        },
        {
          id: DEMO_METADATA_MODEL.id,
          name: DEMO_METADATA_MODEL.name,
          reasoning: DEMO_METADATA_MODEL.reasoning,
          input: [...DEMO_METADATA_MODEL.input],
          cost: { ...DEMO_METADATA_MODEL.cost },
          contextWindow: DEMO_METADATA_MODEL.contextWindow,
          maxTokens: DEMO_METADATA_MODEL.maxTokens,
        },
      ],
      streamSimple: (model, context, options) =>
        model.id === DEMO_METADATA_MODEL.id
          ? streamMetadataProvider(model, context, options)
          : streamScriptedProvider(steps, state, model, context, options),
    });
  };
}

export const demoApplyChangeTool: ToolDefinition<typeof demoApplyChangeSchema> = {
  name: "demo_apply_change",
  label: "Demo Apply Change",
  description: "Apply a scripted repository change for the Ultrathink demo",
  parameters: demoApplyChangeSchema,
  async execute(_toolCallId, params: DemoApplyChangeInput, _signal, _onUpdate, ctx) {
    const fullPath = path.join(ctx.cwd, params.path);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, params.content, "utf8");
    return {
      content: [{ type: "text", text: `Wrote ${params.path}` }],
      details: { path: params.path },
    };
  },
};
