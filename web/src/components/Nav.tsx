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
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#f4f1ea] border-b-2 border-[#1a1a1a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="status-led" />
          <span className="text-lg sm:text-xl font-bold tracking-tight">KEATING//</span>
          <span className="font-terminal text-sm sm:text-lg text-[#d44a3d]">v0.1.4</span>
        </Link>

        {/* Constant nav links — always visible now */}
        <div className="flex items-center gap-2 sm:gap-4 md:gap-6 lg:gap-8 font-terminal text-[10px] xs:text-xs sm:text-sm md:text-base lg:text-lg">
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
            className="btn-retro px-2 py-1 sm:px-4 sm:py-2 font-bold text-[10px] sm:text-sm min-h-[32px] sm:min-h-[44px]"
            onClick={() => navigate({ to: "/chat" })}
          >
            TRY_KEATING
          </button>
        </div>
      </div>

    </nav>
  );
}
