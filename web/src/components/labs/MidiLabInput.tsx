import { useEffect, useRef, useState } from "react";
import "./midi-lab-input.css";
import { KeatingGlyph } from "../../design-system/glyphs";

type NoteInput = "device" | "screen";
export interface MidiLabInputProps {
  disabled: boolean;
  notes: readonly number[];
  onNote: (note: number, input: NoteInput) => void;
}

const pitches = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const whiteKeys = [0, 2, 4, 5, 7, 9, 11];
const blackKeys = [{ pitch: 1, after: 1 }, { pitch: 3, after: 2 }, { pitch: 6, after: 4 }, { pitch: 8, after: 5 }, { pitch: 10, after: 6 }];

export function midiNoteName(note: number): string {
  return pitches[note % 12] + (Math.floor(note / 12) - 1);
}

export function MidiLabInput({ disabled, notes, onNote }: MidiLabInputProps) {
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [selected, setSelected] = useState<MIDIInput | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [userOctave, setUserOctave] = useState<number | null>(null);
  const octave = userOctave ?? Math.floor((notes.find(note => Number.isInteger(note) && note >= 0 && note <= 127) ?? 60) / 12);
  const permissionRequest = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const sendNote = useRef(onNote);
  useEffect(() => { sendNote.current = onNote; }, [onNote]);

  useEffect(() => {
    if (disabled) {
      setAccess(null);
      setInputs([]);
      setSelected(null);
      setRequesting(false);
      setNotice("");
    }
    return () => {
      permissionRequest.current++;
      if (audio.current) {
        void audio.current.close().catch(() => {});
        audio.current = null;
      }
    };
  }, [disabled]);

  useEffect(() => {
    if (!access || disabled) return;
    const refresh = () => {
      const connected = Array.from(access.inputs.values()).filter(input => input.state === "connected");
      setInputs(connected);
      if (selected && !connected.includes(selected)) {
        setSelected(null);
        setNotice("The selected input disconnected. Choose an input when it reconnects.");
      }
    };
    refresh();
    access.addEventListener("statechange", refresh);
    return () => access.removeEventListener("statechange", refresh);
  }, [access, selected, disabled]);

  useEffect(() => {
    if (!selected || disabled) return;
    let active = true;
    const message = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (active && data && data.length === 3 && (data[0]! & 0xf0) === 0x90 && data[2]! > 0 && data[1]! < 128) {
        sendNote.current(data[1]!, "device");
      }
    };
    void selected.open().then(() => {
      if (active) selected.addEventListener("midimessage", message);
    }).catch(() => {
      if (active) {
        setSelected(null);
        setNotice("Could not open that MIDI input. Choose another input or use the keys below.");
      }
    });
    return () => {
      active = false;
      selected.removeEventListener("midimessage", message);
      void selected.close().catch(() => {});
    };
  }, [selected, disabled]);

  async function connect() {
    const request = ++permissionRequest.current;
    if (typeof navigator.requestMIDIAccess !== "function") {
      setNotice("This browser cannot connect to MIDI. You can play the keys below.");
      return;
    }
    setRequesting(true);
    setNotice("");
    try {
      const result = await navigator.requestMIDIAccess({ sysex: false });
      if (request === permissionRequest.current) setAccess(result);
    } catch {
      if (request === permissionRequest.current) setNotice("MIDI access was unavailable. Allow MIDI in your browser or play the keys below.");
    } finally {
      if (request === permissionRequest.current) setRequesting(false);
    }
  }

  function disconnect() {
    permissionRequest.current++;
    setSelected(null);
    setAccess(null);
    setInputs([]);
    setNotice("MIDI disconnected.");
  }

  function play(note: number) {
    if (disabled) return;
    onNote(note, "screen");
    // Local preview only. A missing audio device must not prevent a practice attempt.
    try {
      const context = audio.current ??= new AudioContext();
      if (context.state === "suspended") void context.resume().catch(() => {});
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + 0.34);
    } catch { /* Device or Web Audio unavailable. */ }
  }

  const key = (pitch: number, after?: number) => {
    const note = octave * 12 + pitch;
    if (note > 127) return null;
    return <button key={pitch} type="button" disabled={disabled} className={after ? "midi-lab-black" : "midi-lab-white"}
      aria-label={`Play ${midiNoteName(note)}, MIDI ${note}`} onClick={() => play(note)}
      style={after ? { left: `${100 * after / 7}%` } : undefined}>
      {midiNoteName(note)}
    </button>;
  };

  return <div className="midi-lab-input">
    <div className="midi-lab-controls">
      {access ? <>
        <label>MIDI input <select disabled={disabled} value={selected?.id ?? ""} onChange={event => {
          setSelected(inputs.find(input => input.id === event.target.value) ?? null);
          setNotice("");
        }}><option value="">Choose input</option>{inputs.map(input => <option key={input.id} value={input.id}>{input.name || input.id}</option>)}</select></label>
        <button type="button" onClick={disconnect}><KeatingGlyph name="x" size={13} />Disconnect MIDI</button>
      </> : <button type="button" disabled={disabled || requesting} onClick={connect}><KeatingGlyph name="keyboard" size={13} />{requesting ? "Connecting…" : "Connect MIDI"}</button>}
      <label>Octave <select value={octave} disabled={disabled} onChange={event => setUserOctave(Number(event.target.value))}>
        {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i - 1}</option>)}
      </select></label>
    </div>
    <p role="status">{notice || (access && !inputs.length ? "No MIDI inputs detected. Connect an instrument or play the keys below." : "")}</p>
    <div className="midi-lab-keyboard" role="group" aria-label={`Practice keyboard, octave ${octave - 1}`}>
      {whiteKeys.map(pitch => key(pitch))}
      {blackKeys.map(({ pitch, after }) => key(pitch, after))}
    </div>
  </div>;
}
