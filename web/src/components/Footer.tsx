import { Link } from "@tanstack/react-router";
import { T } from "gt-react";
import { css, cx } from "../../styled-system/css";

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <img src="/brand/logo-lockup.png" alt="Keating" />
            <p>
              <T>The hyperteacher. Socratic reconstruction for people who&apos;d rather understand than memorize.</T>
            </p>
          </div>
          <div className="foot-col">
            <h5><T>Product</T></h5>
            <ul>
              <li>
                <Link to="/download"><T>Download</T></Link>
              </li>
              <li>
                <Link to="/tutorial"><T>Tutorial</T></Link>
              </li>
              <li>
                <a href="/#manifesto"><T>Manifesto</T></a>
              </li>
              <li>
                <a href="/#loop"><T>Harness</T></a>
              </li>
              <li>
                <Link to="/bench"><T>Bench</T></Link>
              </li>
            </ul>
          </div>
          <div className="foot-col">
            <h5><T>Resources</T></h5>
            <ul>
              <li>
                <Link to="/paper"><T>Paper</T></Link>
              </li>
              <li>
                <Link to="/blog"><T>Blog</T></Link>
              </li>
              <li>
                <Link to="/usage"><T>Usage</T></Link>
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
            <h5><T>Source</T></h5>
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
            <Link to="/terms"><T>Terms of Service</T></Link>
            <span aria-hidden="true">//</span>
            <Link to="/privacy"><T>Privacy Policy</T></Link>
          </span>
          <span>
            <T>system status: <span className="ok">online</span> // uptime: <span className="ok">optimal</span></T>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function SimpleFooter() {
  return (
    <footer
      className={css({
        paddingBlock: "2rem",
        paddingInline: "1.5rem",
        borderTop: "2px solid var(--border)"
      })}
    >
      <div
        className={cx(
          "font-terminal",
          css({
            maxWidth: "72rem",
            marginInline: "auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            columnGap: "0.75rem",
            rowGap: "0.5rem",
            textAlign: "center",
            color: "color-mix(in srgb, var(--foreground) 60%, transparent)"
          })
        )}
      >
        <Link
          to="/"
          className={css({
            transition: "color 0.15s ease",
            _hover: { color: "#d5604b" }
          })}
        >
          [BACK_TO_HOME]
        </Link>
        <span aria-hidden="true">//</span>
        <Link
          to="/terms"
          className={css({
            transition: "color 0.15s ease",
            _hover: { color: "#d5604b" }
          })}
        >
          Terms of Service
        </Link>
        <span aria-hidden="true">//</span>
        <Link
          to="/privacy"
          className={css({
            transition: "color 0.15s ease",
            _hover: { color: "#d5604b" }
          })}
        >
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
