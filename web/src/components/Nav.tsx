import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ThemeToggle } from "./ThemeToggle";

interface NavProps {
  showFeatures?: boolean;
}

export function Nav({ showFeatures = false }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const closeMobile = () => setMobileOpen(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const handleResize = useCallback(() => {
    if (window.innerWidth >= 768) setMobileOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [mobileOpen]);

  return (
    <nav
      id="main-nav"
      className="retro-layout"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "2px solid var(--ink, #1a1a1a)",
        background: "var(--paper, #f4f1ea)",
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
          gap: "1rem",
        }}
      >
        {/* Logo */}
        <Link
          to="/"
          className="nav-logo"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            textDecoration: "none",
            color: "inherit",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          <div className="status-led shrink-0" />
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2 leading-tight">
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
              style={{ fontSize: "0.875rem", color: "var(--accent, #d44a3d)", whiteSpace: "nowrap" }}
            >
              v{import.meta.env.APP_VERSION}
            </span>
          </div>
        </Link>

        {/* Desktop links — visible at md (768px) and up, controlled by retro.css */}
        <div className="nav-desktop" style={{ alignItems: "center", gap: "1.5rem" }}>
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
          <Link to="/usage" className="nav-link glitch-hover font-terminal nav-desktop-link">
            [USAGE]
          </Link>
          <a
            href="https://github.com/Diogenesoftoronto/keating"
            target="_blank"
            rel="noreferrer"
            className="nav-link glitch-hover font-terminal nav-desktop-link"
          >
            [GITHUB]
          </a>
          <ThemeToggle />
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

        {/* Mobile actions + hamburger — visible below md (768px) */}
        <div className="nav-mobile-actions flex md:hidden items-center gap-2">
          <ThemeToggle />
          <button
            id="mobile-menu-btn"
            className="nav-mobile-toggle glitch-hover font-terminal"
            style={{
              color: "var(--ink, #1a1a1a)",
              border: "2px solid var(--ink, #1a1a1a)",
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
      </div>

      {/* Mobile dropdown — below md (768px) */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          ref={mobileMenuRef}
          style={{
            borderTop: "2px solid var(--ink, #1a1a1a)",
            background: "var(--paper, #f4f1ea)",
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
            <Link
              to="/usage"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              [USAGE]
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
