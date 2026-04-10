import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="py-12 px-6 border-t-2 border-[#1a1a1a]">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 font-terminal">
        <div className="flex items-center gap-2 text-[#1a1a1a]/60">
          <span className="text-[#d44a3d]">●</span>
          <span>KEATING_HYPERTEACHER</span>
        </div>
        <p className="text-sm text-[#1a1a1a]/60">BUILT_ON_PI // MIT_LICENSE // 2025</p>
        <div className="flex gap-6 text-[#1a1a1a]/60">
          <a
            href="https://github.com/Diogenesoftoronto/keating"
            className="hover:text-[#d44a3d] transition-colors"
          >
            [GITHUB]
          </a>
          <a href="https://keating.help" className="hover:text-[#d44a3d] transition-colors">
            [WEB]
          </a>
        </div>
      </div>
    </footer>
  );
}

export function SimpleFooter() {
  return (
    <footer className="py-8 px-6 border-t-2 border-[#1a1a1a]">
      <div className="max-w-6xl mx-auto text-center font-terminal text-[#1a1a1a]/60">
        <Link to="/" className="hover:text-[#d44a3d] transition-colors">
          [BACK_TO_HOME]
        </Link>
      </div>
    </footer>
  );
}
