import { PlaybackPosition } from "./PlaybackPosition";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../design-system/kit";
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
  const [position,setPosition] = useState(0);
  const [duration,setDuration] = useState(0);
  const clip = CLIPS[index];
  const wantsPlay = playback === "play" || (playback === "auto" && !reduced);
  const playing = wantsPlay && visible && pageVisible && !failed;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => { const next = preference.matches || (document.documentElement.dataset.motion === "reduce" || document.documentElement.dataset.reduceMotion === "true"); setReduced(next); if (next) setPlayback("auto"); };
    const syncVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    syncMotion(); syncVisibility();
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    const motionObserver = new MutationObserver(syncMotion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion","data-reduce-motion"] });
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

  function next() { setPosition(0); setDuration(0); setFailed(false); setIndex(previous => (previous + 1) % CLIPS.length); }
  return <div className="specialist-frame frustration-clip" ref={host}>
    <div className="frustration-clip__screen k-grid">
      {(wantsPlay || duration > 0) && !failed ? <video key={clip.video} ref={player} src={clip.video} poster={clip.poster} muted playsInline preload="none" aria-label={clip.description} onTimeUpdate={e=>setPosition(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)} onEnded={next} onError={() => { setFailed(true); setPlayback("pause"); }} /> : <img src={clip.poster} alt={clip.description} width={480} height={292} loading="lazy" />}
    </div>
    {duration > 0 && !failed && <PlaybackPosition label="Clip position" max={duration} value={position} onSeek={t=>{if(player.current) player.current.currentTime=t;setPosition(t);}} />}
    <div className="frustration-clip__controls">
      <span>{failed ? "Animation unavailable" : "...still not clicking."}</span>
      <IconButton glyph={wantsPlay ? "pause" : "play"} label={wantsPlay ? "Pause animation" : "Play animation"} onClick={() => { setFailed(false); setPlayback(wantsPlay ? "pause" : "play"); }} />
      <IconButton glyph="skip" label="Show next reaction" onClick={next} />
    </div>
  </div>;
}
