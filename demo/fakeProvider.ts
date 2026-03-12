import { writeFile, mkdir } from "node:fs/promises";
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

export const DEMO_MODEL = {
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

export function createScriptedProviderExtension(steps: DemoStep[]): ExtensionFactory {
  const state = { iteration: 0 };
  return (pi) => {
    pi.registerProvider(DEMO_MODEL.provider, {
      baseUrl: "https://ultrathink-demo.invalid",
      apiKey: "ultrathink-demo-key",
      api: DEMO_MODEL.api,
      models: [
        {
          id: DEMO_MODEL.id,
          name: DEMO_MODEL.name,
          reasoning: DEMO_MODEL.reasoning,
          input: [...DEMO_MODEL.input],
          cost: { ...DEMO_MODEL.cost },
          contextWindow: DEMO_MODEL.contextWindow,
          maxTokens: DEMO_MODEL.maxTokens,
        },
      ],
      streamSimple: (model, context, options) => streamScriptedProvider(steps, state, model, context, options),
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
