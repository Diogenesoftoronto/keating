import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import {
  DESKTOP_LABELS,
  type DesktopPlatform,
  type PlatformDetection,
  detectPlatform,
} from "../lib/detect-platform";
import {
  AndroidLogo,
  AppleLogo,
  IosLogo,
  LinuxLogo,
  WindowsLogo,
} from "../components/platform-logos";
import { cx } from "../../styled-system/css";
import { btnRetro, eyebrow, sectionLede, sectionTitle } from "../../styled-system/recipes";

const GITHUB_RELEASES_URL = "https://github.com/Diogenesoftoronto/keating/releases";
const DESKTOP_SOURCE_URL = "https://github.com/Diogenesoftoronto/keating/tree/main/desktop";

type DesktopEntry = {
  id: DesktopPlatform;
  detail: string;
  command: string;
  Logo: typeof AppleLogo;
};

const DESKTOP_PLATFORMS: DesktopEntry[] = [
  {
    id: "macos",
    detail: "Apple Silicon and Intel builds are planned as signed release artifacts.",
    command: "bun run dist --mac",
    Logo: AppleLogo,
  },
  {
    id: "windows",
    detail: "Installer builds ship through the same GitHub release channel.",
    command: "bun run dist --win",
    Logo: WindowsLogo,
  },
  {
    id: "linux",
    detail: "AppImage or package artifacts come from the Electron builder config.",
    command: "bun run dist --linux",
    Logo: LinuxLogo,
  },
];

const DESKTOP_FEATURES = [
  "Electron shell around the same Keating learning workspace",
  "Local-first storage for sessions, settings, and study artifacts",
  "P2P sync scaffold for device-to-device replication and always-on seeders",
  "Browser UI parity, with Node-only runtime pieces kept out of the renderer",
];

const MOBILE_PLATFORMS = [
  { id: "ios" as const, label: "iOS", Logo: IosLogo },
  { id: "android" as const, label: "Android", Logo: AndroidLogo },
];

export function Download() {
  useSeo({
    title: "Download Keating Desktop | Electron App",
    description:
      "Download the Keating Electron desktop app for macOS, Windows, or Linux, or track upcoming native iOS and Android releases.",
    canonical: "https://keating.help/download",
  });

  // Start unknown so SSR/first paint is deterministic; refine on the client.
  const [detection, setDetection] = useState<PlatformDetection>({
    platform: "unknown",
    isMobile: false,
    recommendedDesktop: "macos",
  });

  useEffect(() => {
    setDetection(detectPlatform());
  }, []);

  const recommended = detection.recommendedDesktop;
  const recommendedEntry =
    DESKTOP_PLATFORMS.find((p) => p.id === recommended) ?? DESKTOP_PLATFORMS[0];
  const RecommendedLogo = recommendedEntry.Logo;

  const detectedMobile =
    detection.platform === "ios" || detection.platform === "android";
  const detectedMobileLabel =
    detection.platform === "ios"
      ? "iOS"
      : detection.platform === "android"
        ? "Android"
        : null;

  return (
    <div className={cx("retro-layout", "retro-page")}>
      <Nav />
      <main className={cx("download-page")}>
        <section className={cx("download-hero")}>
          <div className={cx("wrap", "download-hero-grid")}>
            <div>
              <div className={cx(eyebrow(), "prompt")}>cat DOWNLOADS.txt</div>
              <h1>Keating on your machine.</h1>
              <p className={cx("download-hero-copy")}>
                The Electron app brings Keating&apos;s browser workspace into a desktop shell,
                with local-first storage and the P2P runtime hooks that cannot run in a normal
                browser tab.
              </p>

              <div className={cx("download-recommend")} role="status">
                <span className={cx("download-recommend-logo")} aria-hidden="true">
                  <RecommendedLogo width={22} height={22} />
                </span>
                <span className={cx("download-recommend-text")}>
                  {detection.platform === "unknown" ? (
                    <>
                      Recommended build: <strong>{DESKTOP_LABELS[recommended]}</strong>
                    </>
                  ) : detectedMobile ? (
                    <>
                      Detected <strong>{detectedMobileLabel}</strong> — the native app is coming
                      soon. Meanwhile, use the browser app or install {DESKTOP_LABELS[recommended]}
                      {" "}on a computer.
                    </>
                  ) : (
                    <>
                      Detected <strong>{DESKTOP_LABELS[recommended]}</strong> — recommended
                      download for your system.
                    </>
                  )}
                </span>
              </div>

              <div className={cx("download-actions")}>
                <a
                  className={btnRetro({ tone: "primary" })}
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={cx("btn-logo")} aria-hidden="true">
                    <RecommendedLogo width={16} height={16} />
                  </span>
                  Download_for_{DESKTOP_LABELS[recommended].replace(/\s+/g, "_")} →
                </a>
                <Link className={btnRetro()} to="/chat">
                  Try_In_Browser
                </Link>
              </div>
              <p className={cx("download-note")}>
                Desktop installers are distributed from GitHub Releases as they become available.
                Source builds are available now for contributors and testers.
              </p>
            </div>

            <aside className={cx("download-device-panel")} aria-label="Desktop app status">
              <div className={cx("download-device-top")}>
                <span className={cx("d", "r")} />
                <span className={cx("d", "y")} />
                <span className={cx("d", "g")} />
                <span>KEATING_DESKTOP</span>
              </div>
              <div className={cx("download-screen")}>
                <div className={cx("download-screen-line", "t-ok")}>electron runtime: ready</div>
                <div className={cx("download-screen-line")}>renderer: web/dist</div>
                <div className={cx("download-screen-line")}>storage: local-first</div>
                <div className={cx("download-screen-line")}>sync: p2p scaffold</div>
                <div className={cx("download-screen-caret")} aria-hidden="true" />
              </div>
            </aside>
          </div>
        </section>

        <section className={cx("download-section")} aria-labelledby="desktop-heading">
          <div className={cx("wrap")}>
            <div className={cx("download-section-head")}>
              <div className={cx(eyebrow(), "prompt")}>open ELECTRON_APP</div>
              <h2 id="desktop-heading" className={sectionTitle()}>
                Desktop app
              </h2>
              <p className={sectionLede()}>
                Use the desktop build when you want Keating as an installed app, with access to
                the Node runtime pieces needed for real desktop P2P storage.
              </p>
            </div>

            <div className={cx("desktop-download-grid")}>
              {DESKTOP_PLATFORMS.map((item) => {
                const isRecommended = item.id === recommended;
                const Logo = item.Logo;
                return (
                  <article
                    className={cx("desktop-download-card", isRecommended && "is-recommended")}
                    key={item.id}
                    aria-current={isRecommended ? "true" : undefined}
                  >
                    <div className={cx("desktop-card-head")}>
                      <span className={cx("desktop-card-logo")} aria-hidden="true">
                        <Logo width={30} height={30} />
                      </span>
                      <div className={cx("desktop-platform")}>{DESKTOP_LABELS[item.id]}</div>
                      {isRecommended && (
                        <span className={cx("desktop-recommend-tag")}>YOUR OS</span>
                      )}
                    </div>
                    <p>{item.detail}</p>
                    <code>{item.command}</code>
                    <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
                      Check latest release
                    </a>
                  </article>
                );
              })}
            </div>

            <div className={cx("download-source-box")}>
              <div>
                <h3>Build from source</h3>
                <p>
                  Contributors can build the Electron app from the workspace today. The desktop
                  package wraps the existing web app and compiles the Electron main and preload
                  processes with TypeScript.
                </p>
              </div>
              <div className={cx("download-command")} aria-label="Desktop build commands">
                <div>cd desktop</div>
                <div>bun install</div>
                <div>bun run build:main</div>
                <div>bun run dist</div>
              </div>
              <a className={btnRetro()} href={DESKTOP_SOURCE_URL} target="_blank" rel="noreferrer">
                View_Source
              </a>
            </div>

            <ul className={cx("download-feature-list")} aria-label="Desktop app features">
              {DESKTOP_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className={cx("download-section", "mobile-coming-soon")} aria-labelledby="mobile-heading">
          <div className={cx("wrap", "mobile-soon-grid")}>
            <div>
              <div className={cx(eyebrow(), "prompt")}>tail -f MOBILE_ROADMAP</div>
              <h2 id="mobile-heading" className={sectionTitle()}>
                Native mobile app
              </h2>
              <p className={sectionLede()}>
                iOS and Android builds are coming soon. The native app is planned for the same
                local-first learning surface, adapted for phone and tablet sessions instead of a
                compressed desktop web view.
              </p>
              <div className={cx("mobile-platform-row")} aria-label="Planned mobile platforms">
                {MOBILE_PLATFORMS.map(({ id, label, Logo }) => {
                  const isDetected = detection.platform === id;
                  return (
                    <span
                      key={id}
                      className={cx("mobile-platform-chip", isDetected && "is-detected")}
                    >
                      <Logo width={18} height={18} />
                      {label}
                      {isDetected && <em>your device</em>}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className={cx("mobile-soon-card")} aria-label="Native mobile status">
              <div className={cx("mobile-badge")}>COMING SOON</div>
              <div className={cx("mobile-frame")}>
                <div className={cx("mobile-notch")} />
                <div className={cx("mobile-screen-line")}>Keating Mobile</div>
                <div className={cx("mobile-screen-line", "dim")}>native shell</div>
                <div className={cx("mobile-screen-line", "dim")}>offline study</div>
                <div className={cx("mobile-screen-line", "dim")}>push review loop</div>
              </div>
              <p>
                Follow the release feed for mobile availability, TestFlight, and Android testing
                notes.
              </p>
              <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
                Watch releases
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
