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
    <div className="retro-layout retro-page">
      <Nav />
      <main className="download-page">
        <section className="download-hero">
          <div className="wrap download-hero-grid">
            <div>
              <div className="eyebrow prompt">cat DOWNLOADS.txt</div>
              <h1>Keating on your machine.</h1>
              <p className="download-hero-copy">
                The Electron app brings Keating&apos;s browser workspace into a desktop shell,
                with local-first storage and the P2P runtime hooks that cannot run in a normal
                browser tab.
              </p>

              <div className="download-recommend" role="status">
                <span className="download-recommend-logo" aria-hidden="true">
                  <RecommendedLogo width={22} height={22} />
                </span>
                <span className="download-recommend-text">
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

              <div className="download-actions">
                <a
                  className="btn-retro btn-retro-primary"
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="btn-logo" aria-hidden="true">
                    <RecommendedLogo width={16} height={16} />
                  </span>
                  Download_for_{DESKTOP_LABELS[recommended].replace(/\s+/g, "_")} →
                </a>
                <Link className="btn-retro" to="/chat">
                  Try_In_Browser
                </Link>
              </div>
              <p className="download-note">
                Desktop installers are distributed from GitHub Releases as they become available.
                Source builds are available now for contributors and testers.
              </p>
            </div>

            <aside className="download-device-panel" aria-label="Desktop app status">
              <div className="download-device-top">
                <span className="d r" />
                <span className="d y" />
                <span className="d g" />
                <span>KEATING_DESKTOP</span>
              </div>
              <div className="download-screen">
                <div className="download-screen-line t-ok">electron runtime: ready</div>
                <div className="download-screen-line">renderer: web/dist</div>
                <div className="download-screen-line">storage: local-first</div>
                <div className="download-screen-line">sync: p2p scaffold</div>
                <div className="download-screen-caret" aria-hidden="true" />
              </div>
            </aside>
          </div>
        </section>

        <section className="download-section" aria-labelledby="desktop-heading">
          <div className="wrap">
            <div className="download-section-head">
              <div className="eyebrow prompt">open ELECTRON_APP</div>
              <h2 id="desktop-heading" className="section-title">
                Desktop app
              </h2>
              <p className="section-lede">
                Use the desktop build when you want Keating as an installed app, with access to
                the Node runtime pieces needed for real desktop P2P storage.
              </p>
            </div>

            <div className="desktop-download-grid">
              {DESKTOP_PLATFORMS.map((item) => {
                const isRecommended = item.id === recommended;
                const Logo = item.Logo;
                return (
                  <article
                    className={`desktop-download-card${isRecommended ? " is-recommended" : ""}`}
                    key={item.id}
                    aria-current={isRecommended ? "true" : undefined}
                  >
                    <div className="desktop-card-head">
                      <span className="desktop-card-logo" aria-hidden="true">
                        <Logo width={30} height={30} />
                      </span>
                      <div className="desktop-platform">{DESKTOP_LABELS[item.id]}</div>
                      {isRecommended && (
                        <span className="desktop-recommend-tag">YOUR OS</span>
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

            <div className="download-source-box">
              <div>
                <h3>Build from source</h3>
                <p>
                  Contributors can build the Electron app from the workspace today. The desktop
                  package wraps the existing web app and compiles the Electron main and preload
                  processes with TypeScript.
                </p>
              </div>
              <div className="download-command" aria-label="Desktop build commands">
                <div>cd desktop</div>
                <div>bun install</div>
                <div>bun run build:main</div>
                <div>bun run dist</div>
              </div>
              <a className="btn-retro" href={DESKTOP_SOURCE_URL} target="_blank" rel="noreferrer">
                View_Source
              </a>
            </div>

            <ul className="download-feature-list" aria-label="Desktop app features">
              {DESKTOP_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="download-section mobile-coming-soon" aria-labelledby="mobile-heading">
          <div className="wrap mobile-soon-grid">
            <div>
              <div className="eyebrow prompt">tail -f MOBILE_ROADMAP</div>
              <h2 id="mobile-heading" className="section-title">
                Native mobile app
              </h2>
              <p className="section-lede">
                iOS and Android builds are coming soon. The native app is planned for the same
                local-first learning surface, adapted for phone and tablet sessions instead of a
                compressed desktop web view.
              </p>
              <div className="mobile-platform-row" aria-label="Planned mobile platforms">
                {MOBILE_PLATFORMS.map(({ id, label, Logo }) => {
                  const isDetected = detection.platform === id;
                  return (
                    <span
                      key={id}
                      className={`mobile-platform-chip${isDetected ? " is-detected" : ""}`}
                    >
                      <Logo width={18} height={18} />
                      {label}
                      {isDetected && <em>your device</em>}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="mobile-soon-card" aria-label="Native mobile status">
              <div className="mobile-badge">COMING SOON</div>
              <div className="mobile-frame">
                <div className="mobile-notch" />
                <div className="mobile-screen-line">Keating Mobile</div>
                <div className="mobile-screen-line dim">native shell</div>
                <div className="mobile-screen-line dim">offline study</div>
                <div className="mobile-screen-line dim">push review loop</div>
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
