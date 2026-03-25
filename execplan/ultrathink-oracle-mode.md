# Oracle Mode for pi-ultrathink

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `execplan/` conventions established in this repo (see also the prior plans `execplan/ultrathink-review-loop.md` and `execplan/ultrathink-ai-branch-merge-flow.md` for style reference).


## Purpose / Big Picture

Today, `/ultrathink` runs an iterative review loop driven by Git: the agent works, the extension checks for Git changes, and if there are changes it commits and sends a continuation prompt. This only works inside Git repositories and uses a mechanical "did the code change?" signal to decide whether to continue.

Oracle mode adds a new command `/ultrathink-oracle <prompt>` that replaces the Git signal with an **AI reviewer** (the "oracle"). After the main agent finishes each iteration, the extension spawns a separate in-process agent session — the oracle — which independently inspects the codebase using its own tools (read, bash, grep, find, ls). The oracle and the main agent then have a visible back-and-forth conversation: the oracle provides feedback, the main agent responds (possibly making changes or discussing), and the oracle evaluates again. This continues until the oracle calls a custom `oracle_accept` tool to signal that the work is complete.

The key difference from the Git-based mode: Oracle mode works **without Git**, and the stop signal is a deliberate quality judgment by the oracle, not a mechanical "no changes" check. The conversation between agent and oracle is fully visible to the user.

After implementing this plan, a user can:

1. Run `pi -e ./src/index.ts` to load the extension.
2. Type `/ultrathink-oracle Refactor the auth module to use JWT tokens`.
3. See a setup widget where they choose the oracle's model, thinking level, and review prompt.
4. Watch the main agent work, then see oracle feedback appear as visible messages.
5. Watch the agent and oracle converse until the oracle accepts.
6. See a completion summary showing iteration count and oracle verdict.


## Progress

- [ ] Milestone 1: Oracle session infrastructure (`src/oracle.ts`)
- [ ] Milestone 2: Setup widget TUI (`src/oracleSetupWidget.ts`)
- [ ] Milestone 3: Command registration and orchestration loop in `src/index.ts`
- [ ] Milestone 4: Config schema extensions in `src/config.ts` and `src/types.ts`
- [ ] Milestone 5: UI integration — status line, completion summary in `src/ui.ts`
- [ ] Milestone 6: Tests
- [ ] Milestone 7: Demo script and README update


## Surprises & Discoveries

(none yet)


## Decision Log

- Decision: Use `createAgentSession()` from `@mariozechner/pi-coding-agent` SDK to create the oracle as an in-process `AgentSession`, rather than spawning a subprocess or importing from `pi-subagents`.
  Rationale: The oracle must be a persistent multi-turn session that accumulates context across rounds. `runSync` from pi-subagents is one-shot (spawns `pi -p` which exits after one response). `createAgentSession` gives us a persistent in-memory session with full tool access, custom tool registration (`oracle_accept`), and direct event subscription. It is already a peer dependency of our package.
  Date: 2026-03-24

- Decision: Oracle signals acceptance via a custom tool (`oracle_accept`) rather than text parsing or structured JSON markers.
  Rationale: A custom tool call is an unambiguous, machine-readable signal. The extension registers the tool on the oracle session and detects its invocation by inspecting the oracle's messages after `prompt()` resolves. No fragile text parsing needed.
  Date: 2026-03-24

- Decision: The agent and oracle communicate in a visible bidirectional loop. Oracle feedback is sent to the main session via `pi.sendUserMessage()`, and the main agent's response text is sent back to the oracle via `oracleSession.sendUserMessage()`.
  Rationale: The user wanted the conversation to be visible (so they can see what the oracle finds and how the agent responds). The oracle and agent can negotiate — the oracle may give feedback, the agent may push back, and iterations continue until the oracle is satisfied. Rounds without code changes are valid (pure discussion).
  Date: 2026-03-24

- Decision: Show a setup widget (overlay) at `/ultrathink-oracle` launch for model selection, thinking level, and system prompt editing. Default values come from `~/.pi/ultrathink.json`. Model list shows only scoped models (from `--models` flag, available via `ctx.modelRegistry`).
  Rationale: Consistent with existing `/ultrathink` behavior which shows a prompt editor at launch. The oracle's model may differ from the main agent's model, so the user should choose it explicitly. Scoped models are the relevant subset the user has configured.
  Date: 2026-03-24


## Outcomes & Retrospective


All 7 milestones implemented. 28 tests pass (15 existing + 13 new). Typecheck clean. The implementation adds 4 new source files (`oracle.ts`, `oracleSetupWidget.ts`, test file, execplan) and modifies 5 existing files (`index.ts`, `types.ts`, `config.ts`, `state.ts`, `ui.ts`, `README.md`, `AGENTS.md`). No new runtime dependencies introduced — uses only the existing `@mariozechner/pi-coding-agent` peer dependency and its re-exports.


## Context and Orientation

This section orients a novice to the pi-ultrathink codebase and the Pi extension API surfaces needed for oracle mode.

### Repository structure

The project lives at `/home/bot/projects/pi-ultrathink/`. It is a Pi extension package written in TypeScript (ESM, `"type": "module"`). Source files use `.js` suffixes in import specifiers even though they are `.ts` files — there is no build step; `tsc` is used only for typechecking.

Key existing files:

- `src/index.ts` (478 lines) — Extension entry point. Registers the `/ultrathink` command, wires up `agent_end`, `input`, and `session_start` event handlers, and drives the Git-based review loop. The central data structure is `activeRun` (type `ActiveRun` from `src/types.ts`) which tracks the current run's state.
- `src/types.ts` (125 lines) — Shared interfaces: `ActiveRun`, `IterationRecord`, `StopReason`, `UltrathinkConfig`. `StopReason` is a union of string literals like `"completed"`, `"no-git-changes"`, `"max-iterations"`, `"cancelled-by-user"`, `"cancelled-by-interrupt"`.
- `src/review.ts` (59 lines) — `buildReviewPrompt(task, template)` assembles the continuation prompt for the Git-based loop. `shouldStopAfterReview(messages)` inspects the assistant's reply (currently unused in favor of Git-based stop).
- `src/config.ts` — Loads and validates `~/.pi/ultrathink.json`. Current fields: `maxIterations`, `continuationPromptTemplate`, `commitBodyMaxChars`, `naming.provider`, `naming.modelId`, `git.allowDirty`.
- `src/git.ts` — Git operations: repo detection, scratch-branch creation, conditional commits, reintegration. Oracle mode does not use any of this.
- `src/naming.ts` — AI-authored commit messages and branch slugs via `complete()`. Uses `naming.provider`/`naming.modelId` from config. Oracle mode does not use this directly but follows the same config pattern.
- `src/promptTemplate.ts` — Default continuation prompt text constant.
- `src/promptEditor.ts` — TUI overlay for editing the continuation prompt. Uses `ctx.ui.custom()` with `Editor` from `@mariozechner/pi-tui`.
- `src/state.ts` — Creates `ActiveRun` objects and persists custom session entries.
- `src/ui.ts` — `showStatusLine()` and `showCompletionSummary()` helpers.
- `test/` — Vitest tests using fake Pi harness (`test/support/fakePi.ts`) and real Git temp repos.
- `demo/` — Scripted end-to-end demo.

### Pi extension API surfaces used

Extensions are functions that receive an `ExtensionContext` (aliased as `pi` in existing code). Key methods:

- `pi.registerCommand(name, description, handler)` — Registers a slash command. The handler receives `(args, ctx)` where `ctx: ExtensionCommandContext` provides `ctx.ui.custom()` for overlays, `ctx.hasUI` to check if TUI is available.
- `pi.on("agent_end", handler)` — Fires when the agent finishes a turn. `event.messages` contains all messages; the handler extracts the assistant's text response.
- `pi.on("input", handler)` — Fires when the user types. Used to detect user interruption of the loop.
- `pi.sendUserMessage(text)` — Sends a visible user message to the main session, triggering a new agent turn.
- `pi.setStatus(text)` — Sets the extension's status line in the TUI footer.
- `pi.ui.notify(text, level)` — Shows a notification.
- `pi.model` — The current model of the main session (may be undefined).
- `pi.modelRegistry` — `ModelRegistry` instance. `pi.modelRegistry.getAvailable()` returns all available `Model` objects. For the setup widget, we filter to scoped models if available.

### Pi SDK: `createAgentSession()`

Exported from `@mariozechner/pi-coding-agent`. Creates an independent in-process `AgentSession` with its own agent, tools, model, and message history.

    import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
    import { createReadTool, createBashTool, createGrepTool, createFindTool, createLsTool } from "@mariozechner/pi-coding-agent";

    const { session } = await createAgentSession({
      model: selectedModel,            // Model object from modelRegistry
      thinkingLevel: "high",           // ThinkingLevel string
      tools: [                         // Built-in tools for the oracle
        createReadTool(cwd),
        createBashTool(cwd),
        createGrepTool(cwd),
        createFindTool(cwd),
        createLsTool(cwd),
      ],
      customTools: [oracleAcceptTool], // Our custom tool (see below)
      sessionManager: SessionManager.inMemory(), // No file persistence
    });

Key `AgentSession` methods:

- `session.sendUserMessage(text)` — Sends a user message and triggers a full agent turn. Returns a Promise that resolves when the agent finishes (all tool calls complete, final text emitted).
- `session.subscribe(listener)` — Subscribes to agent events (`agent_end`, `tool_execution_start`, `message_end`, etc.).
- `session.agent.state.messages` — The full message history of the oracle session.
- `session.dispose()` — Cleans up the session.

The `customTools` array accepts `ToolDefinition` objects (from `@mariozechner/pi-coding-agent` extension types):

    interface ToolDefinition {
      name: string;
      label: string;
      description: string;
      parameters: TSchema;        // TypeBox schema
      execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult>;
    }

### Pi TUI components

From `@mariozechner/pi-tui`:

- `Editor` — Multi-line text editor with submit/cancel. Used by existing `promptEditor.ts`.
- `SelectList` — Single-select list with filtering. Items are `{ value, label, description? }`.
- `SettingsList` — Settings panel with cycling values, submenus. Items have `{ id, label, currentValue, values?, submenu? }`.
- `matchesKey(data, Key.xxx)` — Key matching for input handling.
- `truncateToWidth(text, width)` — Safe terminal text truncation.

The setup widget will use `ctx.ui.custom()` (same as `promptEditor.ts`) to show an overlay with model selector, thinking level picker, and prompt editor.


## Plan of Work

The work is organized into 7 milestones. Each builds on the previous and is independently testable.


### Milestone 1: Oracle session infrastructure — `src/oracle.ts`

This milestone creates the core module that manages the oracle's `AgentSession` lifecycle.

**What exists after this milestone:** A module `src/oracle.ts` exporting functions to create an oracle session, send messages to it, detect the `oracle_accept` tool call, and dispose of the session. No command or loop yet — just the building block.

**New file: `src/oracle.ts`**

This file exports:

- `OracleSession` — A wrapper around `AgentSession` that tracks whether `oracle_accept` has been called.
- `createOracleSession(options)` — Creates a new `AgentSession` with the oracle's model, tools, system prompt, and the `oracle_accept` custom tool. Returns an `OracleSession`.
- `sendToOracle(oracleSession, text)` — Sends a user message to the oracle session and waits for the response. Returns `{ accepted: boolean, responseText: string }`.
- `disposeOracle(oracleSession)` — Cleans up.

The `oracle_accept` tool definition:

    Name: "oracle_accept"
    Label: "Accept Work"
    Description: "Call this tool when you have reviewed the work and determined that no more changes are needed. Provide a brief summary of why the work is acceptable."
    Parameters: { summary: string (required) }
    Execute: Sets an `accepted` flag on the OracleSession wrapper, returns "✅ Work accepted: <summary>"

Detection logic in `sendToOracle`: after `session.sendUserMessage(text)` resolves, inspect `session.agent.state.messages` for the latest assistant message. Check if any content block is a `toolCall` with `name === "oracle_accept"`. If yes, `accepted = true`. The `responseText` is the concatenation of all text blocks from the assistant's response (the oracle typically writes feedback text AND/OR calls oracle_accept).

**System prompt for the oracle (default):**

    You are the Oracle — an independent code reviewer for the Ultrathink review loop.

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

    When you are satisfied that the work is complete and correct, you MUST call the oracle_accept tool. Do not simply say "looks good" — call the tool.

**Interfaces (in `src/types.ts`):**

Add `OracleConfig` to the config schema:

    oracle: {
      provider?: string;      // e.g., "anthropic"
      modelId?: string;       // e.g., "claude-sonnet-4"
      thinkingLevel?: string; // e.g., "high"
      systemPromptTemplate?: string; // Override the default oracle system prompt
      maxRounds?: number;     // Max oracle review rounds (default: 5)
    }

Add oracle-specific stop reasons to `StopReason`:

    "oracle-accepted"        // Oracle called oracle_accept
    "oracle-max-rounds"     // Hit maxRounds without acceptance

**Verification:** Unit test in `test/ultrathink-oracle.spec.ts` that creates an `OracleSession` with a mock model, verifies `oracle_accept` tool detection, and verifies text extraction.


### Milestone 2: Setup widget TUI — `src/oracleSetupWidget.ts`

This milestone creates the overlay widget shown when `/ultrathink-oracle` is launched. The user can select the oracle model, thinking level, and edit the system prompt before the run begins.

**What exists after this milestone:** A module `src/oracleSetupWidget.ts` exporting a function that shows the setup overlay and returns the user's choices, or `null` if cancelled.

**New file: `src/oracleSetupWidget.ts`**

Exports:

    interface OracleSetupResult {
      model: Model<any>;
      thinkingLevel: ThinkingLevel;
      systemPrompt: string;
    }

    async function showOracleSetup(
      ctx: ExtensionCommandContext,
      defaults: {
        models: Model<any>[];         // Scoped models from modelRegistry
        defaultModel?: Model<any>;    // From config or current model
        defaultThinkingLevel: string;
        defaultSystemPrompt: string;
      },
    ): Promise<OracleSetupResult | null>

The widget is an overlay (via `ctx.ui.custom()`) with three sections rendered top-to-bottom:

1. **Model selector** — A `SelectList` showing scoped models. Each item shows `provider/modelId`. Default is pre-selected from config (`oracle.provider`/`oracle.modelId`) or the current main session model. If no scoped models exist, show all available models from `ctx.modelRegistry.getAvailable()`.

2. **Thinking level** — A row of options: off, minimal, low, medium, high, xhigh. Default from config (`oracle.thinkingLevel`) or "high". User cycles with left/right arrows or Tab.

3. **System prompt editor** — An `Editor` component pre-filled with the default oracle system prompt (from config or built-in default). The user can edit freely.

**Navigation:**
- Up/Down arrows switch focus between sections (model, thinking, prompt editor)
- When model section is focused: Up/Down navigates the model list, type to filter
- When thinking section is focused: Left/Right cycles levels
- When prompt editor is focused: normal editor input, Shift+Enter for newlines
- Enter (when not in editor): confirms and starts the run
- Esc: cancels (returns null)

**Keybinding hints** shown at the bottom:

    ↑↓ navigate • ←→ thinking level • Enter confirm • Shift+Enter newline • Esc cancel

**Verification:** Manual testing via `pi -e ./src/index.ts` and running `/ultrathink-oracle test`. The overlay should appear with model list, thinking selector, and prompt editor.


### Milestone 3: Command registration and orchestration loop — `src/index.ts`

This is the core milestone. It wires up the `/ultrathink-oracle` command and implements the agent↔oracle communication loop.

**What exists after this milestone:** The full oracle mode working end-to-end. A user can run `/ultrathink-oracle <prompt>`, the agent works, the oracle reviews, they converse, and the loop stops when the oracle accepts or max rounds is reached.

**Changes to `src/index.ts`:**

Register a new command:

    pi.registerCommand(
      "ultrathink-oracle",
      "Start an oracle-reviewed ultrathink session (no git required)",
      async (args, ctx) => { ... }
    );

The command handler:

1. Parse the prompt from `args` (same as existing `/ultrathink` — `args.trim()`). If empty, show usage notification and return.

2. If there is an active run (git-based or oracle-based), cancel it. The `activeRun` structure from `src/state.ts` is reused. A new `mode` field distinguishes: `"git"` (existing) vs `"oracle"`.

3. Show the setup widget (`showOracleSetup`). If the user cancels, abort.

4. Create the oracle session (`createOracleSession`) with the user's chosen model, thinking level, and system prompt.

5. Create a new `ActiveRun` with `mode: "oracle"`, storing the `OracleSession` reference, the original task, round counter, and max rounds.

6. Send the initial task as a visible user message: `pi.sendUserMessage(promptText)`. This triggers the main agent to work.

7. Set status: `pi.setStatus("🔮 Oracle v1 — agent working...")`.

**The `agent_end` handler (modified):**

The existing `agent_end` handler in `src/index.ts` currently handles only the git-based loop. It will be extended with a branch for oracle mode:

    pi.on("agent_end", async (event) => {
      if (!activeRun) return;

      if (activeRun.mode === "git") {
        // ... existing git-based logic (unchanged) ...
      } else if (activeRun.mode === "oracle") {
        await handleOracleAgentEnd(event);
      }
    });

**`handleOracleAgentEnd(event)` logic:**

1. Extract the assistant's text from `event.messages` (same helper as existing code: find last assistant message, extract text content).

2. If the run was cancelled or aborted (check `stopReason` on the assistant message), stop the run.

3. Check if this is the first iteration (the agent just finished the initial task) or a subsequent one (the agent responded to oracle feedback).

4. Send the agent's text to the oracle:

       const result = await sendToOracle(activeRun.oracleSession, agentResponseText);

5. If `result.accepted`:
   - Stop the run with reason `"oracle-accepted"`.
   - Show completion summary.
   - Dispose the oracle session.

6. If not accepted and round < maxRounds:
   - Increment round counter.
   - Label the iteration (e.g., `ultrathink-oracle:v2`).
   - Send oracle's feedback to the main session as a visible user message:

         pi.sendUserMessage(`🔮 **Oracle Review (round ${round}):**\n\n${result.responseText}`);

   - Update status: `pi.setStatus("🔮 Oracle v${round} — agent working...")`.
   - The main agent will process this message, and when it finishes, `agent_end` fires again → loop.

7. If not accepted and round >= maxRounds:
   - Stop with reason `"oracle-max-rounds"`.
   - Show completion summary noting the oracle did not accept.
   - Dispose the oracle session.

**The `input` handler (modified):**

The existing `input` handler cancels the git-based loop when the user types during a run. Same behavior for oracle mode:

    pi.on("input", (event) => {
      if (activeRun && activeRun.mode === "oracle") {
        // User typed during oracle run — cancel
        stopRun("cancelled-by-user");
      }
    });

**Cancellation and cleanup:**

When an oracle run is stopped (for any reason), `disposeOracle(activeRun.oracleSession)` must be called. The `stopRun()` function (existing, to be modified) handles this.

**Verification:** Full manual test:

    cd /tmp/test-project && npm init -y
    pi -e /home/bot/projects/pi-ultrathink/src/index.ts
    > /ultrathink-oracle Create a hello.js file that prints "Hello World" and add a test for it

Expected behavior: the agent creates the file, the oracle reviews it, they may have a round or two of feedback, and the oracle eventually accepts. The user sees the entire conversation.


### Milestone 4: Config schema extensions — `src/config.ts` and `src/types.ts`

**Changes to `src/types.ts`:**

Add `OracleConfig` interface:

    interface OracleConfig {
      provider?: string;
      modelId?: string;
      thinkingLevel?: string;
      systemPromptTemplate?: string;
      maxRounds?: number;
    }

Extend `UltrathinkConfig`:

    interface UltrathinkConfig {
      // ... existing fields ...
      oracle?: OracleConfig;
    }

Add `mode` field to `ActiveRun`:

    interface ActiveRun {
      // ... existing fields ...
      mode: "git" | "oracle";
      oracleSession?: OracleSession;  // Only present when mode === "oracle"
      oracleRound?: number;
    }

Add new `StopReason` values:

    type StopReason = 
      | "completed" | "no-git-changes" | "max-iterations" 
      | "cancelled-by-user" | "cancelled-by-interrupt"
      | "oracle-accepted" | "oracle-max-rounds";

**Changes to `src/config.ts`:**

Add validation for `oracle.*` fields in the config loader. Default values:

    oracle.maxRounds: 5
    oracle.thinkingLevel: "high"
    oracle.systemPromptTemplate: (the built-in default from Milestone 1)

**Verification:** `npm run typecheck` passes. Existing tests still pass (`npm test`).


### Milestone 5: UI integration — `src/ui.ts`

**Changes to `src/ui.ts`:**

Extend `showCompletionSummary()` to handle oracle mode:

    For oracle-accepted:
      "🔮 Oracle accepted after N rounds"
    For oracle-max-rounds:
      "🔮 Oracle did not accept after N rounds (max reached)"
    For cancelled-by-user (oracle mode):
      "🔮 Oracle run cancelled by user after N rounds"

The status line (`pi.setStatus()`) is set directly in the orchestration loop (Milestone 3), not in `ui.ts`.

**Verification:** Visual inspection during manual testing.


### Milestone 6: Tests

**New file: `test/ultrathink-oracle.spec.ts`**

Tests using the existing fake Pi harness (`test/support/fakePi.ts`). Since `createAgentSession` requires real model setup, oracle session tests will mock the oracle at the boundary:

1. **Oracle accept detection test**: Construct a mock message array containing a `toolCall` with `name: "oracle_accept"`. Verify the detection logic returns `{ accepted: true, responseText: "..." }`.

2. **Oracle feedback extraction test**: Construct a mock message array with text-only response (no oracle_accept call). Verify `{ accepted: false, responseText: "Fix the error in line 42" }`.

3. **Oracle loop stop reasons**: Test that the orchestration logic correctly maps:
   - Oracle accept → `"oracle-accepted"`
   - Max rounds hit → `"oracle-max-rounds"`
   - User input during run → `"cancelled-by-user"`

4. **Config defaults test**: Verify that `loadConfig()` returns correct oracle defaults when no oracle config is present.

5. **Prompt shape test**: Verify that the oracle feedback message sent to the main session has the expected format (`🔮 **Oracle Review (round N):**\n\n...`).

**Verification:** `npm run check` (typecheck + all tests pass).


### Milestone 7: Demo script and README update

**Changes to `demo/runDemo.ts`:**

Add an oracle-mode demo scenario that:
1. Creates a temp directory (no git repo — to show oracle mode works without git).
2. Starts a pi session with the extension loaded.
3. Runs `/ultrathink-oracle` with a simple task.
4. Uses a fake provider that simulates the oracle conversation.

**Changes to `README.md`:**

Add a section explaining oracle mode:
- The `/ultrathink-oracle` command
- How the oracle reviews work
- The setup widget
- Config options (`oracle.*`)
- Comparison with git-based `/ultrathink`

**Changes to `AGENTS.md`:**

Update the repository map with new files. Update the "Runtime behavior and invariants" section to cover oracle mode.

**Verification:** `npm run demo` runs successfully. `npm run check` passes.


## Concrete Steps

All commands are run from `/home/bot/projects/pi-ultrathink/`.

After each milestone:

    npm run typecheck
    npm test

After final milestone:

    npm run check
    npm run demo


## Validation and Acceptance

The feature is accepted when:

1. `npm run check` passes (typecheck + all tests, including new oracle tests).
2. `npm run demo` runs the oracle demo scenario to completion.
3. Manual testing: `pi -e ./src/index.ts` → `/ultrathink-oracle <prompt>` shows the setup widget, the agent works, the oracle reviews with visible feedback messages, and the loop terminates on oracle acceptance.
4. Oracle mode works in a non-git directory.
5. Cancellation works: typing during an oracle run stops it cleanly.
6. Max rounds limit works: if the oracle never accepts, the run stops after `maxRounds`.


## Idempotence and Recovery

All changes are additive. The existing `/ultrathink` command and git-based loop are unchanged. Oracle mode is entirely new code paths gated by `mode === "oracle"`. If something goes wrong, `disposeOracle()` cleans up the oracle session. The user can always Ctrl+C to abort.

Running `npm run check` at any point verifies the codebase is healthy.


## Interfaces and Dependencies

**Peer dependency (already present):**

    @mariozechner/pi-coding-agent  — provides createAgentSession, SessionManager, tool factories, ToolDefinition
    @mariozechner/pi-tui           — provides Editor, SelectList, matchesKey, truncateToWidth
    @mariozechner/pi-ai            — provides Model, ThinkingLevel types

**No new runtime dependencies are introduced.**

**Key interfaces to implement:**

In `src/oracle.ts`:

    interface OracleSession {
      session: AgentSession;
      accepted: boolean;
      acceptSummary?: string;
    }

    interface OracleResult {
      accepted: boolean;
      responseText: string;
      acceptSummary?: string;
    }

    function createOracleSession(options: {
      model: Model<any>;
      thinkingLevel: ThinkingLevel;
      systemPrompt: string;
      cwd: string;
    }): Promise<OracleSession>;

    function sendToOracle(oracle: OracleSession, message: string): Promise<OracleResult>;

    function disposeOracle(oracle: OracleSession): void;

In `src/oracleSetupWidget.ts`:

    interface OracleSetupResult {
      model: Model<any>;
      thinkingLevel: ThinkingLevel;
      systemPrompt: string;
    }

    function showOracleSetup(
      ctx: ExtensionCommandContext,
      defaults: {
        models: Model<any>[];
        defaultModel?: Model<any>;
        defaultThinkingLevel: ThinkingLevel;
        defaultSystemPrompt: string;
      },
    ): Promise<OracleSetupResult | null>;

In `src/types.ts` (additions):

    interface OracleConfig {
      provider?: string;
      modelId?: string;
      thinkingLevel?: string;
      systemPromptTemplate?: string;
      maxRounds?: number;
    }

    // ActiveRun gains:
    mode: "git" | "oracle";
    oracleSession?: import("./oracle.js").OracleSession;
    oracleRound?: number;

    // StopReason gains:
    "oracle-accepted" | "oracle-max-rounds"


## Artifacts and Notes

**Oracle communication flow (ASCII diagram):**

    User: /ultrathink-oracle "Fix auth bugs"
          │
          ▼
    ┌─────────────────┐     sendUserMessage("Fix auth bugs")
    │  Main Agent      │◄────────────────────────────────────
    │  (works on task) │
    └────────┬────────┘
             │ agent_end → extract response text
             ▼
    ┌─────────────────┐     sendToOracle(agentText)
    │  Oracle Session  │◄────────────────────────────
    │  (reviews code)  │
    └────────┬────────┘
             │
             ├── oracle_accept called? ──YES──► STOP ("oracle-accepted")
             │
             NO (feedback text)
             │
             ▼
    ┌─────────────────┐     pi.sendUserMessage(oracleFeedback)
    │  Main Agent      │◄──────────────────────────────────
    │  (responds)      │     (visible to user!)
    └────────┬────────┘
             │ agent_end → extract response text
             ▼
    ┌─────────────────┐     sendToOracle(agentText)
    │  Oracle Session  │◄────────────────────────
    │  (same session!) │     (persistent context)
    └────────┬────────┘
             │
             └── ... repeat until accept or maxRounds ...

**Config example (`~/.pi/ultrathink.json`):**

    {
      "maxIterations": 4,
      "oracle": {
        "provider": "anthropic",
        "modelId": "claude-sonnet-4",
        "thinkingLevel": "high",
        "maxRounds": 5
      }
    }
