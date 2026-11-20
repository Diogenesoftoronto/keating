// Recess sound: a small synth. Every effect is an oscillator, a two-operator FM bell or
// filtered noise; a layered loop runs under play. No audio files.
// Owner: the sound lane. Core never plays a sound: it emits events, and the table at the
// bottom of this file decides what each one sounds like. Notes on why: research/sound.md.
export const RecessAudio = (function () {
  "use strict";
  const st = (n) => Math.pow(2, n / 12), rnd = (a, b) => a + Math.random() * (b - a);
  const cents = (c) => st(rnd(-c, c) / 100); // a little pitch drift so repeats never match
  // Nothing here can be heard in the headless harness, so it counts what it would play.
  const LOW = { shot: 1, hit: 1, slurp: 1, ring: 1, graze: 1, pick: 1, click: 1, stir: 1, sparks: 1, whoosh: 1 };
  const GAP = { shot: 70, hit: 70, hit3: 70, slurp: 60, chip: 40, ring: 120, toss: 60, slow: 300, graze: 55, pick: 35, pop: 30, click: 80, home: 400, warn: 90, whoosh: 60, stir: 150, sparks: 220, seg: 25 };
  // Chords are semitones above the key's tonic (A3 = 220 Hz before any key change).
  const PROG = {
    play: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], //  i  VI  III VII: the lesson loop
    gate: [[-4, 0, 3], [-2, 2, 5]], //                          VI VII, held: a question waiting
    boss0: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]], // Bullet points: i VI VII V
    boss1: [[0, 3, 7], [5, 8, 12], [0, 3, 7], [-5, -1, 2]], //  Run-on sentence, in 7/8
    calm: [[0, 4, 7], [5, 9, 12]], //                           the wall has fallen: major, at rest
  };
  const WH = { beam: 260, stop: 420, shell: 500, fan: 800, list: 1000, stream: 1300, dodge: 900, break: 700 };
  const PENT = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24]; // minor pentatonic: every note fits every chord above
  function create() {
    let ac = null, master, bed, bedLP, duckG, verbIn, noiseBuf, pans = [], bus = null, on = false, want = false;
    let timer = 0, step = 0, bar = 0, nextT = 0, shotN = 0, sec = "", held = 1, cut = null;
    const last = {};
    const cleanupTimers = new Set();
    let activeVoices = 0;
    // Music state. Key, meter, tempo and chords change only on a bar line (horizontal
    // re-sequencing); layer levels follow `want` every eighth (vertical layering).
    // Layers: 0 bass, 1 pad, 2 arpeggio, 3 tick, 4 bell melody.
    // Flags the boss's moves set: stuck (the bed repeats one eighth, a hung program's buffer),
    // halt (the bed keeps time but plays nothing: a fake ending), rev (the arpeggio runs backwards).
    const M = { key: 0, meter: 4, tempo: 124, prog: PROG.play, wave: "triangle", lv: [1, 0.6, 0, 0, 0], want: [1, 0.6, 0, 0, 0], pend: null, stuck: 0, halt: 0, rev: 0 };
    function ensure() {
      if (ac) return true;
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return false;
      try { ac = new A(); } catch (e) { return false; }
      const node = (type, o) => { const n = ac["create" + type](); for (const k in o) n[k].value = o[k]; return n; };
      master = node("Gain", { gain: on ? 0.24 : 0 });
      // Laptop speakers stop near 200 Hz; anything under ~110 Hz only eats headroom there.
      const hp = node("BiquadFilter", { frequency: 110, Q: 0.7 }); hp.type = "highpass";
      const comp = node("DynamicsCompressor", { threshold: -18, knee: 12, ratio: 4, attack: 0.004, release: 0.2 });
      master.connect(hp); hp.connect(comp); comp.connect(ac.destination);
      // A small room: one darkened feedback delay that everything sends a little into.
      verbIn = node("Gain", { gain: 0.3 }); const dl = node("Delay", { delayTime: 0.17 }), fb = node("Gain", { gain: 0.3 }), dlp = node("BiquadFilter", { frequency: 2200 }), wet = node("Gain", { gain: 0.5 });
      verbIn.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(wet); wet.connect(master);
      const sfx = node("Gain", { gain: 1 }); sfx.connect(master); sfx.connect(verbIn);
      // Five fixed pan positions instead of a panner per voice: bounded, and plenty for a chat column.
      pans = [-0.6, -0.3, 0, 0.3, 0.6].map((p) => { if (!ac.createStereoPanner) return sfx; const s = ac.createStereoPanner(); s.pan.value = p; s.connect(sfx); return s; });
      bus = pans[2];
      // The bed: its own low-pass (muffled when the bot is hit) and a duck (for big moments).
      bed = node("Gain", { gain: 0.5 }); bedLP = node("BiquadFilter", { frequency: 9000 }); duckG = node("Gain", { gain: 1 });
      bed.connect(bedLP); bedLP.connect(duckG); duckG.connect(master); duckG.connect(verbIn);
      const n = (ac.sampleRate * 0.6) | 0; noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return true;
    }
    // Every source counts itself live until it ends, then lets go of its nodes.
    function track(src, t1, nodes) {
      activeVoices++;
      src.onended = () => { activeVoices--; for (const x of nodes) x.disconnect(); };
      src.stop(t1);
    }
    // Soft attacks everywhere: the quickest is 6 ms, so nothing clicks or startles.
    function env(t, vol, atk, dur, out) {
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(out); return g;
    }
    function tone(type, f0, f1, dur, vol, d, out, atk) {
      const t = ac.currentTime + (d || 0), o = ac.createOscillator(), g = env(t, vol, atk || 0.006, dur, out || bus);
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      o.connect(g); o.start(t); track(o, t + dur + 0.03, [g]);
    }
    function noise(dur, vol, f0, f1, d, q, out, atk) {
      const t = ac.currentTime + (d || 0), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = env(t, vol, atk || 0.004, dur, out || bus);
      s.buffer = noiseBuf; f.type = "bandpass"; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      s.connect(f); f.connect(g); s.start(t, Math.random() * 0.3); track(s, t + dur + 0.03, [f, g]);
    }
    // Two-operator FM bell (Chowning): a modulator whose depth decays leaves a pure ring.
    // Ratio 2 is warm and glassy; 3.5 is the inharmonic clang, kept for the very top.
    function bell(f, dur, vol, d, ratio, out) {
      const t = ac.currentTime + (d || 0), c = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), g = env(t, vol, 0.008, dur, out || bus);
      c.frequency.value = f; m.frequency.value = f * (ratio || 2);
      mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.02, t + dur * 0.5);
      m.connect(mg); mg.connect(c.frequency); c.connect(g); c.start(t); m.start(t); m.stop(t + dur + 0.03); track(c, t + dur + 0.03, [mg, g, m]);
    }
    const hz = (n) => 220 * st(M.key + n);
    const chord = () => M.prog[bar % M.prog.length];
    const pent = (i) => hz(12 + PENT[Math.max(0, Math.min(i, 10))]);
    // Delay to the next eighth, so stingers land in time with the bed (at most one eighth late).
    const beat = () => (sec && nextT > ac.currentTime ? nextT - ac.currentTime : 0);
    function duck(depth, hold) {
      const t = ac.currentTime, g = duckG.gain; g.cancelScheduledValues(t); g.setTargetAtTime(depth, t, 0.03); g.setTargetAtTime(held, t + hold, 0.35);
    }
    // A level the bed stays at until told otherwise (it falls away under the second-wind question).
    function bedTo(v, tc) { held = v; const t = ac.currentTime, g = duckG.gain; g.cancelScheduledValues(t); g.setTargetAtTime(v, t, tc); }
    const out = (i) => pans[Math.max(0, Math.min(4, i))] || bus, bi = () => Math.max(0, pans.indexOf(bus));
    function muffle(f, hold) {
      const t = ac.currentTime, p = bedLP.frequency; p.cancelScheduledValues(t); p.setTargetAtTime(f, t, 0.03); p.setTargetAtTime(9000, t + hold, 0.4);
    }
    const S = {
      // The shot plays ten times a second: a quiet sine pip that walks the current chord's
      // tones, so a stream of fire becomes a little arpeggio over the bed instead of a buzz.
      shot(a) {
        const c = chord(), f = hz(c[shotN++ % 3] + (a && a.focus ? 12 : 24)) * cents(12), busy = 1 - Math.min(0.5, activeVoices / 60);
        tone("sine", f, f * 0.94, 0.04, 0.03 * rnd(0.75, 1) * busy); if (shotN % 2) noise(0.02, 0.012 * busy, 3200, 2200, 0, 2);
      },
      hit() { const f = rnd(780, 980); tone("triangle", f, f * 0.6, 0.035, 0.05); noise(0.025, 0.04, 1900, 1200, 0, 2); }, // a wooden tock
      pop(n) { const f = pent(n || 0) * cents(10); tone("triangle", f, f * 0.45, 0.13, 0.09); noise(0.09, 0.06, 1500, 400); },
      big() { tone("sine", 140, 44, 0.6, 0.32); tone("triangle", 280, 88, 0.35, 0.08); noise(0.45, 0.16, 800, 80); }, // the triangle is the thump laptops can play
      seg(i) { const c = chord(), k = i || 0, f = hz(c[k % 3] + 12 * (1 + Math.floor(k / 3))); tone("triangle", f, f, 0.14, 0.07); bell(f * 2, 0.2, 0.02); },
      // A wrong note bending into tune: used when a misconception is struck, and by the
      // music lesson's "Wrong note" drifters, which really are a semitone sharp.
      fix() { const r = hz(chord()[0] + 12); tone("triangle", r * st(1), r * st(1), 0.09, 0.06); tone("triangle", r * st(1), r, 0.16, 0.07, 0.08); bell(r * 2, 0.5, 0.04); },
      sour() { const r = hz(chord()[0] + 24); tone("sine", r * st(1), r * st(1), 0.08, 0.04); tone("sine", r * st(1), r, 0.12, 0.05, 0.07); },
      pick(n) { const f = pent(n || 0); tone("sine", f, f, 0.08, 0.05); tone("sine", f * 2, f * 2, 0.05, 0.012); },
      heart() { tone("triangle", hz(7), hz(7), 0.16, 0.08); tone("triangle", hz(12), hz(12), 0.3, 0.08, 0.1); },
      // Graze rises with the bomb meter, so you can hear the next Eureka filling up.
      graze(k) { const f = 1500 * st((k || 0) * 12) * cents(20); tone("sine", f, f * 1.08, 0.03, 0.022); },
      hurt() { tone("triangle", 440, 110, 0.42, 0.12, 0, null, 0.012); noise(0.3, 0.12, 700, 90); duck(0.35, 0.5); muffle(500, 0.8); },
      // Eureka: a soft swell, a warm floor, then a major-ninth bell run. The best sound here.
      bomb() {
        noise(0.8, 0.13, 300, 4200, 0, 0.7, null, 0.25); tone("sine", 120, 45, 0.7, 0.3); tone("triangle", 240, 90, 0.4, 0.07);
        [0, 4, 7, 11, 14, 19].forEach((s, i) => bell(hz(12 + s), 1.3 - i * 0.1, 0.055, 0.12 + i * 0.065, i === 5 ? 3.5 : 2));
        duck(0.25, 0.9);
      },
      right(d) { [0, 4, 7, 12].forEach((s, i) => tone("triangle", hz(12 + s), hz(12 + s), 0.18, 0.09, d + i * 0.07)); bell(hz(24), 1.1, 0.06, d + 0.28); duck(0.5, 0.6); },
      // The music lesson's gates play their own answer: twelve semitones, or three beats.
      count(n) {
        const d = beat(), run = n === 12, gap = run ? 0.05 : 60 / M.tempo;
        for (let i = 0; i < n; i++) tone("triangle", hz(12 + (run ? i : 0)), hz(12 + (run ? i : 0)), run ? 0.09 : 0.2, i === n - 1 || !i ? 0.09 : 0.06, d + i * gap);
        bell(hz(24), 1.1, 0.06, d + n * gap); duck(0.5, 0.6 + n * gap);
      },
      wrong() { tone("triangle", hz(7), hz(7), 0.18, 0.06); tone("triangle", hz(5), hz(5), 0.3, 0.05, 0.16); }, // "hm, not quite": soft, never a buzzer
      ask() { tone("triangle", hz(7), hz(7), 0.12, 0.05); tone("triangle", hz(9), hz(9), 0.26, 0.05, 0.12); }, // a rising "hm?"
      warn(boss) { const r = hz(chord()[0] + (boss ? 0 : 12)); tone("triangle", r, r * st(7), boss ? 0.5 : 0.28, 0.05, 0, null, 0.05); }, // a wind-up
      whoosh(k) { const f = WH[k] || 600; noise(0.18, 0.05, f, f * 4, 0, 1.2, null, 0.04); }, // pitched by the attack, so each reads apart
      stir() { noise(0.12, 0.035, 5200, 4000, 0, 0.8, null, 0.03); }, // paper rustle
      lift() { tone("triangle", hz(12), hz(24), 0.16, 0.05); },
      // Words shaken off the page clatter like typewriter keys; flying home they zip back
      // like a carriage return and end on its bell.
      click(n) { for (let i = 0; i < Math.min(n || 1, 4); i++) noise(0.012, 0.04, rnd(2800, 4200), 2400, i * rnd(0.025, 0.05), 3); },
      home(n) { const k = Math.min(n || 1, 9); for (let i = 0; i < k; i++) noise(0.01, 0.025, 3600 + i * 120, 3000, i * 0.022, 3); bell(hz(31), 0.6, 0.035, k * 0.022 + 0.05, 2); },
      sparks() { for (let i = 0; i < 3; i++) { const f = rnd(2400, 3600); tone("sine", f, f * 0.7, 0.05, 0.015, i * 0.04); } },
      start() { [0, 7, 12, 16].forEach((s, i) => tone("triangle", hz(12 + s), hz(12 + s), 0.14, 0.06, i * 0.07)); noise(0.7, 0.08, 300, 2600, 0.1, 1, null, 0.2); },
      launch() { noise(0.6, 0.1, 200, 2600, 0, 1, null, 0.1); tone("sine", 130, 60, 0.3, 0.18); },
      power() { [0, 4, 7, 12].forEach((s, i) => bell(hz(19 + s), 0.3, 0.04, i * 0.05)); },
      charge() { bell(hz(24), 0.4, 0.06); bell(hz(31), 0.5, 0.05, 0.08); },
      mult(m) { const f = pent(Math.min(m + 2, 10)); tone("sine", f, f, 0.1, 0.04); },
      drop() { tone("triangle", hz(12), hz(7), 0.3, 0.04, 0, null, 0.02); muffle(1400, 0.4); }, // quiet: losing a streak is not a punishment
      swell() { [-12, -5, 0].forEach((s) => tone("triangle", hz(s), hz(s), 1.4, 0.07, 0, null, 0.4)); },
      resolve() { [0, 4, 7, 12, 16].forEach((s, i) => tone("triangle", hz(s), hz(s), 2.4, 0.045, i * 0.05, null, 0.3)); bell(hz(28), 2, 0.05, 0.4); duck(0.2, 2); },
      win() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone("triangle", hz(s), hz(s), 0.26, 0.1, i * 0.08)); bell(hz(24), 1.6, 0.06, 0.6); },
      end() { [12, 7, 3, 0].forEach((s, i) => tone("triangle", hz(s), hz(s), 0.24, 0.09, i * 0.12)); },
      // ── the boss's moves ──
      // Slam: a floor thump, then the ripple heard running out both ways, pan by pan.
      slam() {
        tone("sine", 96, 32, 0.7, 0.34); tone("triangle", 192, 60, 0.4, 0.1); noise(0.5, 0.17, 520, 60, 0, 0.8); duck(0.3, 0.5);
        const c = bi(); for (let j = 1; j < 4; j++) for (const s of [-1, 1]) noise(0.05, 0.035 / j, 1400 - j * 200, 700, j * 0.09, 2, out(c + s * j));
      },
      // Charge: a rush that crosses the stereo field the way he goes.
      rush(a) { const r = Math.cos(a || 0) >= 0; for (let j = 0; j < 5; j++) noise(0.24, 0.05, 500 + j * 380, 900 + j * 450, j * 0.12, 1, out(r ? j : 4 - j), 0.06); tone("triangle", 150, 75, 0.7, 0.06, 0, null, 0.1); },
      toss() { noise(0.07, 0.04, 2600, 900, 0, 1.5); const f = rnd(500, 620); tone("sine", f, f * 1.6, 0.09, 0.03); }, // a word flicked off the page
      summon() { [19, 24, 28].forEach((s, i) => bell(hz(s), 0.5, 0.035, i * 0.09)); }, // ¹ ² ³: superscripts, so high and small
      chip() { bell(hz(31) * cents(15), 0.25, 0.03, 0, 3.5); }, // a footnote struck off the shield
      shield() { noise(0.4, 0.06, 4200, 1500, 0, 1); [28, 24, 19, 12].forEach((s, i) => bell(hz(s), 0.4, 0.04, i * 0.05)); },
      ring() { for (const s of chord()) tone("sine", hz(s + 12), hz(s + 12) * 1.03, 0.3, 0.022, 0, null, 0.03); },
      rule() { noise(0.5, 0.06, 300, 900, 0, 2, null, 0.08); }, // a ruler drawn across the page
      // Receipt: the till chatters, then the line tears off.
      tear() { for (let i = 0; i < 5; i++) noise(0.015, 0.03, 2600, 2200, i * 0.035, 4); noise(0.16, 0.06, 4000, 1200, 0.2, 0.9); },
      // Hang: the music itself sticks on one eighth, muffled, with a soft two-note "uh-oh".
      hang() { M.stuck = 1; muffle(1200, 1.7); const r = hz(chord()[0] + 12); tone("sine", r, r, 0.14, 0.05); tone("sine", r * st(-3), r * st(-3), 0.3, 0.05, 0.14); },
      resume() { M.stuck = 0; muffle(9000, 0); [0, 7, 12, 19].forEach((s, i) => tone("sine", hz(12 + s), hz(12 + s), 0.06, 0.04, i * 0.03)); }, // reboot blips
      // Twist: a reversed swell (long attack, sudden end), and the arpeggio turns round too.
      twist() { M.rev ^= 1; noise(0.55, 0.09, 600, 3500, 0, 0.8, null, 0.5); tone("triangle", hz(12), hz(0), 0.55, 0.05, 0, null, 0.5); },
      // "In conclusion…": the bed really stops and plays a closing cadence. "However," cuts it
      // off mid-chord and the music spins back up. The joke is the cut.
      fin() {
        M.halt = 1; const g = ac.createGain(); g.connect(pans[2]); cut = g; const cleanup = setTimeout(() => { cleanupTimers.delete(cleanup); g.disconnect(); }, 4000);
        cleanupTimers.add(cleanup);
        for (const s of [-5, -1, 2]) tone("triangle", hz(s), hz(s), 0.45, 0.06, 0, g, 0.02);
        for (const s of [-12, 0, 3, 7]) tone("triangle", hz(s), hz(s), 2.2, 0.06, 0.48, g, 0.02);
        tone("sine", 110, 50, 0.5, 0.18, 0.48, g); bell(hz(24), 2, 0.04, 0.5, 2, g);
      },
      however() {
        if (cut) { cut.gain.setTargetAtTime(0, ac.currentTime, 0.01); cut = null; }
        noise(0.12, 0.08, 3000, 400, 0, 2); tone("sine", 70, hz(12), 0.35, 0.08, 0.1, null, 0.05); M.halt = 0;
      },
      // Inhale: one long rising breath; each word swallowed is a tiny rising slurp.
      inhale() { noise(2.4, 0.07, 250, 2600, 0, 1.4, null, 2); duck(0.6, 2); },
      slurp(n) { const f = pent(n || 0); tone("sine", f * 0.7, f, 0.06, 0.025); },
      cough() { noise(0.1, 0.08, 800, 300, 0, 1); noise(0.12, 0.07, 700, 260, 0.14, 1); },
      puff() { noise(0.45, 0.06, 900, 300, 0, 0.7, null, 0.12); tone("sine", 160, 110, 0.4, 0.06, 0, null, 0.1); },
      // Thesis: the punish window opens on a bright "there!", and hits in it ring three times as well.
      thesis() { bell(hz(19), 0.7, 0.05); bell(hz(24), 0.9, 0.05, 0.08); },
      hit3() { const f = hz(chord()[0] + 24) * cents(10); tone("triangle", f, f * 0.8, 0.05, 0.06); bell(f * 2, 0.2, 0.03); },
      // ── second wind ──
      down() { bedTo(0.0001, 0.25); muffle(500, 1); tone("sine", hz(7), hz(-12), 1.2, 0.08, 0, null, 0.02); tone("triangle", 140, 60, 0.4, 0.08); for (const s of [-4, 0, 3]) tone("sine", hz(s), hz(s), 5, 0.02, 1.2, null, 1); },
      // Back up: a swell, a major run, a held chord with a bell over it, and the bed in a new key.
      revive() {
        muffle(9000, 0); noise(0.6, 0.1, 300, 5000, 0, 0.8, null, 0.4); tone("sine", 70, 140, 0.45, 0.2, 0, null, 0.35);
        [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone("triangle", hz(s), hz(s), 0.2, 0.07, 0.4 + i * 0.05));
        for (const s of [12, 16, 19, 24]) tone("triangle", hz(s), hz(s), 1.8, 0.05, 0.75, null, 0.05);
        [24, 28, 31, 36].forEach((s, i) => bell(hz(s), 1.6, 0.045, 0.75 + i * 0.08, i === 3 ? 3.5 : 2)); bedTo(1, 0.4);
      },
      rest() { bedTo(1, 0.1); [7, 5, 3, 0].forEach((s, i) => tone("sine", hz(s), hz(s), 0.5, 0.05, i * 0.22, null, 0.04)); }, // a wrong answer: gentle, a lullaby's close
      // The last chance: a held breath as time nearly stops; caught, a sparkle on top of the Eureka.
      gasp() { noise(0.1, 0.04, 1200, 3000, 0, 1, null, 0.05); muffle(500, 0.3); },
      phew() { bell(hz(31), 0.6, 0.04); bell(hz(36), 0.6, 0.035, 0.06); },
      slow(a) { const k = a ? a.scale : 1; muffle(k >= 1 ? 9000 : 700 + 4000 * k, k >= 1 ? 0 : a.seconds); if (k <= 0.25) tone("sine", 220, 110, 0.4, 0.04, 0, null, 0.03); },
    };
    // The bed, scheduled on the audio clock: a 25 ms timer looks 100 ms ahead (Chris Wilson).
    const PULSE = { 3: [0], 4: [0, 4], 7: [0, 2, 4] }; // bass pulses within a bar, in eighths (7/8 is 2+2+3)
    function schedule() {
      if (!ac || !sec) return;
      if (nextT < ac.currentTime - 0.05) nextT = ac.currentTime + 0.05; // a throttled tab: skip, never make up notes
      while (nextT < ac.currentTime + 0.1) {
        const len = M.meter === 7 ? 7 : M.meter * 2, i = step % len;
        if (i === 0 && M.pend) { Object.assign(M, M.pend); M.pend = null; bar = 0; }
        const e = 30 / M.tempo, d = nextT - ac.currentTime, c = chord(), L = M.lv, busy = activeVoices > 48;
        for (let k = 0; k < 5; k++) L[k] += (M.want[k] - L[k]) * (M.halt ? 0 : 0.25);
        if (M.halt) { nextT += e; step++; if ((step % len) === 0) bar++; continue; } // keeps time, plays nothing
        if (L[0] > 0.02 && PULSE[M.meter].includes(i)) { const f = hz(c[0] - 12); tone("triangle", f, f, e * 1.7, 0.16 * L[0], d, bed); tone("sine", f * 2, f * 2, e * 1.2, 0.04 * L[0], d, bed); }
        if (L[1] > 0.02 && i === 0 && !M.stuck) for (const s of c) tone("triangle", hz(s), hz(s), e * len * 0.95, 0.03 * L[1], d, bed, 0.15);
        if (L[2] > 0.02 && !busy) {
          if (M.meter === 3) { if (i === 2 || i === 4) for (const s of c.slice(1)) tone(M.wave, hz(s + 12), hz(s + 12), e * 0.7, 0.02 * L[2], d, bed); } // oom-pah-pah
          else { const s = c[(M.rev ? [2, 1, 0, 1] : [0, 1, 2, 1])[i % 4]] + 12; tone(M.wave, hz(s), hz(s), e * 0.8, 0.022 * L[2], d, bed); }
        }
        if (L[3] > 0.02 && !busy && i % 2 === 1) noise(0.025, 0.03 * L[3] * rnd(0.6, 1), M.tick, M.tick * 0.7, d, 2, bed);
        if (L[4] > 0.02 && !busy && !M.stuck && (i === 0 || i === 3)) bell(hz(c[(bar + i) % 3] + 24), e * 3, 0.022 * L[4], d, 2, bed);
        nextT += e; if (!M.stuck) { step++; if ((step % len) === 0) bar++; }
      }
    }
    function startBed() { if (timer || !ensure()) return; step = 0; bar = 0; nextT = ac.currentTime + 0.08; timer = setInterval(schedule, 25); }
    function stopBed() { clearInterval(timer); timer = 0; }
    M.tick = 7000;
    return {
      // x is -1 (left edge of the arena) to 1 (right edge); it picks one of five pan buses.
      play(name, arg, x) {
        if (!on || !ensure() || !S[name]) return; if (ac.state === "suspended") void ac.resume().catch(() => {});
        const now = performance.now(), gap = GAP[name] || 0;
        if (gap && now - (last[name] || 0) < gap) return;
        if (activeVoices > (LOW[name] ? 36 : 64)) { return; } // a voice cap: busy moments drop the small stuff first
        last[name] = now;
        bus = pans[Math.max(0, Math.min(4, Math.round(((x || 0) + 1) * 2)))] || pans[2];
        try { S[name](arg); } catch { /* A dropped sound does not interrupt gameplay. */ }
        bus = pans[2];
      },
      music(run, bpm) {
        if (bpm) M.tempo = bpm;
        want = !!run; sec = run ? sec || "play" : "";
        if (run && on) startBed(); else if (!run) stopBed();
      },
      // section(name, opts): what the bed should become. Chords, key, meter and tempo wait for
      // the next bar line; layer targets apply at once and fade in over a few eighths.
      section(name, o) {
        o = o || {}; sec = want ? name : ""; if (o.want) M.want = o.want;
        const p = { prog: PROG[o.prog || name] || PROG.play };
        for (const k of ["key", "meter", "tempo", "wave", "tick"]) if (o[k] !== undefined) p[k] = o[k];
        if (o.now) { Object.assign(M, p); bar = 0; } else M.pend = p;
      },
      // Mute is instant and total: the master drops to zero now and the context suspends.
      set(v) {
        on = v; if (!ac) return;
        master.gain.cancelScheduledValues(ac.currentTime); master.gain.setValueAtTime(v ? 0.24 : 0, ac.currentTime);
        if (v) { void ac.resume().catch(() => {}); if (want) startBed(); } else { stopBed(); void ac.suspend().catch(() => {}); }
      },
      // flag({stuck, halt, rev}): set the bed's move flags (to clear them when a move ends early).
      flag(o) { Object.assign(M, o); if (ac && o.halt === 0 && cut) { cut.gain.setTargetAtTime(0, ac.currentTime, 0.05); cut = null; } },
      bed(v) { if (ac) bedTo(v, 0.1); },
      get on() { return on; },
      unlock() { if (on && ensure() && ac.state === "suspended") void ac.resume().catch(() => {}); },
      dispose() {
        on = false; want = false;
        stopBed();
        for (const timer of cleanupTimers) clearTimeout(timer);
        cleanupTimers.clear();
        if (ac) void ac.close().catch(() => {});
        ac = null;
      },
      get beat() { return ac ? beat() : 0; },
    };
  }
  return { create };
})();

export function install(G) {
    const snd = G.snd; if (!snd.section) return; // an older sound object: play nothing new
    const px = (x) => (x == null ? 0 : (x / G.W) * 2 - 1), play = (n, a, x) => snd.play(n, a, px(x));
    const music = () => G.pack && G.pack.id === "music"; // the music lesson is in 3/4, like its own question
    let phase = -1, bm = "", eat = 0, wind = 0, lift = 0; // lift: the key a second wind raised the lesson loop to
    const BP = ["boss0", "boss1", "play", "boss0"];
    // attack kinds with their own voice; the rest get a whoosh pitched by kind
    const KIND = { slam: "slam", throw: "toss", summon: "summon", rule: "rule", receipt: "tear", hang: "hang", resume: "resume", twist: "twist", however: "however", inhale: "inhale", puff: "puff", ring: "ring" };
    // Which layers play: bass and pad always, then arpeggio, tick and bell as the streak climbs.
    function layers() {
      const m = G.mult || 1;
      if (G.boss) return [1, 0.4, 1, 1, m >= 3 ? 1 : 0];
      if (G.gates) return [0.5, 1, 0, 0, 0]; // the calm of the gates: only the held chord
      return [1, 0.6, m >= 2 ? 1 : 0.25, m >= 3 ? 1 : 0, m >= 5 ? 1 : 0];
    }
    const base = () => ({ key: lift, meter: music() ? 3 : 4, tempo: music() ? 132 : 124, wave: G.theme === "term" ? "square" : "triangle", tick: 7000 });
    const relayer = () => { if (!G.boss || phase >= 0) snd.section(G.boss ? "boss" : G.gates ? "gate" : "play", Object.assign(G.boss ? {} : base(), { want: layers(), prog: G.boss ? BP[Math.min(phase, 3)] : undefined })); };
    const clear = () => { lift = 0; bm = ""; eat = 0; wind = 0; snd.flag({ stuck: 0, halt: 0, rev: 0 }); snd.bed(1); };
    G.on("start", () => { phase = -1; clear(); play("start"); snd.music(true, base().tempo); snd.section("play", Object.assign(base(), { want: layers(), now: true })); });
    G.on("launch", (d) => play("launch", 0, d.x));
    G.on("shot", (d) => play("shot", d, d.x));
    G.on("foeHit", (d) => play(d.e === G.boss && d.e.mode === "thesis" ? "hit3" : "hit", 0, d.x));
    G.on("kill", (d) => {
      const b = d.e.boss; if (d.e.k === "note" && b) play(b.notes.some((f) => f !== d.e && !f.dead) ? "chip" : "shield", 0, d.e.x);
      if (music() && d.e.k === "drift") play("sour", 0, d.e.x); // a wrong note, put right
      play(d.big ? "big" : "pop", Math.min(G.chain, 10), d.e.x);
    });
    G.on("segPop", (d) => play("seg", d.i, d.x));
    G.on("mythStruck", (d) => play("fix", 0, d.e.x));
    G.on("termStir", (d) => play("stir", 0, d.x));
    G.on("termLift", (d) => play("lift", 0, d.x));
    G.on("telegraph", (d) => play("warn", d.e === G.boss, d.e.x));
    G.on("attack", (d) => {
      const e = d.e || {}, k = d.kind;
      if (k === "charge" && e === G.boss) play("rush", e.ang, e.x); else play(KIND[k] || "whoosh", k, e.x);
      if (k === "throw" && e.held) for (let i = 1; i < e.held.length; i++) G.later((i * 0.3) / (e.ms || 1), () => play("toss", 0, e.x + (i - e.held.length / 2) * 50));
    });
    // Moves with no event of their own (the thesis window, the fake ending, words swallowed) are
    // read off the boss each frame; leaving a move also clears what it did to the bed.
    G.hook("frame", () => {
      const e = G.boss, m = e && !e.dead ? e.mode : "";
      if (m !== bm) {
        if (bm === "hang") snd.flag({ stuck: 0 }); if (bm === "conclusion") snd.flag({ halt: 0 });
        if (m === "thesis") { if (bm === "inhale") play("cough", 0, e.x); play("thesis", 0, e.x); }
        if (m === "conclusion") play("fin", 0, e.x);
        bm = m;
      }
      if (m === "inhale" && e.eat) { if (e.eat.length > eat) play("slurp", e.eat.length, e.x); eat = e.eat.length; } else eat = 0;
    });
    G.on("wordsKnocked", (d) => play("click", d.n, d.x));
    G.on("wordsHome", (d) => { if (d.n) play("home", d.n); });
    G.on("cancel", (d) => { if (d.toSparks && d.bullets && d.bullets.length > 4) play("sparks"); });
    G.on("gateStart", () => { play("ask"); snd.section("gate", Object.assign(base(), { want: [0.5, 1, 0, 0, 0] })); });
    G.on("gateResolve", (d) => {
      const n = +d.picked, b = snd.beat;
      if (d.ok && music() && (n === 12 || n === 3)) play("count", n); else play(d.ok ? "right" : "wrong", b, d.x);
      G.later(0.05, relayer);
    });
    G.on("bossSpawn", (d) => { phase = 0; play("swell", 0, d.e.x); snd.music(true); snd.section("boss0", { key: 5, meter: 4, tempo: 148, want: [1, 0.4, 1, 1, 0] }); });
    // Each phase of the Wall of Text changes the bed: straight 4/4, then a 7/8 that never
    // lands where you expect (a run-on sentence), then up a fourth with tiny high ticks.
    G.on("bossPhase", (d) => {
      phase = d.stage; play("big", 0, d.x);
      if (d.stage === 1) snd.section("boss1", { key: 5, meter: 7, tempo: 150, want: layers() });
      else if (d.stage === 3) snd.section("boss0", { key: 7, meter: 4, tempo: 164, tick: 11000, want: [1, 0.6, 1, 1, 1], now: !d.first }); // Fine print, after "However,": straight back in, higher and faster
      else if (d.stage >= 2) snd.section("boss0", { prog: "play", key: 10, meter: 4, tempo: 156, tick: 11000, want: [1, 0.4, 1, 1, 1] });
    });
    G.on("bossDeath", (d) => { snd.flag({ stuck: 0, halt: 0, rev: 0 }); play("big", 0, d.e.x); play("resolve"); snd.section("calm", { key: 5, meter: 4, tempo: 96, want: [0.6, 1, 0, 0, 1], now: true }); });
    G.on("playerHit", (d) => play("hurt", 0, d.x));
    G.on("hitPending", (d) => play("gasp", 0, d.x));
    G.on("lastChance", (d) => play("phew", 0, d.x));
    G.on("slow", (d) => play("slow", d));
    // Second wind: the bed falls away under the question. A right answer is the biggest return
    // in the game: up a whole step, every layer at once. A wrong one is a soft close.
    G.on("downed", (d) => { wind = 1; play("down", 0, d.x); });
    G.on("revive", (d) => {
      wind = 0; lift = 2; const k = G.boss ? [5, 5, 10, 7][Math.max(0, phase)] + 2 : lift;
      snd.section(G.boss ? "boss" : "play", Object.assign(G.boss ? {} : base(), { key: k, prog: G.boss ? BP[Math.max(0, phase)] : undefined, want: [1, 1, 1, 1, 1], now: true }));
      play("revive", 0, d.x);
    });
    G.on("bomb", (d) => play("bomb", 0, d.x));
    G.on("graze", (d) => play("graze", Math.min(1, G.meter / 36), d.x));
    G.on("charge", (d) => play("charge", 0, d.x));
    G.on("pickup", (d) => { const k = d.p.k; play(k === "s" ? "pick" : k === "c" || k === "e" ? "charge" : "heart", Math.min(d.streak, 10), d.p.x); });
    G.on("powerUp", (d) => play("power", 0, d.x));
    G.on("multUp", (d) => { play("mult", d.mult); relayer(); });
    G.on("chainLost", () => { play("drop"); relayer(); });
    G.on("finish", (d) => { snd.music(false); snd.flag({ stuck: 0, halt: 0, rev: 0 }); if (!d.quit) play(d.won ? "win" : wind ? "rest" : "end"); wind = 0; });
}
