import { install as installAudio } from "./audio.js";
import { install as installFeedback } from "./feedback.js";
import { install as installBullets } from "./bullets.js";
import { install as installPatterns } from "./patterns.js";
import { RecessArt } from "./foes.js";
import { RecessFx } from "./fx.js";
import { RecessPatterns } from "./patterns.js";
// Recess core: the loop, the player, collisions, the chat's words, gates, scoring.
// Owner: the coordinator. Other modules never edit this file; they read and write the game
// object G, listen to its events, and attach hooks. The contract is written down in lanes/API.md.
//
// Core decides WHAT happened and says so with G.emit(...). It draws and plays nothing for
// effect: feedback.js turns events into particles and shake, audio.js into sound, fx.js into
// the shader pass, patterns.js and bullets.js decide what enemies and bullets do.
export const Recess = (function () {
  "use strict";
  const A = RecessArt, PAL = A.PAL, TAU = A.TAU, MONO = A.MONO;
  const rnd = (a, b) => (b === undefined ? Math.random() * (a === undefined ? 1 : a) : a + Math.random() * (b - a));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
  const PW = [0, 28, 75, 150]; // sparks needed for each power level

  function create(o) {
    const arena = o.arena, thread = o.thread, view = o.view;
    const g = document.createElement("canvas"), c = g.getContext("2d");
    const ge = document.createElement("canvas"), em = ge.getContext("2d"); // emissive layer: only what should glow
    let post = null;
    const shader = o.shader;
    if (shader && !o.calm) {
      try { post = RecessFx.post(shader); }
      catch { shader.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext(); }
    }
    const v2 = view.getContext("2d");
    if (!c || !em || !v2) throw new Error("The browser could not open a game canvas.");
    let AR = null, raf = 0, lastTs = 0, outT = 0, returned = false, pickN = 0, pickT = 0, bombT = 0, heap = new Float32Array(1), script = null;
    let hitT = 0, lastHit = -99, calmT = 0, usedWind = false;
    const listeners = Object.create(null), hooks = Object.create(null);
    let disposed = false;

    const G = {
      o, c, em, rnd, clamp, lerp, TAU, PW, MONO,
      W: 1, H: 1, dpr: 1, floorY: 1, T: 0, RT: 0, state: "idle",
      theme: o.theme || "paper", pal: PAL[o.theme || "paper"], dark: o.theme === "term", pack: o.pack, control: o.control || "follow", toy: o.toy || null,
      calm: Boolean(o.calm),
      P: { scale: 1, x: 0, y: 0, vx: 0, vy: 0, tilt: 0, inv: 0, hearts: 4, bombs: 2, power: 1, pw: 0, shotT: 0, vol: 0, anim: "hover", animT: 0, focus: false, ox: 0, oy: 0, left: false, thrust: 0, aim: -Math.PI / 2, lock: null, fireT: 9, manual: false, flick: 0, seed: 0 },
      home: { x: 0, y: 0 }, inp: { tx: 0, ty: 0, ax: 0, ay: 0, held: false, keys: {}, lx: 0, ly: 0, pid: null, aid: null, touch: false, usingKeys: false },
      foes: [], shots: [], bul: [], picks: [], words: [], timers: [], gates: null, boss: null, ring: null, tldr: null,
      score: 0, mult: 1, chain: 0, comboT: 0, kills: 0, grazes: 0, meter: 0, rattled: 0, label: "", won: false, quit: false, res: { gates: [], myths: [] },
      // How well he has been looked after (lanes/CARE-design.md), each 0 to 1; 0.75 is the standard bot.
      // charge: top speed and how hard his jets burn. tune: how fast he fires and turns to aim. shine: a third Eureka at 0.9.
      care: { charge: 0.75, tune: 0.75, shine: 0.75 }, sparks: 0,
      // Firing charge: starts at his Care charge, drains only when he fires, refills from pickups.
      energy: 0.75, energy0: 0.75, cellT: 0,
      // 0 to 1. Rises quietly when he is hit twice in twenty seconds, eases back after thirty without a hit.
      // Core slows new bullets by up to 15% and softens new enemies by up to 12% with it. Never shown to the player.
      mercy: 0,
      // what the screen is doing; feedback.js and fx.js own the meaning, core only decays and applies it
      fx: { shake: 0, flash: 0, hit: 0, stop: 0, slow: 1, slowT: 0, speed: 0.3, focus: 0, on: 0, shocks: [] },
      kinds: {}, bullets: {}, snd: o.sound, J: null,
      on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return G; },
      emit(name, d) { const l = listeners[name]; if (l) for (const fn of l) { try { fn(d || {}, G); } catch (e) { console.error("Recess listener for " + name + ":", e); } } },
      hook(name, fn) { (hooks[name] = hooks[name] || []).push(fn); return G; },
      later(s, fn) { G.timers.push({ t: s, fn }); },
      aim: (x, y) => Math.atan2(G.P.y - y, G.P.x - x),
      // bullets: kind is a key of G.bullets (bullets.js). extra is merged in, for kinds that need more state.
      fire(x, y, ang, spd, kind, extra) {
        if (G.bul.length > 700) return null;
        spd *= 1 - 0.15 * G.mercy;
        const def = G.bullets[kind || 0] || G.bullets[0], b = { x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r: def.r, k: kind || 0, gz: false, a: rnd(TAU), t: 0, spd, ang };
        if (extra) Object.assign(b, extra); G.bul.push(b); return b;
      },
      mk(k, x, y, props) { const e = Object.assign({ k, x, y, r: 13, hp: 3, max: 0, t: 0, flash: 0, seed: rnd(1000), pts: 100, born: 0, born0: 0.5, dead: 0, sym: "", act: "idle", actT: 0 }, props); if (G.mercy > 0 && e.per === undefined && e.hp > 3) e.hp = Math.max(3, Math.round(e.hp * (1 - 0.12 * G.mercy))); e.max = e.hp; e.born0 = e.born || 0.5; return e; },
      spawn(e) { G.foes.push(e); G.emit("foeSpawn", { e }); return e; },
      addPick(k, x, y, mag) { const p = { k, x, y, vx: rnd(-50, 50), vy: rnd(-130, -40), t: 0, mag: !!mag }; G.picks.push(p); return p; },
      addScore(n) { G.score += n; },
      addChain() { G.chain++; G.comboT = 2.8; const m = Math.min(8, 1 + Math.floor(G.chain / 4)); if (m > G.mult) { G.mult = m; G.emit("multUp", { mult: m }); } },
      dropChain() { if (G.mult > 1 || G.chain > 0) G.emit("chainLost", { mult: G.mult }); G.chain = 0; G.mult = 1; G.comboT = 0; },
    };
    const run = (name, a) => { const l = hooks[name]; if (l) for (const fn of l) fn(a, G); };
    const P = G.P, inp = G.inp, fx = G.fx;

    function size() {
      AR = arena.getBoundingClientRect(); G.W = Math.max(240, AR.width); G.H = Math.max(240, AR.height); G.dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(G.W * G.dpr), h = Math.round(G.H * G.dpr);
      if (g.width !== w || g.height !== h) { g.width = ge.width = view.width = w; g.height = ge.height = view.height = h; if (post && !post.lost) { shader.width = w; shader.height = h; post.resize(w, h); } }
      const d = o.dock.getBoundingClientRect(); G.floorY = d.top - AR.top + 4;
      const b = o.bot.getBoundingClientRect(); G.home.x = b.left - AR.left + b.width / 2; G.home.y = b.top - AR.top + b.height / 2;
    }

    // ── the chat's words: measured where they sit, lifted off the page only when knocked ──
    function collect() {
      G.words = [];
      for (const el of thread.querySelectorAll(".w")) {
        const r = el.getBoundingClientRect(); if (r.width < 1 || r.bottom < AR.top || r.top > AR.bottom) continue;
        const cs = getComputedStyle(el);
        G.words.push({ el, text: el.textContent, hx: r.left - AR.left + r.width / 2, hy: r.top - AR.top + r.height / 2, w: r.width, h: r.height, font: cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily, col: cs.color, st: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, t: 0, rest: false, taken: false, delay: 0, sx: 0, sy: 0, sr: 0, rt: undefined });
      }
    }
    G.knock = function (x, y, r, f) {
      let n = 0;
      for (const w of G.words) {
        if (w.st !== 0) continue;
        const dx = w.hx - x, dy = w.hy - y, d = Math.hypot(dx, dy), reach = r + w.w * 0.4; if (d > reach) continue;
        const k = 1 - d / reach, l = d || 1;
        w.st = 1; w.x = w.hx; w.y = w.hy; w.vx = (dx / l) * f * (0.5 + k) + rnd(-40, 40); w.vy = (dy / l) * f * (0.5 + k) - rnd(60, 170); w.rot = 0; w.vr = rnd(-5, 5); w.rest = false; w.taken = false; w.rt = undefined;
        w.el.style.visibility = "hidden"; G.rattled++; n++;
      }
      if (n) G.emit("wordsKnocked", { x, y, n });
      return n;
    };
    // An enemy can pick a word off the page (nearest to x, y that is still in place). The word
    // vanishes from the thread; the caller draws it however it likes (a bullet kind, a shield)
    // and hands it back with G.dropWord, or simply leaves it: every word flies home at the end.
    G.takeWord = function (x, y, maxDist) {
      let best = null, bd = (maxDist || 1e9) * (maxDist || 1e9);
      for (const w of G.words) { if (w.st !== 0) continue; const d = (w.hx - x) * (w.hx - x) + (w.hy - y) * (w.hy - y); if (d < bd) { bd = d; best = w; } }
      if (!best) return null;
      best.st = 1; best.rest = true; best.taken = true; best.x = best.hx; best.y = best.hy; best.el.style.visibility = "hidden"; G.rattled++;
      return { ref: best, text: best.text, x: best.hx, y: best.hy, w: best.w, h: best.h, font: best.font, col: best.col };
    };
    // Let a taken word go at (x, y) with a velocity: it becomes loose debris and joins the pile.
    G.dropWord = function (ref, x, y, vx, vy) {
      if (!ref || ref.st !== 1) return; ref.taken = false; ref.rest = false; ref.rt = undefined; ref.x = x; ref.y = y; ref.vx = vx || 0; ref.vy = vy || 0; ref.rot = 0; ref.vr = rnd(-5, 5);
    };
    // Make the words already lying on the composer hop, as when something heavy lands at x.
    G.jolt = function (x, f, reach) {
      const R = reach || 220; let n = 0;
      for (const w of G.words) {
        if (w.st !== 1 || !w.rest || w.taken) continue; const d = Math.abs(w.x - x); if (d > R) continue;
        const k = 1 - d / R; w.rest = false; w.rt = undefined; w.vy = -f * (0.4 + 0.6 * k) - rnd(0, 40); w.vx = (w.x < x ? -1 : 1) * rnd(10, 60) * k; w.vr = rnd(-4, 4); n++;
      }
      if (n) heap.fill(0); // they will pile up again where they land
      return n;
    };
    function returnWords() {
      let i = 0;
      for (const w of G.words) if (w.st === 1) { w.st = 2; w.t = 0; w.delay = (i++ % 50) * 0.012; w.sx = w.taken ? w.hx : w.x; w.sy = w.taken ? w.hy - 26 : w.y; const r = ((w.rot % TAU) + TAU) % TAU; w.sr = w.taken ? 0 : r > Math.PI ? r - TAU : r; w.taken = false; }
      G.emit("wordsHome", { n: i });
    }
    // An enemy peels off a marked term in the thread. make(x, y, born) creates it.
    G.fromTerm = function (kind, make) {
      const el = thread.querySelector('[data-foe="' + kind + '"]');
      if (!el || !el.getClientRects().length) { make(rnd(70, G.W - 70), -24, false); return; }
      el.classList.add("stir");
      const r0 = el.getBoundingClientRect(); G.emit("termStir", { kind, x: r0.left - AR.left + r0.width / 2, y: r0.top - AR.top + r0.height / 2 });
      G.later(0.8, () => {
        el.classList.remove("stir");
        const r = el.getBoundingClientRect(), x = clamp(r.left - AR.left + r.width / 2, 40, G.W - 40), y = r.top - AR.top + r.height / 2; let text = "";
        for (const w of G.words) if (w.st === 0 && el.contains(w.el)) { w.st = 1; w.rest = true; w.taken = true; w.el.style.visibility = "hidden"; text += w.text; }
        G.emit("termLift", { kind, x, y, text }); make(x, y, true);
      });
    };

    // ── things that happen ──
    G.cancelBullets = function (toSparks) {
      const list = G.bul; G.bul = []; let n = 0;
      for (const b of list) if (toSparks && n++ < 70) G.addPick("s", b.x, b.y, true);
      G.emit("cancel", { bullets: list, toSparks: !!toSparks });
    };
    // ang, where given, is the direction the shot that landed was travelling
    G.hurtFoe = function (e, d, x, y, ang) {
      if (e.born > 0 || e.dead) return; e.hp -= d; e.flash = 1; G.emit("foeHit", { e, d, x: x === undefined ? e.x : x, y: y === undefined ? e.y : y, ang });
      if (e.hp <= 0) G.kill(e, ang);
    };
    G.kill = function (e, ang) {
      if (e.dead) return; e.dead = 1; G.kills++; G.addChain();
      const pts = e.pts * G.mult; G.score += pts; G.knock(e.x, e.y, 36 + e.r * 1.5, 240);
      const def = G.kinds[e.k]; const n = (def && def.drops) || 2;
      for (let i = 0; i < n; i++) G.addPick("s", e.x + rnd(-e.r, e.r), e.y + rnd(-e.r, e.r) * 0.6, e.k === "wall");
      G.emit("kill", { e, pts, big: e.r > 20, ang });
      if (def && def.death) def.death(G, e);
    };
    // part is the enemy itself, or one piece of it (a worm segment) returned by its hit test
    G.damage = function (e, part, d, x, y, ang) {
      const def = G.kinds[e.k];
      if (part !== e && def && def.hitPart) def.hitPart(G, e, part, d, x, y, ang); else G.hurtFoe(e, d, x, y, ang);
    };
    // A hit is not final for a tenth of a second: a Eureka pressed in that window cancels it.
    G.hitPlayer = function () {
      if (P.inv > 0 || G.state !== "play" || hitT > 0) return;
      if (P.bombs > 0) { hitT = 0.1; P.inv = 0.1; G.emit("hitPending", { x: P.x, y: P.y }); } else landHit();
    };
    function landHit() {
      hitT = 0; if (G.state !== "play") return;
      P.hearts--; P.inv = 2.2; P.anim = "hit"; P.animT = 0; G.dropChain();
      if (P.power >= 4) { P.power = 3; P.pw = PW[2]; } // only the top level is lost: a learner who is hit often keeps his firepower
      if (G.T - lastHit < 20) G.mercy = Math.min(1, G.mercy + 0.34); lastHit = G.T; calmT = 0;
      const gone = []; G.bul = G.bul.filter((b) => { if (Math.hypot(b.x - P.x, b.y - P.y) < 150) { gone.push(b); return false; } return true; });
      G.emit("playerHit", { x: P.x, y: P.y, hearts: P.hearts, cleared: gone });
      if (P.hearts <= 0) { if (!secondWind()) G.finish(false); }
    }
    // Solve to get back up. Once per run, when the last heart goes, time stops and the page asks a
    // question from the lesson (three answers, one right). Right: he is back with two hearts and a
    // clear screen. Wrong, or out of time: the run ends as it would have. The question is built before
    // the run, from the pack: no model call happens while the game is waiting.
    function secondWind() {
      if (usedWind || !o.revive || G.quit) return false;
      const src = G.pack.revive?.length ? G.pack.revive : G.pack.myths.slice(1).map((m, i, all) => ({ q: "Which one is true?", a: [m.right, m.wrong, (all[(i + 1) % all.length] || G.pack.myths[0]).wrong] }));
      const pick = src[(Math.random() * src.length) | 0]; if (!pick) return false;
      usedWind = true; G.state = "down"; inp.keys = {}; inp.held = false;
      const order = [0, 1, 2].sort(() => Math.random() - 0.5), answers = order.map((j) => ({ t: pick.a[j], ok: j === 0 }));
      G.emit("downed", { q: pick.q, x: P.x, y: P.y });
      o.revive({ q: pick.q, answers, seconds: G.calm ? 0 : 15 }, (i) => {
        if (G.state !== "down") return; const a = answers[i], ok = !!(a && a.ok);
        G.res.wind = { q: pick.q, right: pick.a[0], picked: a ? a.t : null, ok }; G.state = "play"; lastTs = performance.now();
        if (ok) { P.hearts = 2; P.inv = 3; P.anim = "cheer"; P.animT = 0; G.cancelBullets(true); G.emit("revive", { x: P.x, y: P.y }); }
        else G.finish(false);
      });
      return true;
    }
    G.bomb = function () {
      if (G.state !== "play" || P.bombs <= 0 || bombT > 0) return;
      if (hitT > 0) { hitT = 0; G.emit("lastChance", { x: P.x, y: P.y }); } // pressed just in time: the hit never lands
      P.bombs--; bombT = 0.7; P.inv = Math.max(P.inv, 1.4); P.anim = o.rows.eureka === undefined ? P.anim : "eureka"; P.animT = 0;
      G.cancelBullets(true); G.ring = { x: P.x, y: P.y, r: 0 }; G.emit("bomb", { x: P.x, y: P.y });
      for (const e of G.foes.slice()) { if (e.born > 0 || e.dead) continue; const def = G.kinds[e.k]; if (def && def.bombed) def.bombed(G, e); else G.hurtFoe(e, 26); }
    };

    // ── gates: three answers to a question from the lesson ──
    G.startGates = function (i) {
      const q = G.pack.gates?.[i]; if (!q) return; // a short chat may have fewer questions: skip, never repeat one
      const order = [0, 1, 2].sort(() => Math.random() - 0.5);
      G.gates = { q: q.q, a: order.map((j) => ({ t: q.a[j], ok: j === 0 })), y: -30, st: 0, t: 0, pick: -1 };
      G.cancelBullets(true); if (o.ask) o.ask({ question: q.q, options: G.gates.a.map(a => a.t) }); G.emit("gateStart", { q: q.q });
    };
    function gatesUpdate(dt) {
      const Gt = G.gates; if (!Gt) return;
      if (Gt.st === 0) {
        Gt.y += 84 * dt;
        if (Gt.y >= P.y - 8 && G.state === "play") {
          const i = clamp(Math.floor(P.x / (G.W / 3)), 0, 2), a = Gt.a[i], right = Gt.a.find((q) => q.ok).t; Gt.st = 1; Gt.t = 0; Gt.pick = i;
          G.res.gates.push({ q: Gt.q, right, picked: a.t, ok: a.ok });
          if (a.ok) { const pts = 1000 * G.mult; G.score += pts; P.pw += 22; for (let k = 0; k < 14; k++) G.addPick("s", (i + 0.5) * (G.W / 3) + rnd(-60, 60), Gt.y, true); G.emit("gateResolve", { ok: true, x: P.x, y: Gt.y, right, picked: a.t, pts }); }
          else G.emit("gateResolve", { ok: false, x: P.x, y: Gt.y, right, picked: a.t, pts: 0 }); // a wrong answer costs nothing: the right one pays
        }
      } else { Gt.t += dt; Gt.y += 20 * dt; if (Gt.t > 1.25) { G.gates = null; if (o.ask) o.ask(null); } }
    }

    // ── player ──
    // He fires where he aims. With the pointer flying him, he aims by himself at the nearest
    // enemy (and stays on it). With the keys flying him, the pointer is the aim. On a touch
    // screen a second finger aims while it is down; lifting it hands aim back to him.
    // His own aim is a player's, not a turret's: it wanders a little on two slow waves and
    // overshoots when he swings to a new enemy. Both are smooth and bounded; nothing is rolled per frame.
    const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
    G.aimPoint = function (e) { const def = G.kinds[e.k]; return def && def.aimAt ? def.aimAt(G, e, P.x, P.y) : e; };
    function aimUpdate(dt) {
      let want = -Math.PI / 2, turn = 11;
      const ct = clamp(G.care.tune / 0.75, 0, 1);
      P.flick *= Math.exp(-dt * 4.5);
      P.manual = inp.aid !== null || (G.control === "twin" && !inp.touch);
      if (P.manual) { want = Math.atan2(inp.ay - P.y, inp.ax - P.x); P.lock = null; turn = 40; }
      else {
        let best = null, bd = 1e9;
        for (const e of G.foes) { if (e.born > 0 || e.dead) continue; const q = G.aimPoint(e), d = Math.hypot(q.x - P.x, q.y - P.y) * (e === P.lock ? 0.72 : 1); if (d < bd) { bd = d; best = e; } }
        if (best) {
          const q = G.aimPoint(best); want = Math.atan2(q.y - P.y, q.x - P.x);
          if (best !== P.lock) P.flick = clamp(angDiff(want, P.aim) * 0.25, -0.13, 0.13);
          const sway = lerp(0.085, 0.05, ct), t = G.T;
          want += sway * (0.62 * Math.sin(t * 0.83 + P.seed) + 0.38 * Math.sin(t * 2.17 + P.seed * 1.7)) + P.flick;
        }
        P.lock = best;
      }
      turn *= lerp(0.7, 1, ct);
      P.aim += clamp(angDiff(want, P.aim), -turn * dt, turn * dt);
    }
    function mkShot(x, y, a, d, hom) { const s = hom ? 520 : 980; return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, d, hom: !!hom, t: 0 }; }
    // Charge tiers. Full: the authored volley. Low: no side pair or homing, slower. Reserve: one shot, slower still. Empty: no fire.
    // Tuned so 0.75 lasts about 55 s of steady fire with no pickups (≈21 s full, 16 s low, 19 s reserve).
    const CHARGE = { cost: 0.002, low: 0.25, reserve: 0.1, cell: 0.12, cellBelow: 0.15, cellEvery: 7, spark: 0.004, card: 0.03 };
    G.chargeDelta = () => clamp(Math.round((G.energy - G.energy0) * 1000) / 1000, -1, 1);
    G.chargeTier = () => G.energy <= 0 ? 0 : G.energy < CHARGE.reserve ? 1 : G.energy < CHARGE.low ? 2 : 3;
    // Only pickups caught in play count: the outro's magnet sweep must not refund a run that was stopped.
    G.refill = function (amount) { if (G.state === "play") G.energy = clamp(G.energy + amount, 0, 1); };
    function drain(amount) {
      const was = G.chargeTier(); G.energy = Math.max(0, G.energy - amount); const now = G.chargeTier();
      if (now < was && now <= 2) G.emit(now === 0 ? "chargeEmpty" : "chargeLow", { energy: G.energy, tier: now });
    }
    // An emergency cell drifts down when he runs low: no kill needed, one at a time, on a fixed cadence.
    function cellUpdate(dt) {
      G.cellT = Math.max(0, G.cellT - dt);
      if (G.energy >= CHARGE.cellBelow || G.cellT > 0 || G.picks.some((p) => p.k === "e")) return;
      const x = clamp(P.x + (P.x < G.W / 2 ? 1 : -1) * rnd(70, 140), 40, G.W - 40);
      const cell = G.addPick("e", x, 34); cell.vx = 0; cell.vy = 20;
      G.cellT = CHARGE.cellEvery; G.emit("chargeCell", { x, y: 34 });
    }
    function volley() {
      const tier = G.chargeTier();
      if (tier === 0) return; // fireT keeps counting, so no muzzle flash or firing pose
      if (tier === 1) {
        const a = P.aim, x = P.x + Math.cos(a) * 30, y = P.y - 6 + Math.sin(a) * 30;
        G.shots.push(mkShot(x, y, a, P.focus ? 1.15 : 1)); drain(CHARGE.cost * 0.5);
        P.fireT = 0; G.emit("shot", { x, y, aim: a, power: 1, focus: P.focus }); return;
      }
      const full = tier === 3;
      const f = P.focus, d = (P.power >= 4 ? 1.3 : 1) * (f ? 1.15 : 1), sp = f ? 2.5 : 5, a = P.aim, cs = Math.cos(a), sn = Math.sin(a);
      const x = P.x + cs * 30, y = P.y - 6 + sn * 30, nx = -sn, ny = cs; // muzzle, and the normal to the aim
      G.shots.push(mkShot(x - nx * sp, y - ny * sp, a, d), mkShot(x + nx * sp, y + ny * sp, a, d));
      if (full && P.power >= 2) { const w = f ? 0.045 : 0.15; G.shots.push(mkShot(x - nx * (sp + 3), y - ny * (sp + 3), a - w, d * 0.8), mkShot(x + nx * (sp + 3), y + ny * (sp + 3), a + w, d * 0.8)); }
      if (full && P.power >= 3 && ++P.vol % (P.power >= 4 ? 3 : 4) === 0) G.shots.push(mkShot(P.x - nx * 18, P.y - ny * 18, a - 0.7, 1.6, true), mkShot(P.x + nx * 18, P.y + ny * 18, a + 0.7, 1.6, true));
      drain(CHARGE.cost * (full ? 1 : 0.6));
      P.fireT = 0; G.emit("shot", { x, y, aim: a, power: full ? P.power : 1, focus: f });
    }
    function player(dt) {
      const p = P, W = G.W, H = G.H, home = G.home; p.animT += dt; p.inv = Math.max(0, p.inv - dt); bombT = Math.max(0, bombT - dt);
      if (G.state === "intro") {
        const k = clamp((G.T - 0.38) / 0.8, 0, 1), e = 1 - Math.pow(1 - k, 3), nx = lerp(home.x, W / 2, e), ny = lerp(home.y, H * 0.7, e);
        p.vx = (nx - p.x) / Math.max(dt, 0.001); p.vy = (ny - p.y) / Math.max(dt, 0.001); p.x = nx; p.y = ny; p.tilt = clamp(p.vx / 900, -0.5, 0.5);
        p.scale = lerp(0.62, 1, e); inp.tx = p.x; inp.ty = p.y; p.thrust = G.T > 0.3 ? 1 : 0;
        if (G.T > 0.38 && !p.left) { p.left = true; G.knock(home.x, home.y - 30, 70, 280); G.emit("launch", { x: home.x, y: home.y }); }
        if (k >= 1) { G.state = "play"; p.vx = p.vy = 0; p.anim = "hover"; p.animT = 0; G.emit("play", {}); } return;
      }
      if (G.state === "outro") {
        const k = G.T - outT;
        if (k < 1) { p.vx *= Math.exp(-dt * 6); p.vy *= Math.exp(-dt * 6); p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(G.T * 5) * 0.2; p.ox = p.x; p.oy = p.y; p.tilt *= Math.exp(-dt * 6); p.thrust = 0.3; }
        else { const q = clamp((k - 1) / 0.8, 0, 1), e = q * q * (3 - 2 * q), nx = lerp(p.ox, home.x, e), ny = lerp(p.oy, home.y, e) - Math.sin(q * Math.PI) * 30; p.tilt = clamp((nx - p.x) / Math.max(dt, 0.001) / 900, -0.5, 0.5); p.x = nx; p.y = ny; p.scale = lerp(1, 0.62, e); p.thrust = q < 0.9 ? 0.4 : 0; if (q > 0.3 && o.rows.land !== undefined && p.anim !== "land") { p.anim = "land"; p.animT = 0; } }
        if (k > 0.55 && !returned) { returned = true; returnWords(); }
        if (k >= 1.95) done();
        return;
      }
      p.fireT += dt; aimUpdate(dt);
      const cc = clamp(G.care.charge / 0.75, 0, 1), ct = clamp(G.care.tune / 0.75, 0, 1); // 1 is top form
      const mv = (1 - clamp(p.mire || 0, 0, 0.6)) * lerp(0.8, 1, cc); p.mire = 0; // how freely he moves this frame; enemies set P.mire again every frame they hold him
      const K = inp.keys, kx = (K.ArrowRight || K.d ? 1 : 0) - (K.ArrowLeft || K.a ? 1 : 0), ky = (K.ArrowDown || K.s ? 1 : 0) - (K.ArrowUp || K.w ? 1 : 0);
      p.focus = !!K.Shift || (G.control !== "thrust" && inp.held);
      let thrust = 0.35, direct = false;
      if (G.control === "thrust") {
        const on = inp.held || inp.pid !== null || kx || ky;
        if (on) { let dx = kx, dy = ky; if (!kx && !ky) { dx = inp.tx - p.x; dy = inp.ty - p.y; } const l = Math.hypot(dx, dy) || 1, a = 1650 * (kx || ky ? 1 : Math.min(1, l / 36)); p.vx += (dx / l) * a * dt; p.vy += (dy / l) * a * dt; thrust = 1; }
        p.vy += 560 * dt; p.vx *= Math.exp(-dt * 1.7); p.vy *= Math.exp(-dt * 1.2);
      } else if (G.control === "twin" && (kx || ky || inp.pid === null)) {
        const sp = (p.focus ? 270 : 400) * mv, l = Math.hypot(kx, ky) || 1, q = 1 - Math.exp(-dt * 24);
        p.vx = lerp(p.vx, (kx / l) * sp, q); p.vy = lerp(p.vy, (ky / l) * sp, q); thrust = kx || ky ? 0.8 : 0.3;
      } else if (kx || ky) {
        inp.usingKeys = true; const sp = (p.focus ? 270 : 400) * mv, l = Math.hypot(kx, ky), q = 1 - Math.exp(-dt * 24);
        p.vx = lerp(p.vx, (kx / l) * sp, q); p.vy = lerp(p.vy, (ky / l) * sp, q); thrust = 0.8;
      } else if (inp.usingKeys) { const q = 1 - Math.exp(-dt * 24); p.vx = lerp(p.vx, 0, q); p.vy = lerp(p.vy, 0, q); }
      else {
        // The pointer flies him directly: no spring, so the hit dot is where the hand put it.
        // vx, vy are kept only so his lean and his jets still follow through.
        const dx = inp.tx - p.x, dy = inp.ty - p.y, d = Math.hypot(dx, dy), cap = (p.focus ? 340 : mv < 0.99 ? lerp(380, 900, cc) : 1700) * mv * dt, k = d > cap ? cap / d : 1, q = 1 - Math.exp(-dt * 20);
        p.x += dx * k; p.y += dy * k; direct = true;
        p.vx = lerp(p.vx, (dx * k) / Math.max(dt, 0.001), q); p.vy = lerp(p.vy, (dy * k) / Math.max(dt, 0.001), q);
        thrust = Math.min(1, Math.hypot(p.vx, p.vy) / 380) + 0.25;
      }
      if (!direct) { p.x += p.vx * dt; p.y += p.vy * dt; } p.thrust = thrust * lerp(0.45, 1, cc); // a flat battery burns a weak flame
      const bot = G.control === "thrust" ? G.floorY - 24 : H - 22;
      if (p.x < 16) { p.x = 16; p.vx = Math.max(0, p.vx); } if (p.x > W - 16) { p.x = W - 16; p.vx = Math.min(0, p.vx); }
      if (p.y < 26) { p.y = 26; p.vy = Math.max(0, p.vy); } if (p.y > bot) { p.y = bot; p.vy = G.control === "thrust" && p.vy > 60 ? -p.vy * 0.3 : Math.min(0, p.vy); }
      p.tilt = lerp(p.tilt, clamp(p.vx / 620, -0.48, 0.48), 1 - Math.exp(-dt * 12));
      if ((p.anim === "hit" && p.animT > 0.8) || (p.anim === "eureka" && p.animT > 0.85) || (p.anim === "cheer" && p.animT > 0.9)) { p.anim = "hover"; p.animT = 0; }
      cellUpdate(dt);
      p.shotT -= dt; if (p.shotT <= 0) { const tier = G.chargeTier(); p.shotT = 0.085 * lerp(1.2, 1, ct) * (tier === 3 ? 1 : tier === 2 ? 1.5 : tier === 1 ? 2.2 : 1); volley(); }
    }
    G.finish = function (w) {
      if (G.state !== "play") return;
      G.won = !!w; G.state = "outro"; outT = G.T; fx.slow = 1; fx.slowT = 0; returned = false; G.cancelBullets(G.won); G.gates = null; G.ring = null; if (o.ask) o.ask(null); G.timers = [];
      const left = G.foes.filter((e) => !e.dead); G.foes = []; G.boss = null;
      P.anim = G.won ? "cheer" : G.quit ? "hover" : "hit"; P.animT = 0; P.inv = 0; P.focus = false; for (const p of G.picks) p.mag = true;
      G.emit("finish", { won: G.won, quit: G.quit, left }); if (o.phase) o.phase("outro");
    };
    function done() {
      G.state = "idle"; cancelAnimationFrame(raf); raf = 0;
      for (const w of G.words) { w.el.style.visibility = ""; w.st = 0; }
      for (const el of thread.querySelectorAll(".stir")) el.classList.remove("stir");
      for (const x of [c, em]) { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, g.width, g.height); }
      post?.clear();
      v2.clearRect(0, 0, view.width, view.height);
      unbind();
      const r = { won: G.won, quit: G.quit, score: G.score, kills: G.kills, grazes: G.grazes, rattled: G.rattled, hearts: P.hearts, gates: G.res.gates, myths: G.res.myths, wind: G.res.wind || null, tldr: G.won ? G.pack.tldr : null,
        care: { used: 0.1, chargeDelta: G.chargeDelta(), cogs: G.res.gates.filter((q) => q.ok).length, sparks: Math.floor(G.sparks / 20) } }; // what the run took from him and gave back
      G.emit("end", { result: r }); o.end(r);
    }

    // ── update ──
    function hitTest(e, x, y, pad) {
      if (e.born > 0) return null; const def = G.kinds[e.k];
      if (def && def.hit) return def.hit(G, e, x, y, pad);
      return (x - e.x) * (x - e.x) + (y - e.y) * (y - e.y) < (e.r + pad) * (e.r + pad) ? e : null;
    }
    G.hitTest = hitTest;
    function update(dt) {
      const W = G.W, H = G.H;
      for (let i = G.timers.length - 1; i >= 0; i--) { const t = G.timers[i]; t.t -= dt; if (t.t <= 0) { G.timers.splice(i, 1); t.fn(); } }
      if (G.state === "play" && script) script.step(dt);
      if (hitT > 0) { hitT -= dt; if (hitT <= 0) landHit(); }
      calmT += dt; if (calmT > 30 && G.mercy > 0) { G.mercy = Math.max(0, G.mercy - 0.34); calmT = 20; }
      player(dt); if (G.state === "idle") return;
      const playing = G.state === "play";
      if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.dropChain(); }
      pickT -= dt; if (pickT <= 0) pickN = 0;
      // enemies
      for (const e of G.foes) {
        e.t += dt; e.actT += dt; e.flash = Math.max(0, e.flash - dt * 7);
        if (e.born > 0) { e.born -= dt; continue; }
        const def = G.kinds[e.k]; if (def && def.update) def.update(G, e, dt);
        if (playing && !e.dead && P.inv <= 0 && hitTest(e, P.x, P.y, def && def.body !== undefined ? def.body : -3)) G.hitPlayer();
      }
      if (G.foes.some((e) => e.dead)) G.foes = G.foes.filter((e) => !e.dead);
      gatesUpdate(dt);
      // his shots
      for (const s of G.shots) {
        s.t += dt;
        if (s.hom) {
          let best = null, bd = 1e9; for (const e of G.foes) { if (e.born > 0) continue; const d = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y); if (d < bd) { bd = d; best = e; } }
          if (best) { const want = Math.atan2(best.y - s.y, best.x - s.x), cur = Math.atan2(s.vy, s.vx); let da = want - cur; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; const na = cur + clamp(da, -7.5 * dt, 7.5 * dt); s.vx = Math.cos(na) * 560; s.vy = Math.sin(na) * 560; }
        }
        s.x += s.vx * dt; s.y += s.vy * dt;
        if (s.y < -20 || s.x < -20 || s.x > W + 20 || s.y > H + 20 || s.t > 2.2) { s.dead = true; continue; }
        for (const e of G.foes) { const h = hitTest(e, s.x, s.y, 5); if (h) { G.damage(e, h, s.d, s.x, s.y, Math.atan2(s.vy, s.vx)); s.dead = true; break; } }
      }
      if (G.shots.length) G.shots = G.shots.filter((s) => !s.dead);
      // their bullets
      const px = P.x, py = P.y; let hit = false;
      for (const b of G.bul) {
        b.t += dt; const def = G.bullets[b.k]; if (def && def.move) def.move(G, b, dt); else { b.x += b.vx * dt; b.y += b.vy * dt; }
        if (b.x < -40 || b.x > W + 40 || b.y < -50 || b.y > H + 40) { if (!b.keep) b.dead = true; continue; }
        if (!playing || b.safe) continue;
        const dx = b.x - px, dy = b.y - py, d2 = dx * dx + dy * dy, hr = b.r * 0.62 + 3;
        if (def && def.hits ? def.hits(G, b, px, py) : d2 < hr * hr) { if (P.inv <= 0) { hit = true; if (!b.pierce) b.dead = true; } }
        else if (!b.gz && d2 < 26 * 26 && P.inv <= 0) {
          b.gz = true; G.grazes++; G.meter++; G.score += 25 * G.mult; G.emit("graze", { x: (b.x + px) / 2, y: (b.y + py) / 2, b });
          if (G.meter >= 36) { G.meter = 0; if (P.bombs < 3) { P.bombs++; G.emit("charge", { x: px, y: py, bombs: P.bombs }); } }
        }
      }
      if (hit) G.hitPlayer();
      if (G.bul.some((b) => b.dead)) G.bul = G.bul.filter((b) => !b.dead);
      // pickups
      for (const p of G.picks) {
        p.t += dt; const dx = px - p.x, dy = py - p.y, d = Math.hypot(dx, dy) || 1;
        if (p.mag || d < (p.k === "e" ? 150 : 96) || !playing) { const s = 380 + p.t * 900; p.vx = lerp(p.vx, (dx / d) * s, 1 - Math.exp(-dt * 10)); p.vy = lerp(p.vy, (dy / d) * s, 1 - Math.exp(-dt * 10)); }
        else if (p.k === "e") { p.vy = Math.min(30, p.vy + 40 * dt); p.vx = Math.sin(p.t * 1.6) * 18; }
        else { p.vy = Math.min(72, p.vy + 190 * dt); p.vx *= Math.exp(-dt * 2); }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (d < 17) {
          p.dead = true;
          if (p.k === "s") { G.score += 10 * G.mult; P.pw++; G.sparks++; G.refill(CHARGE.spark); pickN++; pickT = 0.5; G.emit("pickup", { p, streak: pickN }); while (P.power < 4 && P.pw >= PW[P.power]) { P.power++; G.emit("powerUp", { power: P.power, x: px, y: py }); } }
          else if (p.k === "c") { if (P.bombs < 3) P.bombs++; G.refill(CHARGE.card); G.emit("pickup", { p, streak: 0 }); }
          else if (p.k === "e") { G.refill(CHARGE.cell); G.cellT = CHARGE.cellEvery; G.emit("pickup", { p, streak: 0, amount: CHARGE.cell }); }
          else { if (P.hearts < 4) P.hearts++; G.refill(CHARGE.card); G.emit("pickup", { p, streak: 0 }); }
        } else if (p.y > H + 20) p.dead = true;
      }
      if (G.picks.some((p) => p.dead)) G.picks = G.picks.filter((p) => !p.dead);
      // the Eureka ring shakes the lesson as it passes
      if (G.ring) { G.ring.r += 620 * dt; G.knock(G.ring.x, G.ring.y, G.ring.r, 320); if (G.ring.r > 250) G.ring = null; }
      if (G.tldr) G.tldr.t += dt;
      // loose words pile up in rows on the composer, then fly home
      for (const w of G.words) {
        if (w.st === 1 && !w.rest) {
          w.vy += 640 * dt; w.x += w.vx * dt; w.y += w.vy * dt; w.rot += w.vr * dt;
          if (w.x < w.w / 2) { w.x = w.w / 2; w.vx = Math.abs(w.vx) * 0.5; } if (w.x > W - w.w / 2) { w.x = W - w.w / 2; w.vx = -Math.abs(w.vx) * 0.5; }
          const b0 = clamp(Math.floor((w.x - w.w * 0.4) / 22), 0, heap.length - 1), b1 = clamp(Math.floor((w.x + w.w * 0.4) / 22), 0, heap.length - 1); let top = 0; for (let i = b0; i <= b1; i++) top = Math.max(top, heap[i]);
          const fl = G.floorY - w.h * 0.3 - top;
          if (w.y > fl) { w.y = fl; if (w.vy > 90) { w.vy *= -0.32; w.vx *= 0.6; w.vr *= 0.5; } else { w.rest = true; w.rt = Math.round(w.rot / TAU) * TAU + rnd(-0.16, 0.16); const h = Math.min(58, top + w.h * 0.6); for (let i = b0; i <= b1; i++) heap[i] = h; } }
        } else if (w.st === 1 && !w.taken && w.rt !== undefined) { w.rot += (w.rt - w.rot) * (1 - Math.exp(-dt * 9)); }
        else if (w.st === 2) {
          w.t += dt; const k = clamp((w.t - w.delay) / 0.55, 0, 1), e = 1 - Math.pow(1 - k, 3);
          if (k > 0) { w.x = lerp(w.sx, w.hx, e); w.y = lerp(w.sy, w.hy, e) - Math.sin(k * Math.PI) * 16; w.rot = w.sr * (1 - e); }
          if (k >= 1) { w.st = 0; w.el.style.visibility = ""; }
        }
      }
      run("update", dt);
    }

    // ── draw: two layers. c is the picture; em holds only what should glow. ──
    function rr(x, c2, y, w, h, r) { c2.beginPath(); c2.moveTo(x + r, y); c2.lineTo(x + w - r, y); c2.quadraticCurveTo(x + w, y, x + w, y + r); c2.lineTo(x + w, y + h - r); c2.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c2.lineTo(x + r, y + h); c2.quadraticCurveTo(x, y + h, x, y + h - r); c2.lineTo(x, y + r); c2.quadraticCurveTo(x, y, x + r, y); c2.closePath(); }
    function draw() {
      const W = G.W, H = G.H, pal = G.pal, dpr = G.dpr;
      // shake: two sines at unrelated rates, so the screen moves smoothly instead of jumping to a new
      // random place each frame. kx, ky: a kick away from a blow, written by the feedback module.
      const wob = (a, b) => (Math.sin(G.RT * a) + Math.sin(G.RT * b + 1.7)) * 0.5, on = fx.shake > 0.2 && !G.calm;
      const sx = (on ? wob(71, 113) * fx.shake * 0.6 : 0) + (G.calm ? 0 : fx.kx || 0), sy = (on ? wob(83, 127) * fx.shake * 0.6 : 0) + (G.calm ? 0 : fx.ky || 0);
      for (const x of [c, em]) { x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H); x.translate(sx, sy); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; }
      const env = { pal, T: G.T, lx: P.x, ly: P.y, dark: G.dark, toy: G.toy, G };
      // loose words
      c.textAlign = "center"; c.textBaseline = "middle";
      for (const w of G.words) {
        if (w.st === 0 || (w.st === 1 && w.taken)) continue;
        c.save(); c.translate(w.x, w.y); c.rotate(w.rot); c.globalAlpha = w.st === 2 ? 0.9 : 0.42; c.font = w.font; c.fillStyle = w.col; c.fillText(w.text, 0, 0); c.restore(); // loose words sit at a midtone so they never compete with a bullet
      }
      // gates
      if (G.gates) {
        const Gt = G.gates, sw = W / 3;
        for (let i = 0; i < 3; i++) {
          const a = Gt.a[i], x0 = i * sw, cx = x0 + sw / 2; let col = pal.ink, fill = pal.card;
          if (Gt.st === 1) { if (a.ok) { col = pal.deep; fill = pal.wash; } else if (i === Gt.pick) { col = pal.red; fill = pal.blush; } else c.globalAlpha = 0.3; }
          c.strokeStyle = col; c.lineWidth = 2; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(x0 + 10, Gt.y); c.lineTo(x0 + sw - 10, Gt.y); c.stroke(); c.setLineDash([]);
          c.font = "700 13px " + MONO; const tw = Math.min(sw - 22, c.measureText(a.t).width + 24);
          rr(cx - tw / 2, c, Gt.y - 14, tw, 28, 5); c.fillStyle = fill; c.fill(); c.stroke();
          c.fillStyle = col; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(a.t, cx, Gt.y + 0.5, tw - 12); c.globalAlpha = 1;
        }
        c.fillStyle = pal.ink; for (let i = 0; i <= 3; i++) { const x = clamp(i * sw, 5, W - 5); c.beginPath(); c.moveTo(x, Gt.y - 6); c.lineTo(x + 6, Gt.y); c.lineTo(x, Gt.y + 6); c.lineTo(x - 6, Gt.y); c.closePath(); c.fill(); }
      }
      run("draw.back", env);
      for (const p of G.picks) A.drawPickup(c, p, env);
      for (const e of G.foes) A.drawFoe(c, e, env);
      // his shots, on both layers
      if (G.shots.length) for (const x of [c, em]) {
        x.lineCap = "round";
        for (const pass of [0, 1]) {
          x.beginPath();
          for (const s of G.shots) { if (s.hom) continue; x.moveTo(s.x, s.y); x.lineTo(s.x - s.vx * 0.017, s.y - s.vy * 0.017); }
          x.strokeStyle = pass ? (G.dark ? "#eafff1" : pal.phos) : G.dark ? pal.phos : pal.deep; x.lineWidth = pass ? 1.3 : 3.6; x.stroke();
        }
        x.strokeStyle = G.dark ? pal.phos : pal.deep; x.lineWidth = 2.4; x.lineJoin = "miter"; x.beginPath();
        for (const s of G.shots) { if (!s.hom) continue; const a = Math.atan2(s.vy, s.vx) + Math.PI / 2, cs = Math.cos(a), sn = Math.sin(a), q = (u, v) => [s.x + u * cs - v * sn, s.y + u * sn + v * cs]; const p1 = q(-5, 0), p2 = q(-1.5, 4), p3 = q(5.5, -5); x.moveTo(p1[0], p1[1]); x.lineTo(p2[0], p2[1]); x.lineTo(p3[0], p3[1]); }
        x.stroke();
      }
      run("draw.flames", env);
      A.drawPlayer(c, env);
      // their bullets, always above everything that moves
      const byKind = {}; for (const b of G.bul) (byKind[b.k] = byKind[b.k] || []).push(b);
      for (const k in byKind) { const def = G.bullets[k] || G.bullets[0]; def.draw(c, byKind[k], env); if (def.glow !== false) def.draw(em, byKind[k], env, true); }
      run("draw.over", env);
      c.globalAlpha = 1; em.globalAlpha = 1;
    }
    function present() {
      const useShader = post && !post.lost && !G.calm;
      if (shader) shader.hidden = !useShader;
      view.hidden = Boolean(useShader);
      if (useShader) post.draw(g, ge, G);
      else { v2.setTransform(1, 0, 0, 1, 0, 0); v2.clearRect(0, 0, view.width, view.height); v2.drawImage(g, 0, 0); }
    }
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      const rdt = Math.min(0.034, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts; if (document.hidden) return;
      step(rdt);
    }
    function step(rdt) {
      G.RT += rdt; fx.shake = G.calm ? 0 : Math.max(0, fx.shake - rdt * 40); fx.flash = Math.max(0, fx.flash - rdt * 3.2); fx.hit = Math.max(0, fx.hit - rdt * 1.6);
      fx.on = clamp(fx.on + (G.state === "outro" && G.T - outT > 1.1 ? -rdt * 1.6 : rdt * 2.2), 0, 1);
      fx.focus += ((P.focus && G.state === "play" ? 1 : 0) - fx.focus) * (1 - Math.exp(-rdt * 12));
      for (const s of fx.shocks) s.t += rdt; while (fx.shocks.length && fx.shocks[0].t > 1.3) fx.shocks.shift();
      let dt = G.state === "down" ? 0 : rdt; if (fx.stop > 0) { fx.stop -= rdt; if (!G.calm) dt = 0; } if (fx.slowT > 0) { fx.slowT -= rdt; if (fx.slowT <= 0) fx.slow = 1; } dt *= fx.slow;
      run("frame", rdt);
      if (dt > 0) { G.T += dt; update(dt); }
      if (G.state === "idle") return;
      draw(); present();
      o.hud({ hearts: P.hearts, bombs: P.bombs, score: G.score, mult: G.mult, combo: clamp(G.comboT / 2.8, 0, 1), power: P.power, charge: G.energy, meter: G.meter / 36, label: G.label, boss: G.boss ? Math.max(0, G.boss.hp) / G.boss.max : -1 });
    }

    // ── input ──
    const pt = (e) => {
      const rect = arena.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const captured = new Set();
    const capture = (e) => { if (e.isTrusted) { arena.setPointerCapture(e.pointerId); captured.add(e.pointerId); } };
    // Touch: the first finger flies him (relative, like a trackpad), the second aims where it
    // rests. A third is ignored. Either finger can lift without disturbing the other.
    function down(e) {
      if (G.state !== "play" && G.state !== "intro") return;
      arena.focus({ preventScroll: true });
      G.snd.unlock();
      if (e.button === 2) { G.bomb(); e.preventDefault(); return; }
      const p = pt(e);
      if (e.pointerType === "touch") {
        inp.touch = true;
        if (e.pointerId === inp.pid || e.pointerId === inp.aid) { e.preventDefault(); return; }
        if (inp.pid === null) {
          inp.pid = e.pointerId; inp.lx = p.x; inp.ly = p.y;
          if (G.control === "thrust") { inp.tx = p.x; inp.ty = p.y; }
          else if (G.control === "twin" || inp.usingKeys) { inp.tx = P.x; inp.ty = P.y; }
        } else if (inp.aid === null) {
          inp.aid = e.pointerId; inp.ax = p.x; inp.ay = p.y;
        } else { e.preventDefault(); return; }
      } else {
        inp.touch = false;
        inp.ax = p.x; inp.ay = p.y;
        if (G.control !== "twin") { inp.tx = p.x; inp.ty = p.y; }
        inp.held = true;
      }
      capture(e);
      inp.usingKeys = false;
      e.preventDefault();
    }
    function move(e) {
      if (G.state !== "play") return;
      const p = pt(e);
      if (e.pointerType === "touch") {
        if (e.pointerId === inp.aid) { inp.ax = p.x; inp.ay = p.y; return; }
        if (e.pointerId !== inp.pid) return;
        if (G.control === "thrust") { inp.tx = p.x; inp.ty = p.y; }
        else {
          inp.tx = clamp(inp.tx + (p.x - inp.lx) * 1.3, 16, G.W - 16);
          inp.ty = clamp(inp.ty + (p.y - inp.ly) * 1.3, 26, G.H - 22);
        }
        inp.lx = p.x; inp.ly = p.y;
      } else {
        inp.touch = false;
        inp.ax = p.x; inp.ay = p.y;
        if (G.control !== "twin") { inp.tx = p.x; inp.ty = p.y; }
      }
      inp.usingKeys = false;
    }
    function up(e) {
      captured.delete(e.pointerId);
      if (e.pointerType !== "touch") inp.held = false;
      else if (e.pointerId === inp.pid) inp.pid = null;
      else if (e.pointerId === inp.aid) inp.aid = null;
    }
    function release() {
      for (const id of captured) if (arena.hasPointerCapture?.(id)) arena.releasePointerCapture(id);
      captured.clear();
      inp.pid = null; inp.aid = null;
    }
    function stop() {
      if (G.state !== "play" && G.state !== "intro" && G.state !== "down") return;
      G.state = "play"; G.quit = true; o.revive?.(null); G.finish(false);
    }
    function key(e) {
      if (e.target !== arena || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const dn = e.type === "keydown", k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (dn && k === "Escape" && G.state !== "idle") { e.preventDefault(); stop(); return; }
      if (G.state !== "play" && G.state !== "intro") return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "w", "a", "s", "d", "Shift", "x"].includes(k)) return;
      if (k !== "Shift") e.preventDefault(); inp.keys[k] = dn;
      if (dn && (k === " " || k === "x") && !e.repeat) G.bomb();
    }
    const menu = (e) => e.preventDefault();
    // Losing arena focus (a tap on the Eureka key) keeps fingers that are still down; losing the window drops them.
    const blur = () => { inp.keys = {}; inp.held = false; };
    const leave = () => { blur(); release(); };
    const bindings = [
      [arena, "pointerdown", down], [arena, "pointermove", move], [arena, "pointerup", up],
      [arena, "pointercancel", up], [arena, "lostpointercapture", up], [arena, "keydown", key],
      [arena, "keyup", key], [arena, "contextmenu", menu], [arena, "blur", blur], [window, "blur", leave],
    ];
    const bind = () => { for (const [target, event, fn] of bindings) target.addEventListener(event, fn); };
    const unbind = () => {
      for (const [target, event, fn] of bindings) target.removeEventListener(event, fn);
      release();
    };

    function start(scene) {
      if (disposed || G.state !== "idle") return false;
      size(); G.pal = PAL[G.theme]; G.dark = G.theme === "term"; collect(); heap = new Float32Array(Math.ceil(G.W / 22) + 1);
      G.foes = []; G.shots = []; G.bul = []; G.picks = []; G.timers = []; fx.shocks = []; G.gates = null; G.boss = null; G.ring = null; G.tldr = null;
      G.score = 0; G.mult = 1; G.chain = 0; G.comboT = 0; G.kills = 0; G.grazes = 0; G.meter = 0; G.rattled = 0; G.won = false; G.quit = false; returned = false; G.res = { gates: [], myths: [] };
      G.energy = G.energy0 = G.care.charge; G.cellT = 0;
      hitT = 0; lastHit = -99; calmT = 0; usedWind = false; G.mercy = 0; G.sparks = 0; G.T = 0; fx.slow = 1; fx.slowT = 0; fx.stop = 0; fx.shake = 0; fx.kx = 0; fx.ky = 0; fx.flash = 0; fx.hit = 0; fx.on = 0; fx.speed = 0.3; G.label = "";
      Object.assign(P, { scale: 0.62, x: G.home.x, y: G.home.y, vx: 0, vy: 0, tilt: 0, inv: 0, hearts: 4, bombs: G.care.shine >= 0.9 ? 3 : 2, power: scene === "boss" ? 3 : scene === "myth" ? 2 : 1, shotT: 0.5, vol: 0, anim: o.rows.launch === undefined ? "hover" : "launch", animT: 0, focus: false, left: false, thrust: 0, aim: -Math.PI / 2, lock: null, fireT: 9, mire: 0, manual: false, flick: 0, seed: Math.random() * TAU });
      P.pw = PW[P.power - 1]; inp.keys = {}; inp.held = false; inp.pid = null; inp.aid = null; inp.touch = false; inp.usingKeys = false; inp.tx = G.W / 2; inp.ty = G.H * 0.7; inp.ax = G.W / 2; inp.ay = 0;
      G.state = "intro";
      G.emit("start", { scene }); script = RecessPatterns.script(G, scene);
      bind(); lastTs = performance.now(); raf = requestAnimationFrame(frame); if (o.phase) o.phase("play");
      return true;
    }
    // A pack compiled by the AI director may give its boss lines (pack.boss.taunts). They are jokes on the boss.
    const taunt = (e, text) => { if (text && G.J) G.J.pop(e.x, e.y + (e.h || 60) / 2 + 30, "“" + text + "”", G.pal.ink, 12, 2.6); };
    let lowSaid = false;
    G.on("start", () => { lowSaid = false; });
    G.on("bossSpawn", (d) => G.later(1.2, () => { const t = G.pack.boss && G.pack.boss.taunts; if (t && G.boss === d.e) taunt(d.e, t.intro); }));
    G.on("bossPhase", (d) => { const t = G.pack.boss && G.pack.boss.taunts; if (t && !d.first && t.phase) G.later(0.9, () => { if (G.boss === d.e) taunt(d.e, t.phase[(d.stage - 1) % t.phase.length]); }); });
    G.on("foeHit", (d) => { const t = G.pack.boss && G.pack.boss.taunts; if (t && !lowSaid && d.e === G.boss && d.e.hp < d.e.max * 0.2) { lowSaid = true; taunt(d.e, t.low); } });
    G.on("bossDeath", (d) => { const t = G.pack.boss && G.pack.boss.taunts; if (t) taunt(d.e, t.defeat); });
    // The installation order matches the authored game. Each module is scoped to this run.
    for (const install of [A.install, installAudio, installFeedback, installBullets, installPatterns]) install(G);
    return {
      start, stop, bomb: G.bomb,
      get state() { return G.state; },
      /** Remaining firing charge minus the charge this run started with, in [-1, 1]. */
      get chargeDelta() { return G.chargeDelta(); },
      setCalm(value) { G.calm = Boolean(value); },
      setCondition(condition) {
        G.care = {
          charge: clamp(condition.charge, 0, 1),
          tune: clamp(condition.tune, 0, 1),
          shine: clamp(condition.shine, 0, 1),
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        G.state = "idle";
        cancelAnimationFrame(raf);
        G.timers.length = 0;
        unbind();
        for (const w of G.words) w.el.style.visibility = "";
        for (const el of thread.querySelectorAll(".stir")) el.classList.remove("stir");
        post?.dispose();
        G.snd.dispose();
      },
    };
  }
  return { create };
})();
