/**
 * @lit/react wrappers for Lit custom elements used in the chat interface.
 * createComponent() handles property passing, event forwarding, and ref support
 * so these can be used in JSX like regular React components.
 */
import React from "react";
import { createComponent } from "@lit/react";
import { ChatPanel } from "@mariozechner/pi-web-ui";
import { ThemeToggle } from "@mariozechner/mini-lit/dist/ThemeToggle.js";

export const ChatPanelComponent = createComponent({
  react: React,
  tagName: "pi-chat-panel",
  elementClass: ChatPanel,
});

export const ThemeToggleComponent = createComponent({
  react: React,
  tagName: "theme-toggle",
  elementClass: ThemeToggle,
});
