import { useEffect, useRef, useState } from "react";

/** Meter the existing recording stream without playing it through the speakers. */
export function RecordingWaveform({ stream }: { stream: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - started) / 1000)), 1000);
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let frame = 0;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      void context.resume().catch(() => {});
      const samples = new Float32Array(analyser.fftSize);
      const levels = new Array<number>(32).fill(0);
      let last = 0;
      const draw = (now: number) => {
        frame = requestAnimationFrame(draw);
        if (now - last < 50) return;
        last = now;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        levels.shift();
        levels.push(Math.min(1, rms * 6));
        const canvas = canvasRef.current;
        const pen = canvas?.getContext("2d");
        if (!canvas || !pen) return;
        pen.clearRect(0, 0, 128, 28);
        pen.fillStyle = getComputedStyle(canvas).color;
        levels.forEach((level, index) => {
          const height = Math.max(2, level * 26);
          pen.fillRect(index * 4, (28 - height) / 2, 2, height);
        });
      };
      frame = requestAnimationFrame(draw);
    } catch {
      // Recording and its timer still work when Web Audio is unavailable.
    }
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(frame);
      source?.disconnect();
      if (context) void context.close().catch(() => {});
    };
  }, [stream]);

  return <span style={{display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0}}>
    <canvas ref={canvasRef} width={128} height={28} aria-hidden="true"
      style={{width: "clamp(48px, 14vw, 128px)", height: 28, color: "inherit"}} />
    <span aria-label={`Recording duration ${seconds} seconds`}
      style={{fontVariantNumeric: "tabular-nums", fontSize: 12}}>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  </span>;
}
