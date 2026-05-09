/**
 * Type declarations for Lit custom elements used in the chat interface.
 * React 19 natively supports Custom Elements, so we just declare them here.
 */

import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "theme-toggle": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "markdown-block": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { content?: string }, HTMLElement>;
    }
  }
}

export {};
