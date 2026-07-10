import { useState, useEffect } from "react";
import { css, cx } from "../../styled-system/css";

const KEATING_ASCII = `
██╗  ██╗███████╗ █████╗ ████████╗██╗███╗   ██╗ ██████╗
██║ ██╔╝██╔════╝██╔══██╗╚══██╔══╝██║████╗  ██║██╔════╝
█████╔╝ █████╗  ███████║   ██║   ██║██╔██╗ ██║██║  ███╗
██╔═██╗ ██╔══╝  ██╔══██║   ██║   ██║██║╚██╗██║██║   ██║
██║  ██╗███████╗██║  ██║   ██║   ██║██║ ╚████║╚██████╔╝
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝
`.trim();

const INTRO_LINES = [
  { text: "INIT SEQUENCE v2.2.0", delay: 100 },
  { text: "─────────────────────────────────────────", delay: 200 },
  { text: "model   : Kimi k2.6", delay: 300 },
  { text: "policy  : keating-default", delay: 400 },
  { text: "system  : Socratic teaching engine", delay: 500 },
  { text: "tools   : plan, map, verify, animate, bench, evolve", delay: 600 },
  { text: "", delay: 700 },
  { text: "▸ Type a topic to begin learning", delay: 800 },
  { text: "▸ Available: /plan /map /verify /animate /bench /evolve", delay: 900 },
  { text: "", delay: 1000 },
  { text: '\"That the powerful play goes on, and you may contribute a verse.\"', delay: 1200 },
  { text: "                                                          — Whitman", delay: 1300 },
];

export function ChatIntro({ onDismiss }: { onDismiss?: () => void }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [typingDone, setTypingDone] = useState(false);

  useEffect(() => {
    let timeouts: number[] = [];
    INTRO_LINES.forEach((line, i) => {
      const t = window.setTimeout(() => {
        setVisibleLines(i + 1);
        if (i === INTRO_LINES.length - 1) {
          window.setTimeout(() => setTypingDone(true), 400);
        }
      }, line.delay);
      timeouts.push(t);
    });
    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <div
      className={cx(
        "font-terminal",
        css({
          width: "100%",
          height: "100%",
          background: "#0c1510",
          color: "#4be388",
          overflow: "auto",
          padding: { base: "1.5rem", sm: "2rem" }
        })
      )}
    >
      <div className={cx("crt", css({ maxWidth: "42rem", marginInline: "auto" }))}>
        {/* ASCII logo */}
        <pre
          className={css({
            fontSize: { base: "0.55rem", sm: "0.75rem", md: "0.875rem" },
            lineHeight: "1.05",
            marginBottom: "1rem",
            whiteSpace: "pre",
            fontWeight: 700,
            letterSpacing: "-0.025em"
          })}
          style={{
            background: "linear-gradient(180deg, #4be388 0%, #1e9b50 55%, #14743c 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            textShadow: "0 0 18px rgba(16,185,129,0.35)",
            filter: "drop-shadow(0 0 6px rgba(16,185,129,0.25))",
          }}
        >
          {KEATING_ASCII}
        </pre>

        {/* Terminal lines */}
        <div
          className={css({
            fontSize: { base: "0.875rem", sm: "1rem" },
            lineHeight: "1.625",
            "& > * + *": { marginTop: "0.125rem" }
          })}
        >
          {INTRO_LINES.slice(0, visibleLines).map((line, i) => (
            <div
              key={i}
              className={cx("boot-line", "font-terminal")}
              style={{ opacity: 1 }}
            >
              {line.text ? (
                line.text.startsWith("▸") ? (
                  <span className={css({ color: "#1e9b50" })}>{line.text}</span>
                ) : line.text.startsWith('"') ? (
                  <span className={css({ color: "#888" })}>{line.text}</span>
                ) : line.text.startsWith("—") ? (
                  <span className={css({ color: "#666" })}>{line.text}</span>
                ) : (
                  line.text
                )
              ) : (
                <br />
              )}
            </div>
          ))}
        </div>

        {/* Cursor + dismiss hint */}
        {typingDone && (
          <div className={css({ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" })}>
            <span className="cursor-blink">_</span>
            <span
              className={css({
                color: "#666",
                fontSize: "0.875rem",
                animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
              })}
            >
              Press getting started below to begin your session...
            </span>
          </div>
        )}
      </div>

      {/* Scanline overlay */}
      <div
        className={css({
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 10
        })}
        style={{
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.03), rgba(0,0,0,0.03) 1px, transparent 1px, transparent 2px)",
        }}
      />
    </div>
  );
}
