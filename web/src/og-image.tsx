/**
 * Open Graph image for Keating.
 * Rendered at build time via @vercel/og (Satori) — 1200×630px.
 * Rules: inline styles only, flexbox only (no grid), no pseudo-elements.
 */
export default function OgImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0c0c0c",
        fontFamily: "monospace",
        padding: "60px 72px",
        position: "relative",
      }}
    >
      {/* Scanline overlay approximation — horizontal stripes via repeating gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,255,0,0.015) 0px, rgba(0,255,0,0.015) 1px, transparent 1px, transparent 4px)",
          pointerEvents: "none",
        }}
      />

      {/* Top bar — status indicator + version */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "48px" }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: "#d44a3d",
            boxShadow: "0 0 10px #d44a3d",
          }}
        />
        <span style={{ color: "#d44a3d", fontSize: 22, letterSpacing: "0.1em" }}>
          KEATING // HYPERTEACHER
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "#00ff00", fontSize: 18, opacity: 0.6 }}>v0.1.3</span>
      </div>

      {/* Main headline */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            color: "#f4f1ea",
            lineHeight: 1,
            letterSpacing: "-0.02em",
            marginBottom: "8px",
          }}
        >
          THE
        </div>
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            color: "#f4f1ea",
            lineHeight: 1,
            letterSpacing: "-0.02em",
            marginBottom: "32px",
          }}
        >
          HYPERTEACHER
        </div>

        {/* Accent tagline */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "40px",
          }}
        >
          <div style={{ width: 4, height: 48, backgroundColor: "#d44a3d" }} />
          <span
            style={{
              fontSize: 42,
              color: "#d44a3d",
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            THINK_FOR_YOURSELF
          </span>
        </div>

        <div
          style={{
            fontSize: 24,
            color: "#f4f1ea",
            opacity: 0.55,
            maxWidth: 640,
            lineHeight: 1.5,
          }}
        >
          Socratic AI that forces you to reconstruct understanding from memory. No hand-holding.
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "32px",
          borderTop: "1px solid rgba(0,255,0,0.2)",
        }}
      >
        {/* Terminal prompt */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ color: "#00ff00", fontSize: 22, opacity: 0.8 }}>$</span>
          <span style={{ color: "#00ff00", fontSize: 22, opacity: 0.8 }}>
            keating --mode socratic
          </span>
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: "12px" }}>
          {["FREE", "OPEN SOURCE", "LOCAL AI"].map((label) => (
            <div
              key={label}
              style={{
                border: "1px solid rgba(0,255,0,0.4)",
                color: "#00ff00",
                fontSize: 16,
                padding: "6px 14px",
                letterSpacing: "0.08em",
              }}
            >
              {label}
            </div>
          ))}
        </div>

        <span style={{ color: "#f4f1ea", fontSize: 20, opacity: 0.4 }}>keating.help</span>
      </div>
    </div>
  );
}
