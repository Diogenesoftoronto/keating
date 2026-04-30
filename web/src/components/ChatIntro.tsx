import { useState, useEffect } from "react";

const KEATING_ASCII = `
██╗  ██╗███████╗ █████╗ ████████╗██╗███╗   ██╗ ██████╗
██║ ██╔╝██╔════╝██╔══██╗╚══██╔══╝██║████╗  ██║██╔════╝
█████╔╝ █████╗  ███████║   ██║   ██║██╔██╗ ██║██║  ███╗
██╔═██╗ ██╔══╝  ██╔══██║   ██║   ██║██║╚██╗██║██║   ██║
██║  ██╗███████╗██║  ██║   ██║   ██║██║ ╚████║╚██████╔╝
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝
`.trim();

const INTRO_LINES = [
  { text: "INIT SEQUENCE v0.3.0", delay: 100 },
  { text: "─────────────────────────────────────────", delay: 200 },
  { text: "model   : gemini-2.5-flash", delay: 300 },
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
    <div className="w-full h-full bg-[#0c0c0c] text-[#00ff00] font-terminal overflow-auto p-6 sm:p-8">
      <div className="crt max-w-2xl mx-auto">
        {/* ASCII logo */}
        <pre
          className="text-[0.55rem] sm:text-xs md:text-sm leading-[1.05] mb-4 whitespace-pre font-bold tracking-tight"
          style={{
            background: "linear-gradient(180deg, #34d399 0%, #10b981 55%, #059669 100%)",
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
        <div className="text-sm sm:text-base leading-relaxed space-y-0.5">
          {INTRO_LINES.slice(0, visibleLines).map((line, i) => (
            <div
              key={i}
              className="boot-line font-terminal"
              style={{ opacity: 1 }}
            >
              {line.text ? (
                line.text.startsWith("▸") ? (
                  <span className="text-[#10b981]">{line.text}</span>
                ) : line.text.startsWith('"') ? (
                  <span className="text-[#888]">{line.text}</span>
                ) : line.text.startsWith("—") ? (
                  <span className="text-[#666]">{line.text}</span>
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
          <div className="mt-4 flex items-center gap-3">
            <span className="cursor-blink">_</span>
            <span className="text-[#666] text-sm animate-pulse">
              Type below to begin your session...
            </span>
          </div>
        )}
      </div>

      {/* Scanline overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-10"
        style={{
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.03), rgba(0,0,0,0.03) 1px, transparent 1px, transparent 2px)",
        }}
      />
    </div>
  );
}
