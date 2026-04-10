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
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#f4f1ea]/95 border-b-2 border-[#1a1a1a]">
      <div className="max-w-6xl mx-auto px-2 sm:px-6 h-12 sm:h-14 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="status-led" />
          <span className="text-base sm:text-xl font-bold tracking-tight">KEATING//</span>
          <span className="font-terminal text-[10px] sm:text-lg text-[#d44a3d] hidden xs:inline">v0.1.4</span>
        </Link>

        {/* Scrollable nav links for compact viewports */}
        <div className="flex-1 overflow-x-auto no-scrollbar py-1">
          <div className="flex items-center justify-end gap-3 sm:gap-6 lg:gap-8 font-terminal text-[11px] sm:text-sm md:text-base lg:text-lg min-w-max px-2">
            {showFeatures && (
              <a href="#features" className="hidden sm:block hover:text-[#d44a3d] transition-colors glitch-hover">[FEATURES]</a>
            )}
            <Link to="/tutorial" className="hover:text-[#d44a3d] transition-colors glitch-hover">[TUTORIAL]</Link>
            <Link to="/blog" className="hover:text-[#d44a3d] transition-colors glitch-hover">[BLOG]</Link>
            <Link to="/paper" className="hover:text-[#d44a3d] transition-colors glitch-hover">[PAPER]</Link>
            <a
              href="https://github.com/Diogenesoftoronto/keating"
              target="_blank"
              rel="noreferrer"
              className="hidden md:block hover:text-[#d44a3d] transition-colors glitch-hover"
            >
              [GITHUB]
            </a>
            <button
              className="btn-retro px-3 py-1 sm:px-4 sm:py-2 font-bold text-[10px] sm:text-sm min-h-[32px] sm:min-h-[44px] shrink-0"
              onClick={() => navigate({ to: "/chat" })}
            >
              TRY_KEATING
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
