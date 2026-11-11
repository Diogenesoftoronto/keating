import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReviewNoticeCard } from "./ReviewNoticeCard";
import { css } from "../../styled-system/css";
import { RefreshCw, RotateCcw } from "lucide-react";

/** Static preview of the withheld label with its recovery buttons (the live buttons need the chat runtime). */
function Preview() {
  const button = css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", minHeight: "2rem", paddingInline: "0.75rem",
    borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: "0.8125rem" });
  return (
    <div>
      <ReviewNoticeCard kind="withheld" reason="Keating couldn't prepare a valid review request within the judgement model's limits. Try a new conversation or choose a judgement model with a larger context in Settings." />
      <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" })}>
        <button type="button" className={button}><RotateCcw size={13} aria-hidden /> Try again</button>
        <button type="button" className={button}><RefreshCw size={13} aria-hidden /> Reload Keating</button>
        <span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>If this keeps happening, reload the page or start a new conversation.</span>
      </div>
    </div>
  );
}

const meta = { title: "Conversation/WithheldReplyRecovery", component: Preview, parameters: { layout: "padded" } } satisfies Meta<typeof Preview>;
export default meta;
export const Withheld: StoryObj<typeof meta> = {};
