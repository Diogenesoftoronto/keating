import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import "./frustration-clip.css";

const CLIPS = [
  { video: "/landing/clips/moss-rage.mp4", poster: "/landing/clips/moss-rage.webp", description: "A frustrated man repeatedly hits his computer." },
  { video: "/landing/clips/office-rage.mp4", poster: "/landing/clips/office-rage.webp", description: "An office worker loses patience with his CRT computer." },
];

/** One small, silent player; the lesson below gets the visitor's attention back. */
export function FrustrationClip() {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [playback, setPlayback] = useState<"auto" | "play" | "pause">("auto");
  const [failed, setFailed] = useState(false);
  const clip = CLIPS[index];
  const wantsPlay = playback === "play" || (playback === "auto" && !reduced);
  const playing = wantsPlay && visible && pageVisible && !failed;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => { const next = preference.matches || document.documentElement.dataset.motion === "reduce"; setReduced(next); if (next) setPlayback("auto"); };
    const syncVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    syncMotion(); syncVisibility();
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    const motionObserver = new MutationObserver(syncMotion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { threshold: .1 });
    if (host.current && observer) observer.observe(host.current); else setVisible(true);
    return () => { preference.removeEventListener("change", syncMotion); document.removeEventListener("visibilitychange", syncVisibility); motionObserver.disconnect(); observer?.disconnect(); };
  }, []);

  useEffect(() => {
    const video = player.current;
    if (!video) return;
    let cancelled = false;
    if (playing) void video.play().catch(() => { if (!cancelled) setPlayback("pause"); });
    else video.pause();
    return () => { cancelled = true; video.pause(); };
  }, [playing, index, wantsPlay]);

  function next() { setFailed(false); setIndex(previous => (previous + 1) % CLIPS.length); }
  return <div className="frustration-clip" ref={host}>
    <div className="frustration-clip__screen">
      {wantsPlay && !failed ? <video key={clip.video} ref={player} src={clip.video} poster={clip.poster} muted playsInline preload="none" aria-label={clip.description} onEnded={next} onError={() => { setFailed(true); setPlayback("pause"); }} /> : <img src={clip.poster} alt={clip.description} width={480} height={292} loading="lazy" />}
    </div>
    <div className="frustration-clip__controls">
      <span>{failed ? "Animation unavailable" : "...still not clicking."}</span>
      <button type="button" aria-label={wantsPlay ? "Pause animation" : "Play animation"} onClick={() => { setFailed(false); setPlayback(wantsPlay ? "pause" : "play"); }}>{wantsPlay ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}</button>
      <button type="button" aria-label="Show next reaction" onClick={next}><SkipForward size={15} aria-hidden="true" /></button>
    </div>
  </div>;
}
