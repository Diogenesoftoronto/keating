import { useEffect, useRef, useState } from "react";
import { useMotionAllowed } from "../design-system/motion";
import "./frustration-clip.css";

const source = "/landing/clips/office-rage";
const description = "An office worker swings his keyboard and knocks a CRT monitor off the desk.";

/** A short, silent reaction that plays once on screen. */
export function FrustrationClip() {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const motion = useMotionAllowed();
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const still = !motion || failed;

  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .1 });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = player.current;
    if (!video || !visible || still) return;
    const syncPlayback = () => {
      if (document.hidden) {
        video.pause();
      } else if (!video.ended) {
        video.muted = true;
        void video.play().catch(() => {
          // If autoplay is blocked, the poster remains visible.
        });
      }
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => {
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, [visible, still]);

  return <div className="frustration-clip" ref={host}>
    <video ref={player} hidden={still} poster={`${source}.webp`} muted playsInline preload="none"
      aria-label={description} onError={() => setFailed(true)}>
      <source src={`${source}.webm`} type="video/webm" />
      <source src={`${source}.mp4`} type="video/mp4" onError={() => setFailed(true)} />
    </video>
    {still && <img src={`${source}.webp`} alt="An office worker sits at a desk with a CRT monitor." />}
  </div>;
}
