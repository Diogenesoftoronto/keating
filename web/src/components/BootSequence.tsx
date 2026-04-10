import { useEffect, useState } from "react";

const BOOT_LINES = [
  { text: "BIOS DATE 01/15/25 14:22:51 VER 0.1.3", delay: 0.1 },
  { text: "CPU: NEURAL-CORE x64 @ 3.2GHz", delay: 0.3 },
  { text: "MEMORY TEST: 16384K OK", delay: 0.5 },
  { text: "", delay: 0.7 },
  { text: "LOADING KEATING HYPERTEACHER MODULE...", delay: 0.9 },
  { text: "INITIALIZING SOCRATIC PROTOCOLS... [OK]", delay: 1.2 },
  { text: "MOUNTING KNOWLEDGE GRAPH... [OK]", delay: 1.5 },
  { text: "CALIBRATING DIAGNOSTIC ENGINE... [OK]", delay: 1.8 },
  { text: "", delay: 2.1 },
  { text: "SYSTEM READY.", delay: 2.4 },
];

export function BootSequence() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const shown = localStorage.getItem("keating_boot_shown") === "true";
    if (!shown) {
      setVisible(true);
      const fadeTimer = setTimeout(() => setFading(true), 3000);
      const hideTimer = setTimeout(() => {
        setVisible(false);
        localStorage.setItem("keating_boot_shown", "true");
      }, 3500);
      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(hideTimer);
      };
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 bg-[#0c0c0c] z-[60] font-terminal text-[#00ff00] p-8 overflow-hidden"
      style={{ opacity: fading ? 0 : 1, transition: "opacity 0.5s" }}
    >
      <div className="crt max-w-2xl mx-auto mt-20 text-lg leading-relaxed">
        {BOOT_LINES.map((line, i) => (
          <div
            key={i}
            className="boot-line"
            style={{ animationDelay: `${line.delay}s` }}
          >
            {line.text}
          </div>
        ))}
        <div
          className="boot-line cursor-blink"
          style={{ animationDelay: "2.7s" }}
        >
          _
        </div>
      </div>
    </div>
  );
}
