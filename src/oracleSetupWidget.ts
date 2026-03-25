import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Model, ThinkingLevel } from "@mariozechner/pi-ai";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth, SelectList, type SelectItem, type SelectListTheme } from "@mariozechner/pi-tui";

export interface OracleSetupResult {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
}

const THINKING_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];

type FocusSection = "model" | "thinking" | "prompt";

export async function showOracleSetup(
  ctx: ExtensionCommandContext,
  defaults: {
    models: Model<any>[];
    defaultModel?: Model<any>;
    defaultThinkingLevel: ThinkingLevel;
    defaultSystemPrompt: string;
  },
): Promise<OracleSetupResult | null> {
  if (!ctx.hasUI) {
    // No TUI — return defaults if we have a model
    if (defaults.defaultModel) {
      return {
        model: defaults.defaultModel,
        thinkingLevel: defaults.defaultThinkingLevel,
        systemPrompt: defaults.defaultSystemPrompt,
      };
    }
    return null;
  }

  const result = await ctx.ui.custom<OracleSetupResult | null>(
    (tui, theme, _kb, done) => {
      let cachedLines: string[] | undefined;
      let focusSection: FocusSection = "model";

      // Thinking level state
      let thinkingIndex = THINKING_LEVELS.indexOf(defaults.defaultThinkingLevel);
      if (thinkingIndex < 0) thinkingIndex = THINKING_LEVELS.indexOf("high");

      // Model selector
      const selectListTheme: SelectListTheme = {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      };

      const modelItems: SelectItem[] = defaults.models.map((m) => ({
        value: `${m.provider}/${m.id}`,
        label: `${m.provider}/${m.id}`,
        description: m.reasoning ? "reasoning" : undefined,
      }));

      const modelList = new SelectList(modelItems, 8, selectListTheme);

      // Pre-select the default model
      if (defaults.defaultModel) {
        const defaultIdx = defaults.models.findIndex(
          (m) => m.provider === defaults.defaultModel!.provider && m.id === defaults.defaultModel!.id,
        );
        if (defaultIdx >= 0) modelList.setSelectedIndex(defaultIdx);
      }

      modelList.onSelect = () => {
        // Enter on model list — confirm if we're focused on it
        submitResult();
      };

      // Prompt editor
      const editorTheme: EditorTheme = {
        borderColor: (s) => theme.fg("accent", s),
        selectList: selectListTheme,
      };
      const editor = new Editor(tui, editorTheme);
      editor.setText(defaults.defaultSystemPrompt);
      editor.onSubmit = () => submitResult();

      function getSelectedModel(): Model<any> | undefined {
        const selected = modelList.getSelectedItem();
        if (!selected) return defaults.defaultModel ?? defaults.models[0];
        return defaults.models.find(
          (m) => `${m.provider}/${m.id}` === selected.value,
        );
      }

      function submitResult(): void {
        const model = getSelectedModel();
        if (!model) {
          done(null);
          return;
        }
        done({
          model,
          thinkingLevel: THINKING_LEVELS[thinkingIndex],
          systemPrompt: editor.getText().trim() || defaults.defaultSystemPrompt,
        });
      }

      function refresh(): void {
        cachedLines = undefined;
        tui.requestRender();
      }

      return {
        render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const add = (text: string) => lines.push(truncateToWidth(text, width));

          add(theme.fg("accent", "─".repeat(width)));
          add(theme.fg("accent", theme.bold(" 🔮 Oracle Setup")));
          add("");

          // ── Model Section ──
          const modelHeader = focusSection === "model"
            ? theme.fg("accent", theme.bold(" Model:"))
            : theme.fg("muted", " Model:");
          add(modelHeader);

          if (focusSection === "model") {
            for (const line of modelList.render(Math.max(40, width - 4))) {
              add(`  ${line}`);
            }
          } else {
            const selected = modelList.getSelectedItem();
            add(theme.fg("dim", `  ${selected?.label ?? "(none)"}`));
          }
          add("");

          // ── Thinking Level Section ──
          const thinkingHeader = focusSection === "thinking"
            ? theme.fg("accent", theme.bold(" Thinking:"))
            : theme.fg("muted", " Thinking:");
          add(thinkingHeader);

          const levelParts = THINKING_LEVELS.map((level, i) => {
            if (i === thinkingIndex) {
              return theme.fg("accent", `[${level}]`);
            }
            return theme.fg("dim", ` ${level} `);
          });
          add(`  ${levelParts.join(" ")}`);
          add("");

          // ── System Prompt Section ──
          const promptHeader = focusSection === "prompt"
            ? theme.fg("accent", theme.bold(" System Prompt:"))
            : theme.fg("muted", " System Prompt:");
          add(promptHeader);

          if (focusSection === "prompt") {
            for (const line of editor.render(Math.max(20, width - 2))) {
              add(` ${line}`);
            }
          } else {
            const text = editor.getText();
            const preview = text.length > 60 ? text.slice(0, 60) + "…" : text;
            add(theme.fg("dim", `  ${preview}`));
          }

          lines.push("");
          add(theme.fg("dim", " Tab switch section • ←→ thinking • Enter confirm • Esc cancel"));
          add(theme.fg("accent", "─".repeat(width)));
          cachedLines = lines;
          return lines;
        },

        invalidate(): void {
          cachedLines = undefined;
          modelList.invalidate();
          (editor as { invalidate?: () => void }).invalidate?.();
        },

        handleInput(data: string): void {
          // Tab to cycle focus
          if (matchesKey(data, Key.tab)) {
            const sections: FocusSection[] = ["model", "thinking", "prompt"];
            const idx = sections.indexOf(focusSection);
            focusSection = sections[(idx + 1) % sections.length];
            refresh();
            return;
          }

          // Shift+Tab to cycle back
          if (data === "\x1b[Z") {
            const sections: FocusSection[] = ["model", "thinking", "prompt"];
            const idx = sections.indexOf(focusSection);
            focusSection = sections[(idx + sections.length - 1) % sections.length];
            refresh();
            return;
          }

          // Escape cancels
          if (matchesKey(data, Key.escape)) {
            done(null);
            return;
          }

          // Section-specific handling
          if (focusSection === "model") {
            // Enter in model section submits
            if (matchesKey(data, Key.enter)) {
              submitResult();
              return;
            }
            modelList.handleInput(data);
            refresh();
            return;
          }

          if (focusSection === "thinking") {
            if (data === "\x1b[D" || data === "h") {
              // Left arrow
              thinkingIndex = Math.max(0, thinkingIndex - 1);
              refresh();
              return;
            }
            if (data === "\x1b[C" || data === "l") {
              // Right arrow
              thinkingIndex = Math.min(THINKING_LEVELS.length - 1, thinkingIndex + 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.enter)) {
              submitResult();
              return;
            }
            refresh();
            return;
          }

          if (focusSection === "prompt") {
            editor.handleInput(data);
            refresh();
            return;
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "90%",
        maxHeight: "90%",
        minWidth: 70,
        anchor: "center",
        margin: 1,
      },
    },
  );

  return result ?? null;
}
