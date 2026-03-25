import type { AgentSession, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Model, ThinkingLevel } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Default oracle system prompt
// ---------------------------------------------------------------------------

export const DEFAULT_ORACLE_SYSTEM_PROMPT = `You are the Oracle — an independent code reviewer for the Ultrathink review loop.

Your job is to evaluate whether the task has been completed correctly and thoroughly.
You have full access to the codebase via tools: read files, search, run commands, run tests.

Review process:
1. Read the relevant files to understand what was done
2. Run tests if applicable (e.g., npm test, pytest, etc.)
3. Check for correctness, edge cases, code quality
4. If everything looks good, call the oracle_accept tool with a summary
5. If issues remain, describe them clearly so the agent can fix them

Be specific in your feedback. Reference file paths and line numbers.
You may have a discussion with the main agent — if the agent pushes back on your feedback, consider their reasoning. But do not accept work you believe is incorrect.

When you are satisfied that the work is complete and correct, you MUST call the oracle_accept tool. Do not simply say "looks good" — call the tool.`;

// ---------------------------------------------------------------------------
// Oracle accept tool schema
// ---------------------------------------------------------------------------

const OracleAcceptParams = Type.Object({
  summary: Type.String({ description: "Brief summary of why the work is acceptable" }),
});

type OracleAcceptInput = Static<typeof OracleAcceptParams>;

// ---------------------------------------------------------------------------
// OracleSession wrapper
// ---------------------------------------------------------------------------

export interface OracleSession {
  session: AgentSession;
  accepted: boolean;
  acceptSummary?: string;
}

export interface OracleResult {
  accepted: boolean;
  responseText: string;
  acceptSummary?: string;
}

export interface CreateOracleOptions {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  cwd: string;
}

// ---------------------------------------------------------------------------
// Create the oracle session
// ---------------------------------------------------------------------------

export async function createOracleSession(options: CreateOracleOptions): Promise<OracleSession> {
  const {
    createAgentSession,
    SessionManager,
    createReadTool,
    createBashTool,
    createGrepTool,
    createFindTool,
    createLsTool,
  } = await import("@mariozechner/pi-coding-agent");

  const wrapper: OracleSession = {
    session: undefined as unknown as AgentSession,
    accepted: false,
    acceptSummary: undefined,
  };

  const oracleAcceptTool: ToolDefinition<typeof OracleAcceptParams> = {
    name: "oracle_accept",
    label: "Accept Work",
    description:
      "Call this tool when you have reviewed the work and determined that no more changes are needed. Provide a brief summary of why the work is acceptable.",
    parameters: OracleAcceptParams,
    async execute(
      _toolCallId: string,
      params: OracleAcceptInput,
    ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> {
      wrapper.accepted = true;
      wrapper.acceptSummary = params.summary;
      return {
        content: [{ type: "text", text: `✅ Work accepted: ${params.summary}` }],
        details: undefined,
      };
    },
  };

  const { session } = await createAgentSession({
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    tools: [
      createReadTool(options.cwd),
      createBashTool(options.cwd),
      createGrepTool(options.cwd),
      createFindTool(options.cwd),
      createLsTool(options.cwd),
    ],
    customTools: [oracleAcceptTool as unknown as ToolDefinition],
    sessionManager: SessionManager.inMemory(options.cwd),
  });

  // Set oracle system prompt
  (session as any)._systemPromptOverride = options.systemPrompt;

  wrapper.session = session;
  return wrapper;
}

// ---------------------------------------------------------------------------
// Send a message to the oracle and get its response
// ---------------------------------------------------------------------------

export async function sendToOracle(oracle: OracleSession, message: string): Promise<OracleResult> {
  // Reset acceptance flag before each turn
  oracle.accepted = false;
  oracle.acceptSummary = undefined;

  await oracle.session.sendUserMessage(message);

  // Extract the assistant's text from the oracle's messages
  const messages = oracle.session.messages;
  const lastAssistant = [...messages].reverse().find(
    (m: any) => m.role === "assistant" && Array.isArray(m.content),
  ) as { role: "assistant"; content: Array<{ type: string; text?: string }> } | undefined;

  let responseText = "";
  if (lastAssistant) {
    responseText = lastAssistant.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }

  return {
    accepted: oracle.accepted,
    responseText,
    acceptSummary: oracle.acceptSummary,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function disposeOracle(oracle: OracleSession | undefined): void {
  if (!oracle) return;
  try {
    oracle.session.dispose();
  } catch {
    // Ignore errors during cleanup
  }
}
