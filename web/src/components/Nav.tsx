import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ThemeToggle } from "./ThemeToggle";
import { css, cx } from "../../styled-system/css";
import { btnRetro } from "../../styled-system/recipes";

export function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const gt = useGT();
  const closeMobile = () => setMobileOpen(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

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
      const target = e.target as Node;
      if (toggleButtonRef.current && toggleButtonRef.current.contains(target)) return;
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) {
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
        borderBottom: "2px solid var(--ink, #1c211b)",
        background: "var(--paper, #f1ece0)",
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
          <img
            src="/brand/logo-lockup.png"
            alt="Keating"
            style={{ height: "1.875rem", width: "auto" }}
          />
          <span className="nav-version font-terminal">v{import.meta.env.APP_VERSION}</span>
        </Link>

        {/* Desktop links — visible at md (768px) and up, controlled by Panda globalCss */}
        <div className="nav-desktop" style={{ alignItems: "center", gap: "1.5rem" }}>
          <Link to="/download" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[DOWNLOAD]</T>
          </Link>
          <Link to="/pricing" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[PRICING]</T>
          </Link>
          <Link to="/tutorial" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[TUTORIAL]</T>
          </Link>
          <Link to="/blog" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[BLOG]</T>
          </Link>
          <Link to="/paper" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[PAPER]</T>
          </Link>
          <Link to="/usage" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[USAGE]</T>
          </Link>
          <Link to="/bench" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[BENCH]</T>
          </Link>
          <div className="nav-status" role="status">
            <span className="dot" />
            <T>SYSTEM ONLINE</T>
          </div>
          <ThemeToggle />
          <button
            className={cx(btnRetro(), "nav-desktop-link")}
            style={{
              padding: "0.5rem 1rem",
              fontWeight: 700,
              fontSize: "0.875rem",
              fontFamily: "'VT323', monospace",
            }}
            onClick={() => navigate({ to: "/chat" })}
          >
            <T>TRY_KEATING</T>
          </button>
        </div>

        {/* Mobile actions + hamburger — visible below md (768px) */}
        <div
          className={cx(
            "nav-mobile-actions",
            css({
              display: { base: "flex", md: "none" },
              alignItems: "center",
              gap: "0.5rem"
            })
          )}
        >
          <ThemeToggle />
          <button
            ref={toggleButtonRef}
            id="mobile-menu-btn"
            className="nav-mobile-toggle glitch-hover font-terminal"
            style={{
              color: "var(--ink, #1c211b)",
              border: "2px solid var(--ink, #1c211b)",
              padding: "0.375rem 0.75rem",
              cursor: "pointer",
              background: "transparent",
              fontSize: "1rem",
              transition: "background 0.15s, color 0.15s",
            }}
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            aria-label={gt("Toggle navigation menu")}
          >
            {mobileOpen ? <T>[CLOSE]</T> : <T>[MENU]</T>}
          </button>
        </div>
      </div>

      {/* Mobile dropdown — below md (768px) */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          ref={mobileMenuRef}
          style={{
            borderTop: "2px solid var(--ink, #1c211b)",
            background: "var(--paper, #f1ece0)",
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
            <Link
              to="/download"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[DOWNLOAD]</T>
            </Link>
            <Link
              to="/pricing"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[PRICING]</T>
            </Link>
            <Link
              to="/tutorial"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[TUTORIAL]</T>
            </Link>
            <Link
              to="/blog"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[BLOG]</T>
            </Link>
            <Link
              to="/paper"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[PAPER]</T>
            </Link>
            <Link
              to="/usage"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[USAGE]</T>
            </Link>
            <Link
              to="/bench"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[BENCH]</T>
            </Link>
            <a
              href="https://github.com/Diogenesoftoronto/keating"
              target="_blank"
              rel="noreferrer"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMobile}
            >
              <T>[GITHUB]</T>
            </a>
            <button
              className={btnRetro()}
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
              <T>TRY_KEATING</T>
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
