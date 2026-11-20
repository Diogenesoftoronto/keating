import { useEffect, useRef, useState } from "react";

interface ReadingPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

function serialAPI() {
  return typeof navigator !== "undefined"
    ? (navigator as Navigator & { serial?: { requestPort(): Promise<ReadingPort> } }).serial
    : undefined;
}

function finiteReading(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Decode newline-delimited ASCII numbers. Discard an oversized frame through
 * its delimiter so a truncated suffix can never become a device reading. */
function numericFrames() {
  let line = "";
  let discard = false;
  return (chunk: Uint8Array) => {
    let latest: number | null = null;
    for (const byte of chunk) {
      if (byte === 10) {
        if (!discard) latest = finiteReading(line) ?? latest;
        line = "";
        discard = false;
      } else if (!discard) {
        if (line.length >= 64) discard = true;
        else line += String.fromCharCode(byte);
      }
    }
    return latest;
  };
}

export function HardwareLabInput({ disabled, baudRate, unit, onSample }: {
  disabled: boolean;
  baudRate: 9600 | 115200;
  unit: string;
  onSample: (value: number, input: "device" | "manual") => void;
}) {
  const [phase, setPhase] = useState<"idle" | "connecting" | "reading" | "closing">("idle");
  const [latest, setLatest] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState("");
  const connection = useRef<AbortController | null>(null);
  const manualValue = finiteReading(manual);

  useEffect(() => {
    setPhase("idle");
    setLatest(null);
    setManual("");
    setNotice("");
    return () => {
      connection.current?.abort();
      connection.current = null;
    };
  }, [baudRate, unit, disabled]);

  async function connect() {
    const api = serialAPI();
    if (!api || disabled || connection.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    connection.current = controller;
    setNotice("");
    setLatest(null);
    setPhase("connecting");
    let port: ReadingPort | undefined;
    let opened = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelRead = () => { void reader?.cancel().catch(() => undefined); };
    const unplug = () => {
      if (connection.current === controller) {
        setNotice("Device disconnected.");
        setLatest(null);
        setPhase("closing");
      }
      controller.abort();
    };
    try {
      port = await api.requestPort();
      if (signal.aborted) return;
      port.addEventListener("disconnect", unplug);
      await port.open({ baudRate });
      opened = true;
      if (signal.aborted) return;
      if (!port.readable) throw new Error("This device did not open a readable serial stream.");
      reader = port.readable.getReader();
      signal.addEventListener("abort", cancelRead);
      setPhase("reading");
      const decode = numericFrames();
      while (!signal.aborted) {
        const frame = await reader.read();
        if (frame.done || signal.aborted) break;
        const value = decode(frame.value);
        if (value !== null) setLatest(value);
      }
      if (!signal.aborted) setNotice("The device stream ended.");
    } catch (error) {
      if (!signal.aborted) {
        setNotice(error instanceof Error && error.name === "NotFoundError"
          ? "No device selected." : error instanceof Error ? error.message : "Could not read this serial device.");
      }
    } finally {
      signal.removeEventListener("abort", cancelRead);
      port?.removeEventListener("disconnect", unplug);
      reader?.releaseLock();
      if (connection.current === controller) {
        setLatest(null);
        setPhase("closing");
      }
      if (opened && port) {
        try { await port.close(); } catch (error) {
          if (connection.current === controller && !signal.aborted) setNotice(error instanceof Error ? error.message : "Could not close the serial port.");
        }
      }
      if (connection.current === controller) {
        connection.current = null;
        setPhase("idle");
      }
    }
  }

  function disconnect() {
    connection.current?.abort();
    setLatest(null);
    setPhase("closing");
  }

  return <div className="hardware-lab-input">
    <p>Send one number per line at {baudRate} baud{unit ? ` (${unit})` : ""}.</p>
    <div className="teaching-lab-controls">
      {serialAPI() && (phase === "idle"
        ? <button type="button" disabled={disabled} onClick={connect}>Connect device</button>
        : <button type="button" disabled={phase === "closing"} onClick={disconnect}>
            {phase === "connecting" ? "Cancel connection" : "Disconnect device"}
          </button>)}
      {phase === "reading" && <>
        <span>{latest === null ? "Waiting for a number…" : `Device reading: ${latest} ${unit}`.trimEnd()}</span>
        <button type="button" disabled={disabled || latest === null}
          onClick={() => { if (latest !== null) onSample(latest, "device"); }}>Check reading</button>
      </>}
    </div>
    <p role="status">{notice || (!serialAPI() ? "Serial input is unavailable in this browser. Enter a reading below." : "")}</p>
    <div className="teaching-lab-controls">
      <label>Manual reading{unit ? ` (${unit})` : ""} <input className="k-input" type="text" inputMode="decimal" size={9} maxLength={64}
        value={manual} disabled={disabled} onChange={event => setManual(event.target.value)} /></label>
      <button type="button" disabled={disabled || manualValue === null}
        onClick={() => { if (manualValue !== null) onSample(manualValue, "manual"); }}>Check manual reading</button>
    </div>
  </div>;
}
