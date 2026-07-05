import { homedir } from "node:os";
import { shellCommandSections } from "../../core/commands.js";
import { KEATING_ASCII_LOGO, KEATING_SUBTITLE_LINES } from "../../core/terminal.js";
import { KEATING_VERSION } from "../../core/version.js";
import { padVisible, truncatePlain, centerPlain, wrapWords } from "./text-format.js";

function formatHeaderPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function getCurrentModelLabel(ctx: any): string {
  if (typeof ctx?.model === "string" && ctx.model.trim()) return ctx.model.trim();
  if (ctx?.model?.provider && ctx?.model?.id) return `${ctx.model.provider}/${ctx.model.id}`;

  const branch = ctx?.sessionManager?.getBranch?.();
  if (Array.isArray(branch)) {
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const entry = branch[index];
      if (entry?.type === "model_change" && entry.provider && entry.modelId) {
        return `${entry.provider}/${entry.modelId}`;
      }
    }
  }

  return "not set";
}

function getSessionLabel(ctx: any): string {
  const manager = ctx?.sessionManager;
  return manager?.getSessionName?.()?.trim() || manager?.getSessionId?.() || "new session";
}

function summarizeLastActivity(ctx: any): string {
  const branch = ctx?.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) return "";

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message") continue;
    const message = entry.message;
    const role = message?.role === "assistant" ? "agent" : message?.role === "user" ? "you" : message?.role;
    const content = message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((item: any) => item?.text ?? (item?.name ? `[${item.name}]` : "")).filter(Boolean).join(" ")
        : "";
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact) return `${role ?? "message"}: ${compact}`;
  }

  return "";
}

export function createKeatingHeaderComponent(pi: any, ctx: any): (tui: any, theme: any) => any {
  const sections = shellCommandSections();
  const commandCount = sections.reduce((sum, section) => sum + section.commands.length, 0);

  return (_tui: any, theme: any): any => {
    const t = theme.fg.bind(theme);
    const b = theme.bold.bind(theme);
    const border = (text: string) => t("borderMuted", text);
    const dim = (text: string) => t("dim", text);
    const accent = (text: string) => t("accent", text);
    const heading = (text: string) => b(t("mdHeading", text));
    const text = (value: string) => t("text", value);

    return {
      render(width: number): string[] {
        const maxWidth = Math.max(width - 2, 1);
        const cardWidth = Math.min(maxWidth, 120);
        const innerWidth = Math.max(cardWidth - 2, 1);
        const contentWidth = Math.max(innerWidth - 2, 1);
        const outerPad = " ".repeat(Math.max(0, Math.floor((width - cardWidth) / 2)));
        const lines: string[] = [];
        const push = (line: string) => lines.push(`${outerPad}${line}`);
        const row = (content: string) => `${border("│")} ${padVisible(content, contentWidth)} ${border("│")}`;
        const emptyRow = () => `${border("│")}${" ".repeat(innerWidth)}${border("│")}`;
        const separator = () => `${border("├")}${border("─".repeat(innerWidth))}${border("┤")}`;
        const useWideLayout = contentWidth >= 72;

        push("");
        if (cardWidth >= 72) {
          const logoWidth = Math.max(...KEATING_ASCII_LOGO.map(line => line.length));
          const logoPad = " ".repeat(Math.max(0, Math.floor((cardWidth - logoWidth) / 2)));
          const palette = ["accent", "accent", "mdHeading", "mdHeading", "text", "text"];
          for (let index = 0; index < KEATING_ASCII_LOGO.length; index += 1) {
            push(b(t(palette[index] ?? "text", `${logoPad}${KEATING_ASCII_LOGO[index]}`)));
          }
          push("");
        }

        const versionTag = ` v${KEATING_VERSION} `;
        const versionGap = Math.max(0, innerWidth - versionTag.length);
        const versionLeft = Math.floor(versionGap / 2);
        push(
          border(`╭${"─".repeat(versionLeft)}`) +
          dim(versionTag) +
          border(`${"─".repeat(versionGap - versionLeft)}╮`),
        );

        if (useWideLayout) {
          const leftWidth = Math.min(38, Math.floor(contentWidth * 0.35));
          const dividerWidth = 3;
          const rightWidth = contentWidth - leftWidth - dividerWidth;
          const leftValueWidth = Math.max(1, leftWidth - 11);
          const commandNameWidth = 18;
          const commandDescWidth = Math.max(12, rightWidth - commandNameWidth - 2);
          const leftLines: string[] = [""];
          const rightLines: string[] = ["", heading("Teaching Workflows")];
          const leftLabel = (label: string, value: string, color: "text" | "dim") => {
            const wrapped = wrapWords(value, leftValueWidth);
            leftLines.push(`${dim(label.padEnd(10))} ${color === "text" ? text(wrapped[0]!) : dim(wrapped[0]!)}`);
            for (const line of wrapped.slice(1)) {
              leftLines.push(`${" ".repeat(11)}${color === "text" ? text(line) : dim(line)}`);
            }
          };
          const listBlock = (label: string, value: string) => {
            if (!value) return;
            leftLines.push("");
            leftLines.push(accent(b(label)));
            for (const line of wrapWords(value, leftWidth)) {
              leftLines.push(dim(line));
            }
          };

          leftLabel("model", getCurrentModelLabel(ctx), "text");
          leftLabel("directory", formatHeaderPath(ctx.cwd), "text");
          leftLabel("session", getSessionLabel(ctx), "dim");
          leftLines.push("");
          leftLines.push(dim(`${pi.getAllTools?.().length ?? 0} tools · ${commandCount} commands`));
          listBlock("Purpose", KEATING_SUBTITLE_LINES[0] ?? "The Hyperteacher");
          listBlock("Last Activity", truncatePlain(summarizeLastActivity(ctx), leftWidth * 2));

          for (const section of sections) {
            rightLines.push("");
            rightLines.push(accent(b(section.title)));
            for (const command of section.commands) {
              const wrapped = wrapWords(command.description, commandDescWidth);
              rightLines.push(`${accent(command.usage.padEnd(commandNameWidth))}${dim(wrapped[0]!)}`);
              for (const line of wrapped.slice(1)) {
                rightLines.push(`${" ".repeat(commandNameWidth)}${dim(line)}`);
              }
            }
          }

          const maxRows = Math.max(leftLines.length, rightLines.length);
          for (let index = 0; index < maxRows; index += 1) {
            push(row(
              `${padVisible(leftLines[index] ?? "", leftWidth)}` +
              `${border(" │ ")}` +
              `${padVisible(rightLines[index] ?? "", rightWidth)}`,
            ));
          }
        } else {
          push(emptyRow());
          push(row(heading(centerPlain(KEATING_SUBTITLE_LINES[0] ?? "Keating", contentWidth))));
          push(row(dim(centerPlain(KEATING_SUBTITLE_LINES[1] ?? "The Hyperteacher", contentWidth))));
          push(row(dim(centerPlain(`${pi.getAllTools?.().length ?? 0} tools · ${commandCount} commands`, contentWidth))));
          push(emptyRow());
          push(separator());
          for (const section of sections) {
            push(row(accent(b(section.title))));
            for (const command of section.commands) {
              const descWidth = Math.max(1, contentWidth - 18);
              push(row(`${accent(command.usage.padEnd(17))}${dim(truncatePlain(command.description, descWidth))}`));
            }
          }
        }

        push(border(`╰${"─".repeat(innerWidth)}╯`));
        push("");
        return lines;
      },
      invalidate(): void {},
      dispose(): void {},
    };
  };
}
