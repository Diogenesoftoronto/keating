import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowDownToLine, ArrowRight, Globe, Terminal } from "lucide-react";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { AndroidLogo, AppleLogo, IosLogo, LinuxLogo, WindowsLogo } from "../components/platform-logos";
import { useSeo } from "../hooks/useSeo";
import { detectDownloadArchitecture, detectPlatform, type DetectedPlatform, type DownloadArchitecture } from "../lib/detect-platform";
import { downloadArchitectureLabel, downloadSize, fetchDownloadRelease, recommendedDownload, VERIFIED_DOWNLOAD_RELEASE, type DownloadAsset } from "../lib/download-release";
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
  { id: "learn", src: "/downloads/learn.jpg", title: "Follow a question.", description: "Build an idea together.", alt: "Keating on a phone explaining how yeast and gluten make bread rise." },
  { id: "practice", src: "/downloads/practice.jpg", title: "Try it yourself.", description: "Check what clicked.", alt: "Keating's mobile quiz asking what makes dough expand, with the yeast answer selected." },
  { id: "review", src: "/downloads/review.jpg", title: "Make it stick.", description: "Come back to your cards.", alt: "Keating's mobile flashcards reviewing the science of bread." },
] as const;

export function Download() {
  const posthog = usePostHog();
  const [detected, setDetected] = useState<DetectedPlatform>("unknown");
  const [detectedArchitecture, setDetectedArchitecture] = useState<DownloadArchitecture>("unknown");
  const [platformChoice, setPlatformChoice] = useState<DetectedPlatform | null>(null);
  const [architectureChoice, setArchitectureChoice] = useState<DownloadArchitecture | null>(null);
  const [release, setRelease] = useState(VERIFIED_DOWNLOAD_RELEASE);
  const [releaseCheck, setReleaseCheck] = useState<"checking" | "current" | "unavailable">("checking");
  const platform = platformChoice ?? detected;
  const architecture = architectureChoice ?? (platform === detected ? detectedArchitecture : "unknown");
  const selectedPlatform = PLATFORMS.find((entry) => entry.id === platform);
  const PlatformIcon = selectedPlatform?.Logo ?? Globe;
  const platformAssets = release.assets.filter((asset) => asset.platform === platform);
  const recommended = recommendedDownload(release, platform, architecture);
  const needsArchitecture = platformAssets.length > 0 && !recommended;
  const architectures = [...new Set(platformAssets.map((asset) => asset.architecture))].filter((arch) => arch !== "universal");

  useSeo({
    title: "Download Keating | Learn on your phone or computer",
    description: "Get the Keating download for your platform, or start learning in your browser. Explore real mobile views of lessons, quizzes, and flashcards.",
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
    posthog?.capture("download_intent", { source, platform: asset.platform, architecture: asset.architecture, destination: "release_asset", artifact: asset.kind, release: release.tag });
  };
  const captureBrowser = () => posthog?.capture("download_try_browser_click", { platform });

  return (
    <div className="retro-layout retro-page downloads">
      <Nav />
      <main>
        <section className="downloads-hero" aria-labelledby="downloads-title">
          <div className="downloads-wrap downloads-hero-grid">
            <div className="downloads-intro">
              <p className="downloads-kicker"><ArrowDownToLine size={15} aria-hidden="true" /> Take Keating with you</p>
              <h1 id="downloads-title">Wherever<br />curiosity<br /><span>finds you.</span></h1>
              <p className="downloads-lede">Ask a question, test an idea, and revisit what you’ve learned. Your next lesson can fit in your pocket.</p>
              <div className="downloads-picker" id="download-picker">
                <div className="downloads-picker-heading" aria-live="polite">
                  <PlatformIcon size={22} aria-hidden="true" />
                  <strong>{selectedPlatform ? `Keating for ${selectedPlatform.label}` : "Choose your platform"}</strong>
                  {platform !== "unknown" && platform === detected && <span className="downloads-detected">Detected</span>}
                </div>
                <div className="downloads-platform-picker" role="group" aria-label="Choose your platform">
                  {PLATFORMS.map(({ id, label, Logo }) => (
                    <button type="button" key={id} aria-pressed={platform === id} onClick={() => { setPlatformChoice(id); setArchitectureChoice(null); }}>
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
                <div className="downloads-primary-action" aria-live="polite">
                  {recommended ? (
                    <>
                      <a className="downloads-button downloads-button-primary" href={recommended.url} onClick={() => captureDownload(recommended, "hero")}>
                        <PlatformIcon size={20} aria-hidden="true" /> Download for {selectedPlatform?.label}<ArrowDownToLine size={18} aria-hidden="true" />
                      </a>
                      <p>{recommended.kind === "terminal" ? "Terminal app" : "App installer"} · {downloadArchitectureLabel(platform, recommended.architecture)} · {recommended.format} · {downloadSize(recommended.size)}</p>
                    </>
                  ) : needsArchitecture ? (
                    <p className="downloads-choice-hint">Choose your {platform === "macos" ? "Mac’s chip" : "processor"} above to get the right file.{platform === "macos" && <span>Find it in Apple menu → About This Mac.</span>}</p>
                  ) : (
                    <>
                      <Link className="downloads-button downloads-button-primary" to="/chat" onClick={captureBrowser}><Globe size={20} aria-hidden="true" /> Open Keating in your browser<ArrowRight size={18} aria-hidden="true" /></Link>
                      <p>{selectedPlatform ? `No ${selectedPlatform.label} installer is published yet. The browser app is ready.` : "Works on your phone, tablet, or computer."}</p>
                    </>
                  )}
                </div>
                {(recommended || needsArchitecture) && <Link className="downloads-browser-link" to="/chat" onClick={captureBrowser}><Globe size={16} aria-hidden="true" /> Or start in your browser<ArrowRight size={15} aria-hidden="true" /></Link>}
              </div>
              <a href="#all-downloads" className="downloads-all-link">See all downloads <ArrowDown size={15} aria-hidden="true" /></a>
            </div>
            <div className="downloads-showcase" aria-label="A lesson in three mobile views">
              <div className="downloads-showcase-heading"><span>A good question goes a long way.</span><span className="downloads-shot-label">Inside Keating</span></div>
              <div className="downloads-phones">
                {PHONE_SHOTS.map((shot, index) => (
                  <figure className={`downloads-phone-shot downloads-phone-shot-${shot.id}`} key={shot.id}>
                    <a className="downloads-phone" href={shot.src} target="_blank" rel="noreferrer" aria-label={`View ${shot.id} screenshot, opens in a new tab`}>
                      <span className="downloads-phone-speaker" aria-hidden="true" />
                      <img src={shot.src} alt={shot.alt} width={390} height={844} fetchPriority={index === 1 ? "high" : "auto"} decoding="async" />
                      <span className="downloads-phone-home" aria-hidden="true" />
                    </a>
                    <figcaption><strong>{shot.title}</strong><span>{shot.description}</span></figcaption>
                  </figure>
                ))}
              </div>
              <p className="downloads-showcase-note">One question. A lesson, a quiz, something to remember.<span>Actual mobile browser views · Example lesson</span></p>
            </div>
          </div>
        </section>
        <section className="downloads-catalog" id="all-downloads" aria-labelledby="all-downloads-heading">
          <div className="downloads-wrap">
            <div className="downloads-catalog-heading">
              <div><h2 id="all-downloads-heading">Find your version.</h2><p>Every available file, one click away.</p></div>
              <a href={release.url} target="_blank" rel="noreferrer" className="downloads-release-link">{release.tag} release notes <ArrowRight size={16} aria-hidden="true" /></a>
            </div>
            <div className="downloads-file-list">
              {PLATFORMS.map(({ id, label, Logo }) => {
                const assets = release.assets.filter((asset) => asset.platform === id);
                const terminalOnly = assets.length > 0 && assets.every((asset) => asset.kind === "terminal");
                return (
                  <article key={id} className="downloads-file-row">
                    <div className="downloads-file-platform"><Logo size={30} aria-hidden="true" /><div><h3>{label}</h3><p>{terminalOnly ? "Terminal app" : assets.length ? "App installer" : "Native app"}</p></div>{id === detected && <span className="downloads-detected">Your device</span>}</div>
                    {assets.length ? (
                      <ul aria-label={`${label} downloads`} className="downloads-files">
                        {assets.map((asset) => <li key={asset.name}><a href={asset.url} aria-label={`Download Keating ${asset.kind === "terminal" ? "terminal" : "app"} for ${label}, ${downloadArchitectureLabel(id, asset.architecture)}, ${asset.format}, ${downloadSize(asset.size)}`} onClick={() => captureDownload(asset, "platform_card")}><span>{downloadArchitectureLabel(id, asset.architecture)}<small>{asset.format} · {downloadSize(asset.size)}</small></span><ArrowDownToLine size={18} aria-hidden="true" /></a></li>)}
                      </ul>
                    ) : <div className="downloads-unavailable"><span>Not published yet</span><Link to="/chat" onClick={captureBrowser}>Use the browser app <ArrowRight size={15} aria-hidden="true" /></Link></div>}
                  </article>
                );
              })}
            </div>
            <p className="downloads-catalog-note" role="status">{releaseCheck === "unavailable" ? `Showing verified ${release.tag} files. The latest release check is temporarily unavailable.` : releaseCheck === "checking" ? `Showing verified ${release.tag} files. Checking for a newer release…` : "Files from the latest published release."} Desktop installers appear when published.</p>
            <details className="downloads-install-help"><summary><Terminal size={18} aria-hidden="true" /> Installing the terminal app</summary><div><p>The macOS and Linux <code>.tar.gz</code> files contain Keating’s terminal app and its runtime. Extract the archive, open a terminal in the extracted folder, and run <code>./install.sh</code>. Then start a lesson with <code>keating shell</code>.</p><p>For the visual workspace shown above, <Link to="/chat">open the browser app</Link>. Developers can also <a href="https://github.com/Diogenesoftoronto/keating/tree/main/desktop" target="_blank" rel="noreferrer">build the desktop app from source</a>.</p></div></details>
          </div>
        </section>
        <section className="downloads-browser-band" aria-labelledby="downloads-browser-heading"><div className="downloads-wrap"><div><Globe size={28} aria-hidden="true" /><h2 id="downloads-browser-heading">A browser is all you need.</h2><p>Start with a question. No installation required.</p></div><Link className="downloads-button" to="/chat" onClick={captureBrowser}>Start learning <ArrowRight size={18} aria-hidden="true" /></Link></div></section>
      </main>
      <Footer />
    </div>
  );
}
