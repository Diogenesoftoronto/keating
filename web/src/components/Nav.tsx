import { useEffect, useReducer, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppLink as Link } from "./AppLink";
import { DOCUMENTATION_URL } from "../lib/tutorial-links";
import { BLOG_URL } from "../lib/blog-links";
import { applicationRootHref, hostedNavigationHref } from "../lib/hosted-navigation";
import { desktopMarketingUrl, isDesktopShell } from "../lib/desktop-navigation";
import { T, useGT } from "gt-react";
import { KeatingGlyph } from "../design-system/glyphs";
import { ThemeToggle } from "./ThemeToggle";
import { css, cx } from "../../styled-system/css";
import { btnRetro } from "../../styled-system/recipes";

const DESKTOP_NAV_MIN_WIDTH = 1152;
const PUBLIC_NAV_MIN_WIDTH = 960;

export const appNavLinks = {
  chat: (href: string) => [href, "Chat"] as const,
  courses: ["/courses", "Courses"],
  rooms: ["/rooms", "Rooms"],
  activity: ["/usage", "Usage"],
  reviews: ["/review", "Session review"],
} as const;

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

interface NavProps {
  publication?: boolean;
  primaryAction?: "chat" | "download";
}

export function Nav({ primaryAction = "chat", publication = false }: NavProps) {
  const [menus, dispatch] = useReducer(navMenuReducer, { mobileOpen: false, moreOpen: false });
  const navigate = useNavigate();
  const gt = useGT();
  const closeMenus = () => dispatch({ type: "close-all" });
  const hostname = typeof window !== "undefined" ? window.location?.hostname ?? "" : "";
  const appOnly = import.meta.env.KEATING_WEB_BUILD_TARGET === "app";
  const appNavigation = appOnly || hostname === "chat.keating.help" || isDesktopShell();
  const chatHref = applicationRootHref(hostname, appOnly);
  const primaryLinks = appNavigation
    ? [appNavLinks.chat(chatHref), appNavLinks.courses, appNavLinks.rooms, appNavLinks.activity, ["/bench", "Bench"], ["/coming-up", "Coming up"], ["/live", "Live"]]
    : [["/download", "Download"], ["/pricing", "Pricing"], [DOCUMENTATION_URL, "Documentation"], [BLOG_URL, "Blog"], ["/paper", "Paper"]].filter(([to]) => primaryAction !== "download" || to !== "/download");
  const secondaryLinks = appNavigation
    ? [["https://keating.help/", "Keating website"], ["/download", "Download"], ["/pricing", "Pricing"], [DOCUMENTATION_URL, "Documentation"], [BLOG_URL, "Blog"], ["/paper", "Paper"], ["/learn", "Self-paced courses"], appNavLinks.reviews, ["/review/learning-profile", "Your public profile"], ["/training-data", "Training data"]]
    : [appNavLinks.courses, ["/learn", "Self-paced courses"], appNavLinks.rooms, ["/coming-up", "Coming up"], ["/live", "Live"], appNavLinks.activity, ["/bench", "Bench"], ["/training-data", "Training data"]];
  const openPrimaryAction = () => {
    closeMenus();
    const path = primaryAction === "download" ? "/download" : chatHref;
    const destination = hostedNavigationHref(path, hostname, appOnly);
    const external = isDesktopShell() ? desktopMarketingUrl(destination) : null;
    if (external) window.open(external, "_blank", "noopener,noreferrer");
    else if (destination.startsWith("https://")) window.location.assign(destination);
    else void navigate({ to: destination });
  };
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const minDesktopWidth = publication ? PUBLIC_NAV_MIN_WIDTH : DESKTOP_NAV_MIN_WIDTH;
    const handleResize = () => {
      dispatch({ type: window.innerWidth >= minDesktopWidth ? "close-mobile" : "close-more" });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [publication]);

  useEffect(() => {
    if (!menus.mobileOpen && !menus.moreOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (publication) {
        if (menus.mobileOpen) toggleButtonRef.current?.focus();
        else moreMenuRef.current?.querySelector("button")?.focus();
      }
      dispatch({ type: "close-all" });
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
  }, [menus.mobileOpen, menus.moreOpen, publication]);

  if (publication) {
    const isDownload = primaryAction === "download";
    const action = <Link className="pub-nav-action" to={isDownload ? "/download" : chatHref} onClick={closeMenus}>
      {isDownload ? <T>Download alpha</T> : <T>Open Keating</T>}
      <KeatingGlyph name={isDownload ? "export" : "right"} size={16} />
    </Link>;
    const links = (items: ReadonlyArray<readonly string[]>) => items.map(([to, label]) =>
      <Link key={to} to={to} onClick={closeMenus}>{gt(label)}</Link>
    );
    const source = <a href="https://github.com/Diogenesoftoronto/keating" target="_blank" rel="noreferrer" onClick={closeMenus}>
      GitHub <KeatingGlyph name="ext" size={13} />
    </a>;
    return <nav id="main-nav" className="pub-nav" aria-label={gt("Main navigation")}>
      <div className="pub-nav-bar">
        <Link className="pub-brand" to="/" onClick={closeMenus}>
          <img src="/brand/logo-lockup-compact.avif" alt="Keating" />
          <span>v{import.meta.env.APP_VERSION}</span>
        </Link>
        <div className="pub-nav-wide">
          {links(primaryLinks)}
          <div className="pub-more" ref={moreMenuRef}>
            <button type="button" className="pub-menu-toggle" aria-expanded={menus.moreOpen}
              aria-controls="publication-more" onClick={() => dispatch({ type: "toggle-more" })}>
              <T>More</T><KeatingGlyph name="chev" size={13} />
            </button>
            {menus.moreOpen && <div id="publication-more" className="pub-nav-sheet">{links(secondaryLinks)}{source}</div>}
          </div>
          <ThemeToggle />
        </div>
        <div className="pub-nav-end">
          {action}
          <button type="button" ref={toggleButtonRef} className="pub-menu-toggle pub-compact-toggle"
            aria-label={gt(menus.mobileOpen ? "Close navigation menu" : "Open navigation menu")}
            aria-expanded={menus.mobileOpen} aria-controls="publication-menu"
            onClick={() => dispatch({ type: "toggle-mobile" })}>
            <KeatingGlyph name={menus.mobileOpen ? "x" : "menu"} size={20} />
          </button>
        </div>
      </div>
      {menus.mobileOpen && <div id="publication-menu" className="pub-menu-panel" ref={mobileMenuRef}>
        <div className="pub-menu-inner">
          <div className="pub-site-links">{links(primaryLinks)}</div>
          <div className="pub-tool-links">{links(secondaryLinks)}{source}</div>
          <ThemeToggle variant="menu" onToggled={closeMenus} />
        </div>
      </div>}
    </nav>;
  }

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
          to={appNavigation ? chatHref : "/"}
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
					src="/brand/logo-lockup-compact.avif"
            alt="Keating"
            style={{ height: "1.875rem", width: "auto" }}
          />
          <span className="nav-version font-terminal">v{import.meta.env.APP_VERSION}</span>
        </Link>

        {/* Desktop links — visible only when the full navigation has reliable room. */}
        <div className="nav-desktop" style={{ alignItems: "center", gap: "1rem" }}>
          {primaryLinks.map(([to, label]) => <Link key={to} to={to} className="nav-link glitch-hover font-terminal nav-desktop-link">{gt(label)}</Link>)}
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
                    _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "-2px" }
                  }
                })}
              >
                {secondaryLinks.map(([to, label]) => <Link key={to} to={to} className="nav-link glitch-hover font-terminal" onClick={closeMenus}>{gt(label)}</Link>)}
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
            onClick={openPrimaryAction}
          >
            {primaryAction === "download" ? <T>Download Keating</T> : appNavigation ? <T>Open chat</T> : <T>Open Keating</T>}
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
            {[...primaryLinks, ...secondaryLinks].map(([to, label]) => <Link key={to} to={to} className="nav-link glitch-hover" style={{ padding: "0.75rem 0.5rem" }} onClick={closeMenus}>{gt(label)}</Link>)}
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
              onClick={openPrimaryAction}
            >
              {primaryAction === "download" ? <T>Download Keating</T> : appNavigation ? <T>Open chat</T> : <T>Open Keating</T>}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
