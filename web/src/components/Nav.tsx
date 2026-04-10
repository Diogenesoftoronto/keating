import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface NavProps {
  showFeatures?: boolean;
}

export function Nav({ showFeatures = false }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const closeMobile = () => setMobileOpen(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#f4f1ea]/95 border-b-2 border-[#1a1a1a] backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="status-led" />
          <span className="text-lg sm:text-xl font-bold tracking-tight">KEATING//</span>
          <span className="font-terminal text-sm sm:text-lg text-[#d44a3d]">v0.1.3</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6 lg:gap-8 font-terminal text-base lg:text-lg">
          {showFeatures && (
            <a href="#features" className="hover:text-[#d44a3d] transition-colors glitch-hover">[FEATURES]</a>
          )}
          <Link to="/tutorial" className="hover:text-[#d44a3d] transition-colors glitch-hover">[TUTORIAL]</Link>
          <Link to="/blog" className="hover:text-[#d44a3d] transition-colors glitch-hover">[BLOG]</Link>
          <a
            href="https://github.com/Diogenesoftoronto/keating"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#d44a3d] transition-colors glitch-hover"
          >
            [GITHUB]
          </a>
          <button
            className="btn-retro px-4 py-2 font-bold text-sm min-h-[44px]"
            onClick={() => navigate("/chat")}
          >
            TRY_KEATING
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden font-terminal text-[#1a1a1a] border-2 border-[#1a1a1a] px-4 py-2 min-h-[44px] min-w-[44px] hover:bg-[#1a1a1a] hover:text-[#f4f1ea] transition-colors text-lg"
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? "[CLOSE]" : "[MENU]"}
        </button>
      </div>

      {/* Mobile nav dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t-2 border-[#1a1a1a] bg-[#f4f1ea] overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 56px)' }}>
          <div className="px-4 py-4 flex flex-col gap-2 font-terminal text-base">
            {showFeatures && (
              <a
                href="#features"
                className="hover:text-[#d44a3d] transition-colors py-3 px-2 min-h-[48px] flex items-center"
                onClick={closeMobile}
              >
                [FEATURES]
              </a>
            )}
            <Link
              to="/tutorial"
              className="hover:text-[#d44a3d] transition-colors py-3 px-2 min-h-[48px] flex items-center"
              onClick={closeMobile}
            >
              [TUTORIAL]
            </Link>
            <Link
              to="/blog"
              className="hover:text-[#d44a3d] transition-colors py-3 px-2 min-h-[48px] flex items-center"
              onClick={closeMobile}
            >
              [BLOG]
            </Link>
            <a
              href="https://github.com/Diogenesoftoronto/keating"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#d44a3d] transition-colors py-3 px-2 min-h-[48px] flex items-center"
              onClick={closeMobile}
            >
              [GITHUB]
            </a>
            <button
              className="btn-retro px-4 py-4 font-bold text-base mt-2 w-full min-h-[48px]"
              onClick={() => { closeMobile(); navigate("/chat"); }}
            >
              TRY_KEATING
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
