import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

interface NavProps {
  showFeatures?: boolean;
}

export function Nav({ showFeatures = false }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const closeMobile = () => setMobileOpen(false);

  return (
    <nav className="retro-layout fixed top-0 left-0 right-0 z-50 border-b-2 border-[#1a1a1a]"
         style={{ background: 'rgba(244, 241, 234, 0.97)' }}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="status-led" />
          <span className="text-sm sm:text-xl font-bold tracking-tight whitespace-nowrap">KEATING//</span>
          <span className="font-terminal text-xs sm:text-lg text-[#d44a3d]">v0.1.4</span>
        </Link>

        {/* Desktop: horizontal row (sm and up) */}
        <div className="hidden sm:flex items-center gap-4 md:gap-6 lg:gap-8 font-terminal text-sm md:text-base lg:text-lg">
          {showFeatures && (
            <a href="#features" className="nav-link glitch-hover">[FEATURES]</a>
          )}
          <Link to="/tutorial" className="nav-link glitch-hover">[TUTORIAL]</Link>
          <Link to="/blog" className="nav-link glitch-hover">[BLOG]</Link>
          <Link to="/paper" className="nav-link glitch-hover">[PAPER]</Link>
          <a
            href="https://github.com/Diogenesoftoronto/keating"
            target="_blank"
            rel="noreferrer"
            className="nav-link glitch-hover hidden md:inline"
          >
            [GITHUB]
          </a>
          <button
            className="btn-retro px-4 py-2 font-bold text-sm"
            onClick={() => navigate({ to: "/chat" })}
          >
            TRY_KEATING
          </button>
        </div>

        {/* Mobile: hamburger toggle (below sm) */}
        <button
          className="sm:hidden font-terminal text-[#1a1a1a] border-2 border-[#1a1a1a] px-3 py-1.5 hover:bg-[#1a1a1a] hover:text-[#f4f1ea] transition-colors text-base glitch-hover"
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? "[CLOSE]" : "[MENU]"}
        </button>
      </div>

      {/* Mobile: vertical dropdown (below sm) */}
      {mobileOpen && (
        <div className="sm:hidden border-t-2 border-[#1a1a1a] bg-[#f4f1ea] overflow-y-auto"
             style={{ maxHeight: 'calc(100dvh - 56px)' }}>
          <div className="px-4 py-3 flex flex-col gap-1 font-terminal text-lg">
            {showFeatures && (
              <a
                href="#features"
                className="nav-link glitch-hover py-3 px-2"
                onClick={closeMobile}
              >
                [FEATURES]
              </a>
            )}
            <Link to="/tutorial" className="nav-link glitch-hover py-3 px-2" onClick={closeMobile}>
              [TUTORIAL]
            </Link>
            <Link to="/blog" className="nav-link glitch-hover py-3 px-2" onClick={closeMobile}>
              [BLOG]
            </Link>
            <Link to="/paper" className="nav-link glitch-hover py-3 px-2" onClick={closeMobile}>
              [PAPER]
            </Link>
            <a
              href="https://github.com/Diogenesoftoronto/keating"
              target="_blank"
              rel="noreferrer"
              className="nav-link glitch-hover py-3 px-2"
              onClick={closeMobile}
            >
              [GITHUB]
            </a>
            <button
              className="btn-retro px-4 py-3 font-bold text-base mt-2 w-full"
              onClick={() => { closeMobile(); navigate({ to: "/chat" }); }}
            >
              TRY_KEATING
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
