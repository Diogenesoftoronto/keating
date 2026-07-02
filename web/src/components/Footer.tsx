import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <img src="/brand/logo-lockup.png" alt="Keating" />
            <p>
              The hyperteacher. Socratic reconstruction for people who&apos;d rather understand
              than memorize.
            </p>
          </div>
          <div className="foot-col">
            <h5>Product</h5>
            <ul>
              <li>
                <Link to="/download">Download</Link>
              </li>
              <li>
                <Link to="/tutorial">Tutorial</Link>
              </li>
              <li>
                <a href="/#manifesto">Manifesto</a>
              </li>
              <li>
                <a href="/#loop">Harness</a>
              </li>
              <li>
                <Link to="/bench">Bench</Link>
              </li>
            </ul>
          </div>
          <div className="foot-col">
            <h5>Resources</h5>
            <ul>
              <li>
                <Link to="/paper">Paper</Link>
              </li>
              <li>
                <Link to="/blog">Blog</Link>
              </li>
              <li>
                <Link to="/usage">Usage</Link>
              </li>
              <li>
                <a
                  href="https://github.com/Diogenesoftoronto/keating/blob/main/CHANGELOG.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Changelog
                </a>
              </li>
            </ul>
          </div>
          <div className="foot-col">
            <h5>Source</h5>
            <ul>
              <li>
                <a
                  href="https://github.com/Diogenesoftoronto/keating"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/Diogenesoftoronto/keating/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer"
                >
                  License
                </a>
              </li>
              <li>
                <a href="https://keating.help">keating.help</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="foot-base">
          <span>
            © 2026 keating.help — think_for_yourself // v{import.meta.env.APP_VERSION} //
            BUILT_ON_PI //{" "}
            <a
              href="https://www.mozilla.org/en-US/MPL/2.0/"
              target="_blank"
              rel="noreferrer"
            >
              MPL_2.0
            </a>
          </span>
          <span className="foot-legal-links" aria-label="Legal links">
            <Link to="/terms">Terms of Service</Link>
            <span aria-hidden="true">//</span>
            <Link to="/privacy">Privacy Policy</Link>
          </span>
          <span>
            system status: <span className="ok">online</span> // uptime:{" "}
            <span className="ok">optimal</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function SimpleFooter() {
  return (
    <footer className="py-8 px-6 border-t-2 border-border">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center font-terminal text-foreground/60">
        <Link to="/" className="hover:text-[#d5604b] transition-colors">
          [BACK_TO_HOME]
        </Link>
        <span aria-hidden="true">//</span>
        <Link to="/terms" className="hover:text-[#d5604b] transition-colors">
          Terms of Service
        </Link>
        <span aria-hidden="true">//</span>
        <Link to="/privacy" className="hover:text-[#d5604b] transition-colors">
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
