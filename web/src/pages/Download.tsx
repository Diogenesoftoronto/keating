import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { AppLink as Link } from "../components/AppLink";
import { KeatingGlyph } from "../design-system/glyphs";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { TerminalInstall } from "../components/TerminalInstall";
import { AndroidLogo, AppleLogo, IosLogo, LinuxLogo, WindowsLogo } from "../components/platform-logos";
import { useSeo } from "../hooks/useSeo";
import { detectDownloadArchitecture, detectPlatform, type DetectedPlatform, type DownloadArchitecture } from "../lib/detect-platform";
import { downloadArchitectureLabel, downloadButtonLabel, downloadFormatLabel, downloadSize, fetchDownloadRelease, recommendedDownload, VERIFIED_DOWNLOAD_RELEASE, VERIFIED_WINDOWS_PREVIEW_RELEASE, type DownloadAsset } from "../lib/download-release";
import "./public-pages.css";
import "./download.css";

const PLATFORMS = [
  { id: "macos", label: "macOS", Logo: AppleLogo },
  { id: "windows", label: "Windows", Logo: WindowsLogo },
  { id: "linux", label: "Linux", Logo: LinuxLogo },
  { id: "android", label: "Android", Logo: AndroidLogo },
  { id: "ios", label: "iOS", Logo: IosLogo },
] as const;

// Replace these files to refresh the showcase. See public/downloads/README.md.
const PHONE_SHOTS = [
  { id: "learn", glyph: "book", label: "Lesson", src: "/downloads/learn.jpg", title: "Follow a question.", description: "Build an idea together.", alt: "Keating on a phone explaining how yeast and gluten make bread rise." },
  { id: "practice", glyph: "quiz", label: "Quiz", src: "/downloads/practice.jpg", title: "Try it yourself.", description: "Check what clicked.", alt: "Keating's mobile quiz asking what makes dough expand, with the yeast answer selected." },
  { id: "review", glyph: "layers", label: "Flashcards", src: "/downloads/review.jpg", title: "Make it stick.", description: "Come back to your cards.", alt: "Keating's mobile flashcards reviewing the science of bread." },
] as const;

export function Download() {
  const posthog = usePostHog();
  const [shot, setShot] = useState<typeof PHONE_SHOTS[number]>(PHONE_SHOTS[0]);
  const [detected, setDetected] = useState<DetectedPlatform>("unknown");
  const [detectedArchitecture, setDetectedArchitecture] = useState<DownloadArchitecture>("unknown");
  const [platformChoice, setPlatformChoice] = useState<DetectedPlatform | null>(null);
  const [architectureChoice, setArchitectureChoice] = useState<DownloadArchitecture | null>(null);
  const [formatChoice, setFormatChoice] = useState<string | null>(null);
  const [release, setRelease] = useState(VERIFIED_DOWNLOAD_RELEASE);
  const [releaseCheck, setReleaseCheck] = useState<"checking" | "current" | "unavailable">("checking");
  const platform = platformChoice ?? detected;
  const architecture = architectureChoice ?? (platform === detected ? detectedArchitecture : "unknown");
  const selectedPlatform = PLATFORMS.find((entry) => entry.id === platform);
  const PlatformIcon = selectedPlatform?.Logo;
  const platformAssets = release.assets.filter((asset) => asset.platform === platform);
  const formats = [...new Set(platformAssets.filter((asset) => asset.architecture === architecture || asset.architecture === "universal").map((asset) => asset.format))];
  const selectedFormat = formatChoice && formats.includes(formatChoice) ? formatChoice : undefined;
  const recommended = recommendedDownload(release, platform, architecture, selectedFormat);
  const needsArchitecture = platformAssets.length > 0 && !recommended;
  const architectures = [...new Set(platformAssets.map((asset) => asset.architecture))].filter((arch) => arch !== "universal");

  useSeo({
    title: "Download Keating | Learn on your phone or computer",
    description: "Download the Keating alpha for your platform, or start learning in your browser. Explore real mobile views of lessons, quizzes, and flashcards.",
    canonical: "https://keating.help/download",
  });

  useEffect(() => {
    let active = true;
    setDetected(detectPlatform().platform);
    void detectDownloadArchitecture().then((arch) => { if (active) setDetectedArchitecture(arch); });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    void fetchDownloadRelease(controller.signal).then((latest) => {
      if (!active) return;
      if (latest) { setRelease(latest); setReleaseCheck("current"); }
      else setReleaseCheck("unavailable");
    }).catch(() => { if (active) setReleaseCheck("unavailable"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, []);

  const captureDownload = (asset: DownloadAsset, source: "hero" | "platform_card") => {
    posthog?.capture("download_intent", { source, platform: asset.platform, architecture: asset.architecture, destination: "release_asset", artifact: asset.kind, release: asset.releaseTag ?? release.tag });
  };
  const captureBrowser = () => posthog?.capture("download_try_browser_click", { platform });

  return (
    <div className="retro-layout retro-page public-page downloads">
      <Nav publication />
      <main>
        <section className="downloads-hero" aria-labelledby="downloads-title">
          <div className="downloads-wrap downloads-hero-grid">
            <div className="downloads-intro public-enter">
              <header className="downloads-heading">
                <p className="downloads-kicker" data-glyph-host><KeatingGlyph name="export" size={17} /> Alpha release</p>
                <h1 id="downloads-title">Download<br /><span>Keating.</span></h1>
                <p className="downloads-lede">Try an early build on your device, or open the classroom in your browser.</p>
              </header>
              <div className="downloads-picker" id="download-picker">
                <div className="downloads-picker-heading" aria-live="polite">
                  {PlatformIcon ? <PlatformIcon size={22} aria-hidden="true" /> : <KeatingGlyph name="globe" size={22} />}
                  <strong>{selectedPlatform ? `Keating for ${selectedPlatform.label}` : "Choose your platform"}</strong>
                  {platform !== "unknown" && platform === detected && <span className="downloads-detected">Detected</span>}
                </div>
                <div className="downloads-platform-picker" role="group" aria-label="Choose your platform">
                  {PLATFORMS.map(({ id, label, Logo }) => (
                    <button type="button" key={id} aria-pressed={platform === id} onClick={() => { setPlatformChoice(id); setArchitectureChoice(null); setFormatChoice(null); }}>
                      <Logo size={23} aria-hidden="true" /><span>{label}</span>
                    </button>
                  ))}
                </div>
                {architectures.length > 0 && (architectures.length > 1 || needsArchitecture) && (
                  <fieldset className="downloads-architectures">
                    <legend>{platform === "macos" ? "Your Mac’s chip" : "Your processor"}</legend>
                    {architectures.map((arch) => (
                      <label key={arch}>
                        <input type="radio" name="download-architecture" value={arch} checked={architecture === arch} onChange={() => setArchitectureChoice(arch)} />
                        {downloadArchitectureLabel(platform, arch)}
                      </label>
                    ))}
                  </fieldset>
                )}
                {platform === "linux" && formats.length > 1 && (
                  <fieldset className="downloads-architectures">
                    <legend>Package format</legend>
                    {formats.map((format) => (
                      <label key={format}>
                        <input type="radio" name="download-format" value={format} checked={recommended?.format === format} onChange={() => setFormatChoice(format)} />
                        {downloadFormatLabel(format)}
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className="downloads-primary-action" aria-live="polite">
                  {recommended ? (
                    <>
                      <a className="downloads-button downloads-button-primary" href={recommended.url} onClick={() => captureDownload(recommended, "hero")}>
                        {PlatformIcon ? <PlatformIcon size={20} aria-hidden="true" /> : <KeatingGlyph name="globe" size={20} />} {downloadButtonLabel(recommended)} (alpha)<KeatingGlyph name="export" size={18} />
                      </a>
                      <p>{recommended.edition === "offline" ? "Offline app installer" : recommended.kind === "terminal" ? "Terminal app" : downloadFormatLabel(recommended.format)} · {downloadArchitectureLabel(platform, recommended.architecture)} · {downloadSize(recommended.size)}</p>
                      {recommended.selfSigned && <p>Windows 4.0.7 self-signed preview. Windows may show an unknown publisher warning. <a href={VERIFIED_WINDOWS_PREVIEW_RELEASE.url}>Signing details</a></p>}
                      {platform === "android" && <p>Android 8 or later. Open the downloaded APK to install Keating.</p>}
                    </>
                  ) : needsArchitecture ? (
                    <p className="downloads-choice-hint">Choose your {platform === "macos" ? "Mac’s chip" : "processor"} above to get the right file.{platform === "macos" && <span>Find it in Apple menu → About This Mac.</span>}</p>
                  ) : (
                    <>
                      <Link className="downloads-button downloads-button-primary" to="/chat" onClick={captureBrowser}><KeatingGlyph name="globe" size={20} /> Open Keating in your browser<KeatingGlyph name="right" size={18} /></Link>
                      <p>{selectedPlatform ? `No ${selectedPlatform.label} installer is published yet. The browser app is ready.` : "Works on your phone, tablet, or computer."}</p>
                    </>
                  )}
                </div>
                {platform === "linux" && <div className="downloads-primary-action">
                  <a className="downloads-button" href="https://diogenesoftoronto.github.io/keating/flatpak/help.keating.desktop.flatpakref"><KeatingGlyph name="export" size={18} /> Install sandboxed Flatpak (alpha)</a>
                  <p>Signed Keating repository · x64 and ARM64 · updates through Flatpak</p>
                  <a className="downloads-browser-link" href="https://diogenesoftoronto.github.io/keating/flatpak/keating-release-key.asc">Release signing public key</a>
                </div>}
                {(recommended || needsArchitecture) && <Link className="downloads-browser-link" to="/chat" onClick={captureBrowser}><KeatingGlyph name="globe" size={16} /> Or start in your browser<KeatingGlyph name="right" size={15} /></Link>}
              </div>
              <a href="#all-downloads" className="downloads-all-link">See all downloads <KeatingGlyph name="down" size={15} /></a>
            </div>
            <section className="downloads-showcase" aria-labelledby="downloads-showcase-title">
              <div className="downloads-showcase-body public-texture-doodles">
                <div className="downloads-example">
                  <p className="downloads-kicker"><KeatingGlyph name="book" size={16} /> Example lesson</p>
                  <h2 id="downloads-showcase-title">What makes bread rise?</h2>
                  <p className="downloads-shot-description" aria-live="polite">{shot.title} {shot.description}</p>
                </div>
                <div className="downloads-feature">
                  <a key={shot.id} className="downloads-phone" href={shot.src} target="_blank" rel="noreferrer" aria-label={`View ${shot.label} screenshot, opens in a new tab`}>
                    <span className="downloads-phone-speaker" aria-hidden="true" />
                    <img src={shot.src} alt={shot.alt} width={390} height={844} decoding="async" />
                    <span className="downloads-phone-home" aria-hidden="true" />
                  </a>
                </div>
              </div>
              <div className="downloads-shot-picker" role="group" aria-label="Preview a mobile view">
                {PHONE_SHOTS.map(item => <button type="button" key={item.id} aria-pressed={shot.id === item.id} onClick={() => setShot(item)}>
                  <KeatingGlyph name={item.glyph} size={16} /> {item.label}
                </button>)}
              </div>
              <p className="downloads-showcase-note"><KeatingGlyph name="screen" size={15} /> Mobile browser preview <a href={shot.src} target="_blank" rel="noreferrer">Full size <KeatingGlyph name="ext" size={14} /></a></p>
            </section>
          </div>
        </section>
        <section className="downloads-catalog" id="all-downloads" aria-labelledby="all-downloads-heading">
          <div className="downloads-wrap downloads-catalog-grid">
            <div className="downloads-catalog-heading">
              <div><h2 id="all-downloads-heading">All alpha downloads</h2><p>Choose a platform, processor, and file format.</p></div>
              <a href={release.url} target="_blank" rel="noreferrer" className="downloads-release-link">{release.tag} release notes <KeatingGlyph name="ext" size={16} /></a>
            </div>
            <div className="downloads-catalog-body"><div className="downloads-file-list">
              {PLATFORMS.map(({ id, label, Logo }) => {
                const assets = release.assets.filter((asset) => asset.platform === id);
                const groups = [
                  { label: "App installers", files: assets.filter(asset => asset.kind !== "terminal" && !asset.edition) },
                  { label: "Offline installers", files: assets.filter(asset => asset.edition === "offline") },
                  { label: "Terminal archives", files: assets.filter(asset => asset.kind === "terminal") },
                ].filter(group => group.files.length > 0);
                return (
                  <article key={id} className="downloads-file-row">
                    <div className="downloads-file-platform"><Logo size={30} aria-hidden="true" /><div><h3>{label}</h3><p>{assets.some((asset) => asset.selfSigned) ? "Self-signed preview" : groups.length > 1 ? "Choose an edition" : groups[0]?.label ?? "Native app"}</p></div>{id === detected && <span className="downloads-detected">Your device</span>}</div>
                    {assets.length ? (
                      <div className="downloads-file-groups" aria-label={`${label} downloads`}>
                        {groups.map(group => <div key={group.label}>
                          {groups.length > 1 && <h4>{group.label}</h4>}
                          <ul className="downloads-files" aria-label={`${label} ${group.label.toLowerCase()}`}>
                            {group.files.map(asset => <li key={asset.name}>
                              <a href={asset.url} aria-label={`Download Keating alpha ${asset.edition === "offline" ? "offline app" : asset.kind === "terminal" ? "terminal" : "app"} for ${label}, ${downloadArchitectureLabel(id, asset.architecture)}, ${asset.format}, ${downloadSize(asset.size)}`} onClick={() => captureDownload(asset, "platform_card")}>
                                <span>{id === "android" ? "Android APK" : downloadArchitectureLabel(id, asset.architecture)}<small>{asset.format} · {downloadSize(asset.size)}</small></span>
                                <KeatingGlyph name="export" size={16} />
                              </a>
                            </li>)}
                          </ul>
                        </div>)}
                      </div>
                    ) : <div className="downloads-unavailable"><span>Not published yet</span><Link to="/chat" onClick={captureBrowser}>Use the browser app <KeatingGlyph name="right" size={15} /></Link></div>}
                  </article>
                );
              })}
            </div>
            <p className="downloads-catalog-note" role="status">{releaseCheck === "unavailable" ? "Showing verified downloads. The latest release check is temporarily unavailable." : releaseCheck === "checking" ? "Showing verified downloads. Checking for a newer release…" : `Files from ${release.tag}${release.assets.some((asset) => asset.selfSigned) ? " and the verified Windows preview" : ""}.`}</p>
            {release.assets.some((asset) => asset.selfSigned) && <p className="downloads-catalog-note">Windows 4.0.7 is a self-signed preview; Windows may show an unknown publisher warning. <a href={VERIFIED_WINDOWS_PREVIEW_RELEASE.url}>Windows release notes and signing details</a>.</p>}
            <details className="downloads-install-help"><summary><KeatingGlyph name="terminal" size={18} /> Installing the terminal app</summary><div><p>The macOS and Linux <code>.tar.gz</code> files contain Keating’s terminal app and its runtime. Extract the archive, open a terminal in the extracted folder, and run <code>./install.sh</code>. Then start a lesson with <code>keating shell</code>.</p><p>For the visual workspace shown above, <Link to="/chat">open the browser app</Link>. Developers can also <a href="https://github.com/Diogenesoftoronto/keating/tree/main/desktop" target="_blank" rel="noreferrer">build the desktop app from source</a>.</p></div></details></div>
          </div>
        </section>
        <section className="downloads-browser-band" aria-labelledby="downloads-browser-heading"><div className="downloads-wrap"><div><KeatingGlyph name="globe" size={28} /><h2 id="downloads-browser-heading">Open the browser classroom</h2><p>Start a lesson now. No installation required.</p></div><Link className="downloads-button" to="/chat" onClick={captureBrowser}>Start learning <KeatingGlyph name="right" size={18} /></Link></div></section>
        <TerminalInstall />
      </main>
      <Footer />
    </div>
  );
}
