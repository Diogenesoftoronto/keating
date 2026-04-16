import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

interface NavProps {
  showFeatures?: boolean;
}

export function Nav({ showFeatures = false }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const closeMobile = () => setMobileOpen(false);

  // Close mobile menu on route change / resize past breakpoint
  const handleResize = useCallback(() => {
    if (window.innerWidth >= 768) setMobileOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <nav
      id="main-nav"
      className="retro-layout"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        borderBottom: "2px solid #1a1a1a",
        background: "rgba(244, 241, 234, 0.97)",
      }}
    >
      {/* Main bar */}
      <div
        style={{
          maxWidth: "72rem",
          margin: "0 auto",
          padding: "0 1rem",
          height: "3.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <Link
          to="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            textDecoration: "none",
            color: "inherit",
            flexShrink: 0,
          }}
        >
          <div className="status-led" />
          <span
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              whiteSpace: "nowrap",
            }}
          >
            KEATING//
          </span>
          <span
            className="font-terminal"
            style={{ fontSize: "1rem", color: "#d44a3d" }}
          >
            v{import.meta.env.APP_VERSION}
          </span>
        </Link>

        {/* Desktop links — visible at md (768px) and up */}
        <div className="nav-desktop" style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          {showFeatures && (
            <a href="#features" className="nav-link glitch-hover font-terminal nav-desktop-link">
              [FEATURES]
            </a>
          )}
          <Link to="/" className="nav-link glitch-hover font-terminal nav-desktop-link">
            [KEATING]
          </Link>
          <Link to="/tutorial" className="nav-link glitch-hover font-terminal nav-desktop-link">
            [TUTORIAL]
          </Link>
          <Link to="/blog" className="nav-link glitch-hover font-terminal nav-desktop-link">
            [BLOG]
          </Link>
          <Link to="/paper" className="nav-link glitch-hover font-terminal nav-desktop-link">
            [PAPER]
          </Link>
          <a
            href="https://github.com/Diogenesoftoronto/keating"
            target="_blank"
            rel="noreferrer"
            className="nav-link glitch-hover font-terminal nav-desktop-link"
          >
            [GITHUB]
          </a>
          <button
            className="btn-retro nav-desktop-link"
            style={{
              padding: "0.5rem 1rem",
              fontWeight: 700,
              fontSize: "0.875rem",
              fontFamily: "'VT323', monospace",
            }}
            onClick={() => navigate({ to: "/chat" })}
          >
            TRY_KEATING
          </button>
        </div>

        {/* Mobile hamburger — visible below md (768px) */}
        <button
          id="mobile-menu-btn"
          className="nav-mobile-toggle glitch-hover font-terminal"
          style={{
            color: "#1a1a1a",
            border: "2px solid #1a1a1a",
            padding: "0.375rem 0.75rem",
            cursor: "pointer",
            background: "transparent",
            fontSize: "1rem",
            transition: "background 0.15s, color 0.15s",
          }}
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? "[CLOSE]" : "[MENU]"}
        </button>
      </div>

      {/* Mobile dropdown — below md (768px) */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          style={{
            borderTop: "2px solid #1a1a1a",
            background: "#f4f1ea",
            maxHeight: "calc(100dvh - 3.5rem)",
            overflowY: "auto",
          }}
        >
          <div
            className="font-terminal"
            style={{
              padding: "0.75rem 1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
              fontSize: "1.125rem",
            }}
          >
            {showFeatures && (
              <a
                href="#features"
                className="nav-link glitch-hover"
                style={{ padding: "0.75rem 0.5rem" }}
                onClick={closeMobile}
              >
                [FEATURES]
              </a>
            )}
            <Link
              to="/"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              [KEATING]
            </Link>
            <Link
              to="/tutorial"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              [TUTORIAL]
            </Link>
            <Link
              to="/blog"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              [BLOG]
            </Link>
            <Link
              to="/paper"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              [PAPER]
            </Link>
            <a
              href="https://github.com/Diogenesoftoronto/keating"
              target="_blank"
              rel="noreferrer"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              [GITHUB]
            </a>
            <button
              className="btn-retro"
              style={{
                padding: "0.75rem 1rem",
                fontWeight: 700,
                fontSize: "1rem",
                marginTop: "0.5rem",
                width: "100%",
                fontFamily: "'VT323', monospace",
              }}
              onClick={() => {
                closeMobile();
                navigate({ to: "/chat" });
              }}
            >
              TRY_KEATING
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
