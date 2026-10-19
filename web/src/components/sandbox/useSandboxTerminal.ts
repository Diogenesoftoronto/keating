/**
 * Terminal attachment for the sandbox shell tab: owns the container ref and
 * readiness flag, re-attaches/fits the NodePod terminal when the tab is shown,
 * and exposes create/detach hooks for boot and teardown.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import {
  nodePodCreateTerminal,
  nodePodDetachTerminal,
  nodePodGetTerminal,
} from "../../keating/nodepod-runtime";

export function useSandboxTerminal({
  open,
  nodePodActive,
  shellTabActive,
}: {
  open: boolean;
  nodePodActive: boolean;
  shellTabActive: boolean;
}) {
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  /* Fit the terminal to its visible panel, including after reopening. */
  useEffect(() => {
    if (!open || !nodePodActive || !shellTabActive) return;
    const term = nodePodGetTerminal();
    const container = terminalContainerRef.current;
    if (!term || !container) return;
    term.attach(container);
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { term.fit(); setTerminalReady(true); });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open, shellTabActive, nodePodActive]);

  /** Creates the NodePod terminal after boot and attaches it if the shell tab is mounted. */
  const createAndAttachTerminal = useCallback(() => {
    const term = nodePodCreateTerminal({
      Terminal: XTerm,
      FitAddon,
      SerializeAddon,
    });
    if (term) {
      if (terminalContainerRef.current) {
        term.attach(terminalContainerRef.current);
        term.fit();
      }
      setTerminalReady(true);
    }
  }, []);

  /** Detaches the terminal ahead of teardown. */
  const detachTerminal = useCallback(() => {
    nodePodDetachTerminal();
    setTerminalReady(false);
  }, []);

  const clearTerminal = useCallback(() => {
    const term = nodePodGetTerminal();
    if (term) term.clear();
  }, []);

  const fitTerminal = useCallback(() => {
    const term = nodePodGetTerminal();
    if (term) requestAnimationFrame(() => term.fit());
  }, []);

  return {
    terminalContainerRef,
    terminalReady,
    createAndAttachTerminal,
    detachTerminal,
    clearTerminal,
    fitTerminal,
  };
}

export type SandboxTerminal = ReturnType<typeof useSandboxTerminal>;
