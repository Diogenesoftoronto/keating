import { Link, useNavigate } from "@tanstack/react-router";

interface NavProps {
  showFeatures?: boolean;
}

export function Nav({ showFeatures = false }: NavProps) {
  const navigate = useNavigate();

  return (
    <nav className="retro-layout fixed top-0 left-0 right-0 z-50 border-b-2 border-[#1a1a1a]"
         style={{ minHeight: 'auto', background: 'rgba(244, 241, 234, 0.97)' }}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo — always visible, shrinks on small screens */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="status-led" />
          <span className="text-sm sm:text-xl font-bold tracking-tight whitespace-nowrap">KEATING//</span>
          <span className="font-terminal text-xs sm:text-lg text-[#d44a3d]">v0.1.4</span>
        </Link>

        {/* Nav links — always a visible horizontal row, scrollable if needed */}
        <div className="overflow-x-auto no-scrollbar ml-2">
          <div className="flex items-center gap-2 sm:gap-4 md:gap-6 font-terminal text-xs sm:text-sm md:text-base lg:text-lg whitespace-nowrap">
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
              className="nav-link glitch-hover hidden sm:inline"
            >
              [GITHUB]
            </a>
            <button
              className="btn-retro px-2 py-1 sm:px-4 sm:py-2 font-bold text-xs sm:text-sm shrink-0"
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
