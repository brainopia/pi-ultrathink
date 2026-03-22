import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

export interface RecordedUserMessage {
  content: string | Array<{ type: string; text?: string }>;
  options?: { deliverAs?: "steer" | "followUp" };
}

export interface RecordedCustomMessage {
  message: {
    customType: string;
    content: string;
    display: boolean;
    details?: unknown;
  };
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" };
}

type Handler = (event: any, ctx: ExtensionContext) => any;
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type ShortcutHandler = (ctx: ExtensionContext) => Promise<void> | void;

type FakeModel = Model<any>;

const DEFAULT_FAKE_MODEL: FakeModel = {
  provider: "test",
  id: "nano",
  api: "openai-completions",
  name: "Test Nano",
  baseUrl: "https://test.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
};

class FakeModelRegistry {
  readonly models: FakeModel[];
  private readonly apiKeys = new Map<string, string>();

  constructor(models?: FakeModel[]) {
    this.models = models && models.length > 0 ? models : [DEFAULT_FAKE_MODEL];
    for (const model of this.models) {
      this.apiKeys.set(`${model.provider}/${model.id}`, `${model.provider}-${model.id}-key`);
    }
  }

  getAll(): FakeModel[] {
    return [...this.models];
  }

  getAvailable(): FakeModel[] {
    return [...this.models];
  }

  find(provider: string, modelId: string): FakeModel | undefined {
    return this.models.find((model) => model.provider === provider && model.id === modelId);
  }

  async getApiKey(model: FakeModel): Promise<string | undefined> {
    return this.apiKeys.get(`${model.provider}/${model.id}`);
  }

  async getApiKeyForProvider(provider: string): Promise<string | undefined> {
    const match = this.models.find((model) => model.provider === provider);
    return match ? this.apiKeys.get(`${match.provider}/${match.id}`) : undefined;
  }
}

class FakeUI {
  readonly notifications: Array<{ message: string; type?: string }> = [];
  readonly statuses = new Map<string, string | undefined>();
  readonly customResults: unknown[] = [];
  readonly selectResults: Array<string | undefined> = [];

  async select(_title: string, options: string[]): Promise<string | undefined> {
    if (this.selectResults.length > 0) {
      return this.selectResults.shift();
    }
    return options[0];
  }

  confirm(): Promise<boolean> {
    return Promise.resolve(true);
  }

  input(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  notify(message: string, type?: "info" | "warning" | "error"): void {
    this.notifications.push({ message, type });
  }

  editor(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  onTerminalInput(): () => void {
    return () => undefined;
  }

  setStatus(key: string, text: string | undefined): void {
    this.statuses.set(key, text);
  }

  setWorkingMessage(): void {}
  setWidget(): void {}
  setFooter(): void {}
  setHeader(): void {}
  setTitle(): void {}

  custom<T>(): Promise<T | undefined> {
    if (this.customResults.length === 0) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.customResults.shift() as T);
  }

  pasteToEditor(): void {}
  setEditorText(): void {}
  getEditorText(): string {
    return "";
  }
  setEditorComponent(): void {}
  getAllThemes(): { name: string; path: string | undefined }[] {
    return [];
  }
  getTheme(): undefined {
    return undefined;
  }
  setTheme(): { success: boolean } {
    return { success: true };
  }
  getToolsExpanded(): boolean {
    return true;
  }
  setToolsExpanded(): void {}
  readonly theme = {} as ExtensionContext["ui"]["theme"];
}

export class FakePiEnvironment {
  readonly handlers = new Map<string, Handler[]>();
  readonly commands = new Map<string, CommandHandler>();
  readonly shortcuts = new Map<string, ShortcutHandler>();
  readonly userMessages: RecordedUserMessage[] = [];
  readonly customMessages: RecordedCustomMessage[] = [];
  readonly appendedEntries: Array<{ customType: string; data: unknown }> = [];
  readonly labels = new Map<string, string | undefined>();
  readonly ui = new FakeUI();
  readonly sessionEntries: any[] = [];
  leafEntry: any | undefined;
  idle = true;
  pendingMessages = false;
  aborted = 0;

  constructor(
    readonly cwd: string,
    readonly execImpl: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>,
    readonly modelRegistryImpl: FakeModelRegistry,
  ) {}

  readonly api: ExtensionAPI = {
    on: ((event: string, handler: Handler) => {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }) as ExtensionAPI["on"],
    registerTool: () => undefined,
    registerCommand: ((name: string, options: { handler: CommandHandler }) => {
      this.commands.set(name, options.handler);
    }) as ExtensionAPI["registerCommand"],
    registerShortcut: ((shortcut: string, options: { handler: ShortcutHandler }) => {
      this.shortcuts.set(shortcut, options.handler);
    }) as ExtensionAPI["registerShortcut"],
    registerFlag: () => undefined,
    getFlag: () => undefined,
    registerMessageRenderer: () => undefined,
    sendMessage: ((message, options) => {
      this.customMessages.push({
        message: {
          customType: message.customType,
          content: String(message.content),
          display: message.display,
          details: message.details,
        },
        options,
      });
    }) as ExtensionAPI["sendMessage"],
    sendUserMessage: ((content, options) => {
      this.userMessages.push({ content, options });
    }) as ExtensionAPI["sendUserMessage"],
    appendEntry: ((customType, data) => {
      this.appendedEntries.push({ customType, data });
    }) as ExtensionAPI["appendEntry"],
    setSessionName: () => undefined,
    getSessionName: () => undefined,
    setLabel: ((entryId: string, label: string | undefined) => {
      this.labels.set(entryId, label);
    }) as ExtensionAPI["setLabel"],
    exec: ((command, args, options) => this.execImpl(command, args, options)) as ExtensionAPI["exec"],
    getActiveTools: () => ["read", "bash", "edit", "write"],
    getAllTools: () => [],
    setActiveTools: () => undefined,
    getCommands: () => [],
    setModel: async () => true,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => undefined,
    registerProvider: () => undefined,
    unregisterProvider: () => undefined,
    events: {
      on: () => () => undefined,
      off: () => undefined,
      emit: () => undefined,
      once: () => () => undefined,
    } as unknown as ExtensionAPI["events"],
  };

  queueCustomUiResult(result: unknown): void {
    this.ui.customResults.push(result);
  }

  queueSelectResult(result: string | undefined): void {
    this.ui.selectResults.push(result);
  }

  private createBaseContext(): ExtensionContext {
    return {
      ui: this.ui as ExtensionContext["ui"],
      hasUI: true,
      cwd: this.cwd,
      sessionManager: {
        getLeafEntry: () => this.leafEntry,
        getEntries: () => this.sessionEntries,
      } as ExtensionContext["sessionManager"],
      modelRegistry: this.modelRegistryImpl as unknown as ExtensionContext["modelRegistry"],
      model: this.modelRegistryImpl.getAvailable()[0],
      isIdle: () => this.idle,
      abort: () => {
        this.aborted += 1;
        this.idle = false;
      },
      hasPendingMessages: () => this.pendingMessages,
      shutdown: () => undefined,
      getContextUsage: () => undefined,
      compact: () => undefined,
      getSystemPrompt: () => "",
    };
  }

  private createCommandContext(): ExtensionCommandContext {
    return {
      ...this.createBaseContext(),
      waitForIdle: async () => {
        this.idle = true;
      },
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      navigateTree: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      reload: async () => undefined,
    };
  }

  async invokeCommand(name: string, args: string): Promise<void> {
    const handler = this.commands.get(name);
    if (!handler) throw new Error(`Unknown command: ${name}`);
    await handler(args, this.createCommandContext());
  }

  async invokeShortcut(shortcut: string): Promise<void> {
    const handler = this.shortcuts.get(shortcut);
    if (!handler) throw new Error(`Unknown shortcut: ${shortcut}`);
    await handler(this.createBaseContext());
  }

  async emit(event: string, payload: any): Promise<any[]> {
    const handlers = this.handlers.get(event) ?? [];
    const ctx = this.createBaseContext();
    const results: any[] = [];
    for (const handler of handlers) {
      const result = await handler(payload, ctx);
      if (result !== undefined) {
        results.push(result);
      }
    }
    return results;
  }

  setLeafAssistantEntry(entryId: string, text: string, stopReason = "stop"): void {
    this.leafEntry = {
      type: "message",
      id: entryId,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        stopReason,
      },
    };
  }
}

export function createFakePiEnvironment(args: {
  cwd: string;
  execImpl?: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
  models?: FakeModel[];
}): FakePiEnvironment {
  const execImpl =
    args.execImpl ??
    (async () => ({ stdout: "", stderr: "", code: 0, killed: false } as ExecResult));
  return new FakePiEnvironment(args.cwd, execImpl, new FakeModelRegistry(args.models));
}
