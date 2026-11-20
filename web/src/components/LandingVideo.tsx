import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { IconButton } from "../design-system/kit";
import "./landing-video.css";

export interface LandingVideoHandle {
  play: () => void;
  pause: () => void;
}

interface LandingVideoProps {
  ref?: Ref<LandingVideoHandle>;
  title: string;
  poster: string;
  mp4: string;
  webm?: string;
  captions: string;
  durationLabel: string;
  hasAudio?: boolean;
  hidden?: boolean;
}

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function LandingVideo({ ref, title, poster, mp4, webm, captions, durationLabel, hasAudio, hidden }: LandingVideoProps) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<FullscreenVideo>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const position = `${formatTime(time)} / ${duration ? formatTime(duration) : durationLabel}`;

  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled || video.current?.webkitEnterFullscreen));
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === frame.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  function play() {
    const media = video.current;
    if (!media) return;
    setNotice("");
    if (media.error) media.load();
    void media.play().catch(error => {
      if (error.name !== "AbortError") setNotice("Couldn’t play the video. Try Play again.");
    });
  }

  useImperativeHandle(ref, () => ({ play, pause: () => video.current?.pause() }));

  function togglePlayback() {
    if (video.current?.paused) play();
    else video.current?.pause();
  }

  function seek(value: number) {
    if (video.current) video.current.currentTime = value;
    setTime(value);
  }

  function toggleCaptions() {
    const track = video.current?.textTracks[0];
    if (!track) return;
    const next = track.mode !== "showing";
    track.mode = next ? "showing" : "disabled";
    setCaptionsOn(next);
  }

  function toggleFullscreen() {
    const surface = frame.current;
    if (!surface) return;
    if (document.fullscreenElement === surface) {
      void document.exitFullscreen().catch(() => setNotice("Couldn’t exit full screen."));
    } else if (document.fullscreenEnabled) {
      void surface.requestFullscreen().catch(() => setNotice("Full screen is unavailable."));
    } else {
      try {
        video.current?.webkitEnterFullscreen?.();
      } catch {
        setNotice("Full screen is unavailable.");
      }
    }
  }

  return <div className="landing-video" ref={frame} hidden={hidden}>
    <div className="landing-video__picture">
      <video ref={video} aria-label={title} poster={poster} playsInline preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onVolumeChange={event => setMuted(event.currentTarget.muted)}
        onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onDurationChange={event => {
          const seconds = event.currentTarget.duration;
          setDuration(Number.isFinite(seconds) ? seconds : 0);
        }}
        onError={() => setNotice("Video unavailable.")}>
        {webm && <source src={webm} type="video/webm" />}
        <source src={mp4} type="video/mp4" onError={() => setNotice("Video unavailable.")} />
        <track kind="captions" src={captions} srcLang="en" label="English" />
      </video>
    </div>
    <div className="landing-video__controls" role="group" aria-label={`${title} controls`}>
      <IconButton label={`${playing ? "Pause" : "Play"} ${title}`} glyph={playing ? "pause" : "play"} onClick={togglePlayback} />
      <input className="landing-video__seek" type="range" min={0} max={duration || 1} step="any"
        aria-label="Playback position" aria-valuetext={position} disabled={!duration}
        value={Math.min(time, duration)} onChange={event => seek(event.currentTarget.valueAsNumber)} />
      <span className="landing-video__time" aria-hidden="true">{position}</span>
      {hasAudio && <IconButton label={muted ? "Unmute" : "Mute"} glyph={muted ? "mute" : "speaker"}
        onClick={() => { if (video.current) video.current.muted = !video.current.muted; }} />}
      <button type="button" className="landing-video__captions k-icon" aria-label="Captions" aria-pressed={captionsOn} onClick={toggleCaptions}>CC</button>
      {canFullscreen && <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} glyph={fullscreen ? "collapse" : "expand"} onClick={toggleFullscreen} />}
    </div>
    {notice && <p className="landing-video__notice" role="status">{notice}</p>}
  </div>;
}
