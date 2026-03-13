import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { DEFAULT_CONTINUATION_PROMPT_TEMPLATE } from "./promptTemplate.js";

export async function promptForContinuationTemplate(
  ctx: ExtensionCommandContext,
  defaultTemplate: string,
): Promise<string | null> {
  if (!ctx.hasUI) {
    return defaultTemplate;
  }

  const result = await ctx.ui.custom<string | null>(
    (tui, theme, _kb, done) => {
      let cachedLines: string[] | undefined;
      const editorTheme: EditorTheme = {
        borderColor: (s) => theme.fg("accent", s),
        selectList: {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
          description: (t) => theme.fg("muted", t),
          scrollInfo: (t) => theme.fg("dim", t),
          noMatch: (t) => theme.fg("warning", t),
        },
      };
      const editor = new Editor(tui, editorTheme);
      editor.setText(defaultTemplate);
      editor.onSubmit = (value) => {
        const trimmed = value.trim();
        done(trimmed.length > 0 ? trimmed : defaultTemplate);
      };

      function refresh(): void {
        cachedLines = undefined;
        tui.requestRender();
      }

      return {
        render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const add = (text: string) => lines.push(truncateToWidth(text, width));
          const defaultStartLine = DEFAULT_CONTINUATION_PROMPT_TEMPLATE.split("\n", 1)[0];
          add(theme.fg("accent", "─".repeat(width)));
          add(theme.fg("accent", theme.bold(" Prompt for auto-review")));
          add(theme.fg("muted", " Pi will prepend the original task and the baseline git diff command automatically."));
          add(theme.fg("dim", ` Default starts: ${defaultStartLine}`));

          for (const line of editor.render(Math.max(20, width - 2))) {
            add(` ${line}`);
          }

          lines.push("");
          add(theme.fg("dim", " Enter accept • Shift+Enter newline • Esc clear / cancel"));
          add(theme.fg("accent", "─".repeat(width)));
          cachedLines = lines;
          return lines;
        },
        invalidate(): void {
          cachedLines = undefined;
          (editor as { invalidate?: () => void }).invalidate?.();
        },
        handleInput(data: string): void {
          if (matchesKey(data, Key.escape)) {
            if (editor.getText() === "") {
              done(null);
            } else {
              editor.setText("");
              refresh();
            }
            return;
          }
          editor.handleInput(data);
          refresh();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "80%",
        maxHeight: "80%",
        minWidth: 70,
        anchor: "center",
        margin: 1,
      },
    },
  );

  if (result === null) {
    return null;
  }

  const trimmed = typeof result === "string" ? result.trim() : "";
  return trimmed.length > 0 ? trimmed : defaultTemplate;
}
