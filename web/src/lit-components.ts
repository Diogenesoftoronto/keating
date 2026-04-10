/**
 * Type declarations for Lit custom elements used in the chat interface.
 * React 19 natively supports Custom Elements, so we just declare them here.
 */
import type { ChatPanel } from "@mariozechner/pi-web-ui";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "pi-chat-panel": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<ChatPanel> }, ChatPanel>;
      "theme-toggle": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
