import { useEffect, useReducer, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ThemeToggle } from "./ThemeToggle";
import { css, cx } from "../../styled-system/css";
import { btnRetro } from "../../styled-system/recipes";

const DESKTOP_NAV_MIN_WIDTH = 1152;

interface NavMenuState {
  mobileOpen: boolean;
  moreOpen: boolean;
}

type NavMenuAction =
  | { type: "toggle-mobile" }
  | { type: "toggle-more" }
  | { type: "close-mobile" }
  | { type: "close-more" }
  | { type: "close-all" };

function navMenuReducer(state: NavMenuState, action: NavMenuAction): NavMenuState {
  switch (action.type) {
    case "toggle-mobile":
      return { mobileOpen: !state.mobileOpen, moreOpen: false };
    case "toggle-more":
      return { mobileOpen: false, moreOpen: !state.moreOpen };
    case "close-mobile":
      return state.mobileOpen ? { ...state, mobileOpen: false } : state;
    case "close-more":
      return state.moreOpen ? { ...state, moreOpen: false } : state;
    case "close-all":
      return state.mobileOpen || state.moreOpen ? { mobileOpen: false, moreOpen: false } : state;
  }
}

export function Nav() {
  const [menus, dispatch] = useReducer(navMenuReducer, { mobileOpen: false, moreOpen: false });
  const navigate = useNavigate();
  const gt = useGT();
  const closeMenus = () => dispatch({ type: "close-all" });
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      dispatch({ type: window.innerWidth >= DESKTOP_NAV_MIN_WIDTH ? "close-mobile" : "close-more" });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!menus.mobileOpen && !menus.moreOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "close-all" });
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (toggleButtonRef.current && toggleButtonRef.current.contains(target)) return;
      if (mobileMenuRef.current?.contains(target) || moreMenuRef.current?.contains(target)) return;
      dispatch({ type: "close-all" });
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menus.mobileOpen, menus.moreOpen]);

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

        {/* Desktop links — visible only when the full navigation has reliable room. */}
        <div className="nav-desktop" style={{ alignItems: "center", gap: "1rem" }}>
          <Link to="/pricing" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[PRICING]</T>
          </Link>
          <Link to="/courses" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[COURSES]</T>
          </Link>
          <Link to="/coming-up" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[COMING UP]</T>
          </Link>
          <Link to="/blog" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[BLOG]</T>
          </Link>
          <Link to="/live" className="nav-link glitch-hover font-terminal nav-desktop-link">
            <T>[LIVE]</T>
          </Link>
          <div ref={moreMenuRef} className={css({ position: "relative" })}>
            <button
              type="button"
              className="nav-link glitch-hover font-terminal nav-desktop-link"
              aria-expanded={menus.moreOpen}
              aria-controls="desktop-more-menu"
              aria-haspopup="true"
              onClick={() => dispatch({ type: "toggle-more" })}
            >
              <T>[MORE]</T>
            </button>
            {menus.moreOpen && (
              <div
                id="desktop-more-menu"
                aria-label={gt("More navigation")}
                className={css({
                  position: "absolute",
                  top: "calc(100% + 0.75rem)",
                  right: 0,
                  zIndex: 60,
                  display: "grid",
                  minWidth: "13rem",
                  border: "2px solid var(--ink)",
                  background: "var(--paper)",
                  padding: "0.5rem",
                  boxShadow: "5px 5px 0 var(--accent-dim)",
                  "& > a": {
                    padding: "0.65rem 0.75rem",
                    whiteSpace: "nowrap",
                    _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-2px" }
                  }
                })}
              >
                <Link to="/download" className="nav-link glitch-hover font-terminal" onClick={closeMenus}><T>[DOWNLOAD]</T></Link>
                <Link to="/tutorial" className="nav-link glitch-hover font-terminal" onClick={closeMenus}><T>[TUTORIAL]</T></Link>
                <Link to="/paper" className="nav-link glitch-hover font-terminal" onClick={closeMenus}><T>[PAPER]</T></Link>
                <Link to="/usage" className="nav-link glitch-hover font-terminal" onClick={closeMenus}><T>[USAGE]</T></Link>
                <Link to="/bench" className="nav-link glitch-hover font-terminal" onClick={closeMenus}><T>[BENCH]</T></Link>
                <a href="https://github.com/Diogenesoftoronto/keating" target="_blank" rel="noreferrer" className="nav-link glitch-hover font-terminal" onClick={closeMenus}><T>[GITHUB]</T></a>
              </div>
            )}
          </div>
          <ThemeToggle />
          <button
            className={cx(btnRetro(), "nav-desktop-link")}
            style={{
              padding: "0.5rem 0.75rem",
              fontWeight: 700,
              fontSize: "0.875rem",
              fontFamily: "'VT323', monospace",
            }}
            onClick={() => navigate({ to: "/chat" })}
          >
            <T>TRY_KEATING</T>
          </button>
        </div>

        {/* Compact navigation — used through tablet and narrow desktop widths. */}
        <div
          className={cx(
            "nav-mobile-actions",
            css({
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            })
          )}
        >
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
            onClick={() => dispatch({ type: "toggle-mobile" })}
            aria-expanded={menus.mobileOpen}
            aria-controls="mobile-menu"
            aria-label={gt("Toggle navigation menu")}
          >
            {menus.mobileOpen ? <T>[CLOSE]</T> : <T>[MENU]</T>}
          </button>
        </div>
      </div>

      {/* Compact dropdown — used below the wide-desktop breakpoint. */}
      {menus.mobileOpen && (
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
            <ThemeToggle
              variant="menu"
              onToggled={closeMenus}
              className={css({ width: "100%", marginBottom: "0.25rem" })}
            />
            <Link
              to="/download"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[DOWNLOAD]</T>
            </Link>
            <Link
              to="/pricing"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[PRICING]</T>
            </Link>
            <Link
              to="/courses"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[COURSES]</T>
            </Link>
            <Link
              to="/coming-up"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[COMING UP]</T>
            </Link>
            <Link
              to="/tutorial"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[TUTORIAL]</T>
            </Link>
            <Link
              to="/blog"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[BLOG]</T>
            </Link>
            <Link
              to="/paper"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[PAPER]</T>
            </Link>
            <Link
              to="/usage"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[USAGE]</T>
            </Link>
            <Link
              to="/bench"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[BENCH]</T>
            </Link>
            <Link
              to="/live"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
            >
              <T>[LIVE]</T>
            </Link>
            <a
              href="https://github.com/Diogenesoftoronto/keating"
              target="_blank"
              rel="noreferrer"
              className="nav-link glitch-hover"
              style={{ padding: "0.75rem 0.5rem" }}
              onClick={closeMenus}
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
                closeMenus();
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
