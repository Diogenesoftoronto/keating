import { useEffect, useState } from "react";
import { css, cx } from "../../styled-system/css";

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
      className={cx(
        "font-terminal",
        css({
          position: "fixed",
          inset: 0,
          background: "#0c1510",
          zIndex: 60,
          color: "#4be388",
          padding: "2rem",
          overflow: "hidden",
          transitionProperty: "opacity",
          transitionDuration: "500ms"
        })
      )}
      style={{ opacity: fading ? 0 : 1 }}
    >
      <div
        className={cx(
          "crt",
          css({
            maxWidth: "42rem",
            marginInline: "auto",
            marginTop: "5rem",
            fontSize: "1.125rem",
            lineHeight: "1.625"
          })
        )}
      >
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
          className={cx("boot-line", "cursor-blink")}
          style={{ animationDelay: "2.7s" }}
        >
          _
        </div>
      </div>
    </div>
  );
}
