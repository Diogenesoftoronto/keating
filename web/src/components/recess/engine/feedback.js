import { RecessArt } from "./foes.js";
import { HELPER_LABELS } from "./arsenal.js";
// Recess feedback (feedback lane): particles, pops, shockwaves, shake, hit-stop, slow motion, flames.
// Core says what happened; this decides how it feels, scaled by how much it mattered. Debris draws
// under every bullet; only brief marks draw over. G.calm drops shake, hit-stop, most particles.
// Colour by meaning: red and amber are the enemy's; green is his (shots, jets, pickups, pops); debris is ink.
export function install(G) {
    const { rnd, clamp, TAU } = G, fx = G.fx, P = G.P, MONO = RecessArt.MONO, SERIF = RecessArt.SERIF;
    // pooled particles; L = layer: 0 page (under enemies), 1 debris (under bot and bullets), 2 brief marks on top
    const parts = [], free = [], pops = [], jits = [], LAYER = { stain: 0, spark: 2, ring: 2, flash: 2, arc: 2, tele: 2, sparkle: 2, eureka: 2 };
    const N = (n) => (G.calm ? Math.ceil(n * 0.3) : n), DEB = () => (G.dark ? G.pal.soft : G.pal.ink), GRN = () => G.pal.deep;
    let trauma = 0, lastStop = -9, meterShow = 0, collect = 0, trailT = 0, pend = -1, tint = null, tintSrc = null;
    const kick = { x: 0, y: 0, vx: 0, vy: 0 }, homing = [], conf = [], fly = [];
    let bm = "", eat = 0, rush = 0, tPop = null, downT = -1;

    // ── service ──
    function part(k, x, y, vx, vy, life, size, col, extra) {
      if (parts.length >= 900) return null;
      const p = free.pop() || {};
      p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.size = size; p.col = col;
      p.L = k in LAYER ? LAYER[k] : 1; p.rot = 0; p.vr = 0; p.grow = 0; p.wait = 0; p.rest = false; p.row = ""; p.ch = ""; p.a = 0; p.pts = null; p.flut = undefined; p.e = null; p.ring = 0;
      if (extra) Object.assign(p, extra);
      parts.push(p); return p;
    }
    // "+pts" pops close together within a beat merge into one growing number
    function pop(x, y, text, col, size, life, big, num) {
      x = clamp(x, 40, G.W - 40);
      if (num) for (const p of pops) if (p.num && p.t < 0.35 && Math.abs(p.x - x) < 46 && Math.abs(p.y - y) < 40) { p.num += num; p.text = "+" + p.num; p.size = Math.min(19, p.size + 1.2); p.t = Math.min(p.t, 0.06); p.bump = 1; return p; }
      const p = { x, y, text, col: col || GRN(), size: size || 11, t: 0, life: life || 0.8, big: !!big, num: num || 0, bump: 0 };
      pops.push(p); return p;
    }
    function shock(x, y, s) { if (fx.shocks.length >= 4) fx.shocks.shift(); fx.shocks.push({ x, y, t: 0, s }); }
    function ring(x, y, life, size, grow, col, L) { return part("ring", x, y, 0, 0, life, size, col || DEB(), { grow, L: L || 2 }); }
    function burst(x, y, r, col) {
      const n = N(8 + Math.round(r * 0.4)); col = col || DEB();
      for (let i = 0; i < n; i++) { const a = rnd(TAU), s = rnd(60, 260); part("ink", x, y, Math.cos(a) * s, Math.sin(a) * s - 40, rnd(0.35, 0.8), rnd(1.5, 4.2), col); }
      for (let i = 0; i < N(6); i++) { const a = rnd(TAU), s = rnd(180, 420); part("spark", x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.12, 0.26), rnd(6, 12), col); }
      ring(x, y, 0.32, r * 1.1, r * 3, col);
    }
    // letters are debris: they tumble, land on the composer, lie there a moment
    function chars(x, y, text, n, col) {
      const t = String(text || "").replace(/\s/g, ""); if (!t) return; n = N(n);
      for (let i = 0; i < n; i++) { const a = rnd(TAU), s = rnd(80, 300); part("char", x + rnd(-8, 8), y + rnd(-5, 5), Math.cos(a) * s, Math.sin(a) * s - 120, rnd(1.6, 2.6), rnd(10, 14), col || DEB(), { ch: t[(i * 3 + (rnd(9) | 0)) % t.length], rot: rnd(TAU), vr: rnd(-9, 9) }); }
    }
    // shake is trauma (Eiserloh): adds sum in amplitude, capped; it drains linearly and the screen moves
    // by trauma², so a big hit is violent briefly with no long tail. dx, dy also kick the screen away.
    function shake(n, dx, dy) {
      if (G.calm || !(n > 0)) return;
      trauma = Math.min(1, Math.sqrt(trauma * trauma + n / 22));
      if (dx !== undefined) { const l = Math.hypot(dx, dy) || 1, f = Math.min(n, 12) * 26; kick.vx += (dx / l) * f; kick.vy += (dy / l) * f; }
    }
    // hit-stop holds the frame of contact; minor stops skip if one just happened (no stutter).
    // Capped at 140 ms (longer reads as a dropped frame) unless the caller means it (the boss stop).
    function stop(s, minor, cap) { if (G.calm || (minor && G.RT - lastStop < 0.22)) return; lastStop = G.RT; fx.stop = Math.max(fx.stop, Math.min(cap || 0.14, s)); }
    // slow motion always goes through here so the sound lane hears it
    function slow(scale, seconds) { fx.slow = scale; fx.slowT = seconds; G.emit("slow", { scale, seconds }); }
    // the struck tremble (Sakurai): enemies near a blow jitter in their drawing while the frame is held
    function jitter(x, y, R, n) { if (G.calm) return; for (const e of G.foes) if (!e.dead && Math.hypot(e.x - x, e.y - y) < R + (e.r || 0)) { if (!(e.jit > 0)) jits.push(e); e.jit = Math.max(e.jit || 0, n); } }
    function flip(row, x, y, size, life, extra) { const f = G.o.flip; if (!f || !f.img || !f.img.complete || f.rows[row] === undefined) return null; return part(row === "sparkle" || row === "eureka" ? row : "fb", x, y, 0, 0, life, size, "", Object.assign({ row }, extra)); }
    function sparkles(x, y, n, sx, sy, size, life, step) { for (let i = 0; i < N(n); i++) flip("sparkle", x + rnd(-sx, sx), y + rnd(-sy, sy), size * rnd(0.7, 1.2), life, { wait: i * step }); }
    // dust: n faint rings of eraser crumbs in a box (rx, ry) around x, y, drifting at vx, vy (± sx, sy)
    function dust(n, x, y, rx, ry, vx, vy, sx, sy, z) { z = z || 3; for (let i = 0; i < N(n); i++) part("puff", x + rnd(-rx, rx), y + rnd(-ry, ry), vx + rnd(-sx, sx), vy + rnd(-sy, sy), rnd(0.4, 0.8), rnd(z, z * 2), G.pal.faint); }
    // confetti flutters down from the top; kept in conf so a fake ending can take it back
    function confetti(n, cols) { for (let i = 0; i < N(n); i++) { const p = part("chunk", rnd(G.W), rnd(-40, -5), rnd(-60, 60), rnd(40, 160), rnd(1.6, 2.6), rnd(3, 5), cols[i % cols.length], { rot: rnd(TAU), vr: rnd(-8, 8), flut: rnd(TAU), wait: rnd(0.3) }); if (p) conf.push(p); } }
    // a heavy blow at x, y: shockwave, shake (kicked along dx, dy), an optional held frame, the struck tremble
    function thud(x, y, s, n, dx, dy, st) { shock(x, y, s); shake(n, dx, dy); if (st) stop(st); jitter(x, y, 10, 3); }
    // a ring of green sparkles round him, lit one after another
    function halo(x, y, n, r, z, life) { for (let i = 0; i < N(n); i++) { const a = (i / n) * TAU; flip("sparkle", x + Math.cos(a) * r, y + Math.sin(a) * r, z, life, { wait: i * 0.015 }); } }
    G.J = { part, pop, shock, burst, chars, shake, stop, flip, slow };

    // The flipbooks were painted amber and red; recolour them once by meaning: sparkle and eureka rows
    // become his green ("color" blend keeps their shading), the pop row's chunks go grey like any debris.
    function sheet(f) {
      if (tintSrc === f.img) return tint;
      tintSrc = f.img; tint = document.createElement("canvas"); tint.width = f.img.width; tint.height = f.img.height;
      const x = tint.getContext("2d"); x.drawImage(f.img, 0, 0);
      for (const [row, col, op] of [["pop", "#888", "saturation"], ["sparkle", "#1e9b50", "color"], ["eureka", "#1e9b50", "color"]]) if (f.rows[row] !== undefined) { x.globalCompositeOperation = op; x.fillStyle = col; x.fillRect(0, f.rows[row] * f.cell, tint.width, f.cell); }
      x.globalCompositeOperation = "destination-in"; x.drawImage(f.img, 0, 0);
      return tint;
    }

    // toys pop into chunks; ink splats and stains the page
    function death(x, y, r, w) {
      const pal = G.pal, ink = DEB();
      part("flash", x, y, 0, 0, 0.05, Math.max(7, r * 0.6), pal.core); // impact frame: one bright disc
      if (G.toy) {
        flip("pop", x, y, r * 3.4, 0.42, { rot: rnd(TAU) });
        const cols = G.dark ? [pal.soft, pal.faint, pal.ink] : [pal.card, pal.soft, pal.ink];
        for (let i = 0; i < N(2 + Math.round(w * 2)); i++) { const a = rnd(TAU), s = rnd(90, 260); part("chunk", x, y, Math.cos(a) * s, Math.sin(a) * s - 150, rnd(0.55, 0.9), rnd(2.5, 4.5) * Math.min(1.4, w), cols[i % 3], { rot: rnd(TAU), vr: rnd(-12, 12) }); }
      } else {
        if (!G.dark) flip("ink", x, y, r * 2.8, 0.4, { rot: rnd(TAU) });
        for (let i = 0; i < N(6 + w * 4); i++) { const a = rnd(TAU), s = rnd(70, 240); part("ink", x, y, Math.cos(a) * s, Math.sin(a) * s - 60, rnd(0.4, 0.8), rnd(1.6, 3.8), ink); }
        // the stain: a few blots that fade off the lesson in a couple of seconds
        const b = []; for (let i = 0; i < 5; i++) b.push(rnd(-1, 1) * r * 0.6, rnd(-1, 1) * r * 0.5, rnd(0.35, 0.8) * r);
        part("stain", x, y, 0, 0, G.calm ? 1 : 2.6, r, ink, { pts: b });
      }
      for (let i = 0; i < N(4 + w * 2); i++) { const a = rnd(TAU), s = rnd(200, 420); part("spark", x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.1, 0.22), rnd(6, 11), ink); }
      ring(x, y, 0.3, r * 0.9, r * 2.4);
    }

    // ── what each event looks like ──
    G.on("start", () => { while (parts.length) free.push(parts.pop()); for (const e of jits) e.jit = 0; jits.length = pops.length = homing.length = conf.length = fly.length = 0; bm = ""; eat = rush = 0; tPop = null; downT = -1; trauma = 0; kick.x = kick.y = kick.vx = kick.vy = 0; fx.kx = fx.ky = 0; meterShow = collect = trailT = 0; pend = -1; });
    G.on("say", (d) => pop(G.W / 2, G.H * 0.38, d.text, G.pal.ink, 21, 1.7, true));
    G.on("launch", (d) => { shock(d.x, d.y, 0.9); burst(d.x, d.y + 18, 10); flip("smoke", d.x, d.y + 22, 70, 0.6); });
    // muzzle flash: the first frame of a shot is a circle (Nijman)
    G.on("shot", (d) => { part("flash", d.x + Math.cos(d.aim) * 8, d.y + Math.sin(d.aim) * 8, 0, 0, 0.035, 3.5 + d.power, G.dark ? G.pal.phos : G.pal.core, { ring: 1 }); });
    // sparks spray out the far side, along the shot, so you see where it went in
    G.on("foeHit", (d) => {
      const e = d.e, a = d.ang !== undefined ? d.ang : Math.atan2(e.y - d.y, e.x - d.x) || -Math.PI / 2;
      // a hit on the open thesis lands three times as hard and looks it: more, longer green sparks, a
      // held breath, the boss trembles, and one "×3" that swells with every hit instead of a stack of numbers
      const crit = d.critical || (e === G.boss && e.mode === "thesis" && Math.abs(d.y - G.aimPoint(e).y) < 15), n = crit ? 4 : 2;
      for (let i = 0; i < n; i++) { const b = a + rnd(-0.6, 0.6), s = rnd(120, 240) * (crit ? 1.5 : 1); part("spark", d.x, d.y, Math.cos(b) * s, Math.sin(b) * s, crit ? 0.2 : 0.12, crit ? 10 : 6, G.pal.phos); }
      if (crit) {
        const mini = e.k === "mini";
        const label = mini ? "×2 damage" : "×3";
        if (tPop?.text === label && tPop.t < tPop.life) {
          tPop.t = Math.min(tPop.t, .15); tPop.bump = 1; tPop.size = Math.min(mini ? 18 : 24, tPop.size + .7);
        } else {
          const x = mini ? clamp(e.x, 67, G.W - 67) : e.x - e.w / 2 - 8;
          const y = mini ? Math.max(20, e.y - e.h * .46 - 12) : d.y - 14;
          tPop = pop(x, y, label, GRN(), 14, 1.1);
        }
        stop(0.035, true); if (!G.calm) { if (!(e.jit > 0)) jits.push(e); e.jit = Math.max(e.jit || 0, 2); }
      }
    });
    G.on("kill", (d) => {
      const e = d.e, w = clamp(e.r / 14, 0.7, 2.6);
      death(e.x, e.y, e.r, w);
      // debris carries on the way the shot was going
      if (d.ang !== undefined) for (let i = 0; i < N(3 + w * 2); i++) { const b = d.ang + rnd(-0.45, 0.45), s = rnd(220, 380); part("ink", e.x, e.y, Math.cos(b) * s, Math.sin(b) * s - 30, rnd(0.3, 0.55), rnd(1.6, 3), DEB()); }
      pop(e.x, e.y - e.r - 8, "+" + d.pts, GRN(), d.big ? 14 : 11, 0.85, false, d.pts);
      // small kills only hold the frame a breath; shake is kept for what matters (survey item 4)
      if (d.big) { shock(e.x, e.y, 0.8); shake(6, e.x - P.x, e.y - P.y); stop(0.055); jitter(e.x, e.y, e.r * 3, 2.5); } else stop(0.022, true);
      if (e.sym) chars(e.x, e.y, e.sym, 2 + Math.round(w * 2));
      // the last footnote of the shield: the boss is unsourced
      const b = e.boss;
      if (b && !b.dead && !b.notes.some((f) => !f.dead && f !== e)) { thud(b.x, b.y, 0.9, 6, b.x - P.x, b.y - P.y, 0.05); ring(b.x, b.y, 0.4, b.w / 2 + 22, 20, DEB()); chars(b.x, b.y, "*¹²³", 8); pop(b.x, b.y + b.h / 2 + 40, "[citation needed]", G.pal.ink, 14, 1.6); }
    });
    G.on("segPop", (d) => { part("flash", d.x, d.y, 0, 0, 0.06, 10, G.pal.core); burst(d.x, d.y, 7); chars(d.x, d.y, d.ch, 1); });
    // a struck myth: its wrong words fall away as plain ink debris, the right one rises in green
    G.on("mythStruck", (d) => { const e = d.e; pop(e.x, e.y, "✓ " + d.myth.right, GRN(), 13, 2.6); chars(e.x, e.y, d.myth.wrong, 12, G.pal.faint); thud(e.x, e.y, 1, 5, undefined, 0, 0.05); });
    // a term about to come alive: dust lifts off it first
    G.on("termStir", (d) => dust(4, d.x, d.y, 24, 5, 0, -35, 20, 15, 2));
    G.on("termLift", (d) => { ring(d.x, d.y, 0.35, 10, 70, G.pal.red); chars(d.x, d.y, d.text, 5); flip("smoke", d.x, d.y, 56, 0.5); });
    // a wind-up: a thin ring closes in on the enemy (a warning, so it may be red)
    G.on("telegraph", (d) => { const e = d.e; if (e && !e.dead) part("tele", e.x, e.y, 0, 0, 0.36, (e.r || Math.max(e.w || 0, e.h || 0) / 2 || 16) + 26, G.pal.red, { e }); });
    // attacks: every kind gets a recoil ring sized by the enemy; kinds nobody has told us about shake
    // the screen too when the enemy is big, so a new boss move is never silent. Slam and charge get more.
    const LIGHT = "fan list stream stop shell beam ring break";
    G.on("attack", (d) => {
      const e = d.e; if (!e) return;
      const s = e.r || Math.max(e.w || 0, e.h || 0) / 2 || 16, big = s > 30 || e === G.boss, pal = G.pal;
      if (d.kind === "slam") {
        // a floor shockwave: dust runs both ways along the composer and the nearest words jump off it
        const y = G.floorY - 4; ring(e.x, y, 0.45, s * 0.4, s * 4, DEB(), 1); G.knock(e.x, y, 160 + s, 380); G.jolt(e.x, 420, 340);
        for (const v of [-270, 270]) dust(8, e.x + v / 10, y, 8, 2, v, -35, 150, 25);
        thud(e.x, y, 1.4, 14, 0, 1, 0.06);
      } else if (d.kind === "charge") {
        // speed lines and a puff left behind where it launched; a big charger also kicks the screen
        const a = e.ang !== undefined ? e.ang : Math.atan2(e.vy || 0, e.vx || 1), cx = Math.cos(a), cy = Math.sin(a);
        for (let i = 0; i < N(big ? 9 : 3); i++) { const o = rnd(-s, s) * 0.7, v = rnd(60, 170); part("spark", e.x - cx * s - cy * o, e.y - cy * s + cx * o, -cx * v, -cy * v, rnd(0.2, 0.35), big ? 22 : 12, DEB(), { L: 1 }); }
        part("puff", e.x - cx * s, e.y - cy * s, -cx * 40, -cy * 40, 0.5, s * 0.4, pal.faint);
        if (big) { shock(e.x, e.y, 0.7); shake(7, cx, cy); }
      } else if (MOVE[d.kind]) MOVE[d.kind](e, s, pal);
      else {
        if (s >= 18) ring(e.x, e.y, 0.3, s * 0.8, s * (big ? 1.6 : 0.9), DEB(), 1);
        if (big && !LIGHT.includes(d.kind)) { shock(e.x, e.y, 0.6); shake(Math.min(9, s / 12)); }
      }
    });
    // the boss's moves (R3). Each answers in proportion: the joke moves get a joke, the heavy ones weight.
    const MOVE = {
      // summoned footnotes: an orbit line opens out to where they will circle
      summon: (e) => ring(e.x, e.y, 0.5, 12, e.w / 2 + 10, DEB(), 1),
      // a torn rule: the tear runs out from the boss along the line, scraps of paper flaking off it
      rule: tear, receipt: tear,
      // hang: the page goes still (debris freezes mid-air too, see update); resume: everything snaps back
      hang: (e) => { ring(e.x, e.y, 0.4, e.w * 0.6, -e.w * 0.3, DEB(), 1); },
      resume: (e) => { shock(e.x, e.y, 0.8); shake(7, 0, 1); ticks(30); ring(e.x, e.y, 0.3, e.w * 0.4, e.w, DEB(), 1); },
      // a plot twist: a page-turn sweep round the boss, each bullet ticked where it turned, and a breath
      // of slow motion so a learner can read the new directions before they matter
      twist: (e) => { arcs(e.x, e.y, e.w * 0.7, DEB()); ticks(40); slow(0.45, 0.35); shake(6, 1, 0); },
      // "However,": it gets back up; the confetti that started falling for the fake ending drops dead
      however: (e) => {
        for (const p of conf) if (p.life > 0 && p.k === "chunk") { p.flut = undefined; p.vy = 260; p.life = Math.min(p.life, 0.7); } conf.length = 0;
        thud(e.x, e.y, 0.9, 9, 0, -1);
        dust(10, e.x, e.y + e.h / 2, e.w / 2, 2, 0, -20, 90, 20);
      },
      // "Padding!": two dashed rings close on it, the wind it draws
      inhale: (e) => { for (let i = 0; i < 2; i++) part("tele", e.x, e.y, 0, 0, 0.6, e.w * 0.9, DEB(), { e, wait: i * 0.3 }); },
    };
    function tear(e) {
      for (const b of G.bul) if (b.k === 9 && b.t < 0.05) for (let i = 0; i < N(18); i++) { const x = rnd(G.W); part("chunk", x, b.y, rnd(-30, 30), rnd(-110, 0), rnd(0.6, 0.9), rnd(2.6, 4), G.dark ? G.pal.soft : G.pal.card, { rot: rnd(TAU), vr: rnd(-9, 9), wait: Math.abs(x - e.x) / 1500 }); }
    }
    // a small mark where each bullet changed its mind (resume, twist)
    function arcs(x, y, r, col) { for (const a of [0, Math.PI]) part("arc", x, y, 0, 0, 0.35, r, col, { a }); }
    function ticks(n) { let i = 0; for (const b of G.bul) { if (i++ >= N(n)) break; ring(b.x, b.y, 0.22, 3, 9, DEB()); } }
    G.on("bossSpawn", (d) => { shock(d.e.x, d.e.y, 1); shake(8, 0, 1); });
    G.on("bossPhase", (d) => { thud(d.e.x, d.e.y, 1.2, 10, d.e.x - P.x, d.e.y - P.y, d.first ? 0.04 : 0.09); if (!d.first) chars(d.e.x, d.e.y, d.line || "…", 14); pop(d.x, d.y + 18, d.name, G.pal.ink, 13, 1.5); });
    // the boss: the frame holds on the final blow (the "boss stop"), then the world slows as the wall comes apart
    G.on("bossDeath", (d) => {
      if (d.e.k === "rival") {
        const e = d.e;
        stop(0.1);
        if (!G.calm) slow(0.6, 0.38);
        ring(e.x, e.y, 0.55, e.w * 0.35, e.w * 0.7, GRN(), 2);
        sparkles(e.x, e.y, 6, e.w * 0.44, e.h * 0.32, 16, 0.45, 0.04);
        return;
      }
      const e = d.e, hold = G.calm ? 0 : 0.32; stop(hold, false, 0.4); if (hold) { e.jit = 4; jits.push(e); } slow(0.25, 1.2 + hold); if (!G.calm) fx.flash = 0.8; shake(22);
      for (let i = 0; i < 4; i++) G.later(i * 0.06, () => { const x = e.x + rnd(-e.w / 2, e.w / 2), y = e.y + rnd(-e.h / 2, e.h / 2); shock(x, y, 1.5); death(x, y, 26, 2.2); });
      for (const ln of e.lines) chars(e.x + rnd(-e.w / 2, e.w / 2), e.y + rnd(-e.h / 2, e.h / 2), ln, 9);
    });
    // a bullet touched him: the world nearly stops (the window is game time, so it lasts ~0.7 s for the
    // player) and a ring closes on him. Pressing Eureka in time is the best save in the game.
    G.on("hitPending", () => { pend = G.T; slow(0.15, 0.75); });
    G.on("helperJoin", (d) => {
      const name = HELPER_LABELS[d.kind] || "Helper";
      pop(d.x, d.y - 26, `+1 ${name.toUpperCase()}`, GRN(), 12, 1.35);
      ring(d.x, d.y, 0.36, 8, 42, GRN());
      halo(d.x, d.y, 6, 18, 9, 0.35);
    });
    G.on("parry", (d) => {
      pop(d.x, d.y - 16, "PARRY", GRN(), 10, 0.7);
      ring(d.x, d.y, 0.25, 6, 26, GRN());
      for (let i = 0; i < N(5); i++) { const a = rnd(TAU), s = rnd(90, 190); part("spark", d.x, d.y, Math.cos(a) * s, Math.sin(a) * s, 0.16, 7, G.pal.phos); }
    });
    G.on("weaponPick", (d) => {
      pop(d.x, d.y - 34, `${String(d.label || d.weapon).toUpperCase()}!`, GRN(), 14, 1.45, true);
      ring(d.x, d.y, 0.42, 10, 62, GRN());
      halo(d.x, d.y, 8, 28, 10, 0.4);
    });
    G.on("lastChance", (d) => {
      pend = -1; slow(0.4, 0.55); stop(0.07);
      pop(d.x, d.y - 84, "JUST IN TIME", GRN(), 17, 1.4); ring(d.x, d.y, 0.5, 14, 130, GRN()); ring(d.x, d.y, 0.7, 8, 70, GRN());
      halo(d.x, d.y, 12, 44, 13, 0.45);
    });
    // hit: the screen is pushed away from where the bullets came from; nothing red, the bullets just go
    G.on("playerHit", (d) => {
      if (pend >= 0) { pend = -1; slow(1, 0); }
      let dx = 0, dy = 0; for (const b of d.cleared) { dx += d.x - b.x; dy += d.y - b.y; }
      fx.hit = 1; shake(12, dx || rnd(-1, 1), dy || 1); stop(0.1); shock(d.x, d.y, 1); burst(d.x, d.y, 16);
      for (const b of d.cleared) part("puff", b.x, b.y, 0, 0, 0.3, 4, G.pal.faint);
    });
    // second wind: he goes down and the world holds still behind the question; a heartbeat ring keeps
    // time around him (draw.over). Back up, it is the best comeback in the game: the frame holds, then
    // a green blast from his jets, rings, sparkles, the lesson blown back off the page, slow motion.
    G.on("downed", (d) => { downT = G.RT; shock(d.x, d.y, 1.2); });
    G.on("revive", (d) => {
      downT = -1; stop(0.12); slow(0.45, 1); shock(d.x, d.y, 1.8); shake(14, 0, -1); if (!G.calm) fx.flash = Math.max(fx.flash, 0.5);
      flip("eureka", d.x, d.y, 260, 0.6); pop(d.x, d.y - 64, "SECOND WIND", GRN(), 20, 1.9);
      ring(d.x, d.y, 0.6, 16, 170, GRN()); ring(d.x, d.y, 0.9, 10, 110, GRN()); ring(d.x, d.y, 1.2, 6, 260, GRN());
      for (let i = 0; i < N(28); i++) part("flame", d.x + rnd(-14, 14), d.y + 20, rnd(-90, 90), rnd(220, 480), rnd(0.3, 0.6), rnd(5, 9), "");
      halo(d.x, d.y, 16, 56, 15, 0.5);
      G.knock(d.x, d.y, 180, 440); G.jolt(d.x, 420, 500); jitter(d.x, d.y, 320, 3);
    });
    G.on("bomb", (d) => {
      if (d.kind === "sweep" || d.kind === "inkwell") {
        pop(d.x, d.y - 40, d.kind === "sweep" ? "SWEEP" : "INK WELL", GRN(), 13, 0.9);
        return;
      }
      shock(d.x, d.y, 1.6); if (!G.calm) fx.flash = 0.9; shake(12); flip("eureka", d.x, d.y, 300, 0.7); pop(d.x, d.y - 46, "EUREKA", GRN(), 16, 1.1);
    });
    // graze: an arc on the side the bullet passed, a glint, and the charge ring shows
    G.on("graze", (d) => {
      const a = Math.atan2(d.y - P.y, d.x - P.x); meterShow = 1;
      part("arc", P.x, P.y, 0, 0, 0.22, 24, GRN(), { a });
      part("spark", d.x, d.y, Math.cos(a) * 140 + rnd(-40, 40), Math.sin(a) * 140 + rnd(-40, 40), 0.16, 7, G.pal.green);
    });
    G.on("charge", (d) => { pop(d.x, d.y - 42, G.bombKind === "eureka" ? "Eureka charged" : "Bomb charged", GRN(), 12, 1.1); sparkles(d.x, d.y, 6, 30, 30, 14, 0.5, 0.04); });
    // each pickup swells the collect ring a little
    G.on("pickup", (d) => {
      collect = Math.min(1.4, collect + 0.18); const k = d.p.k;
      if (k === "s") { if (d.streak % 5 === 0) flip("sparkle", P.x + rnd(-10, 10), P.y + rnd(-14, 4), 10 + Math.min(10, d.streak / 3), 0.32); }
      else if (k === "c" || k === "h") { pop(P.x, P.y - 38, k === "c" ? "Flashcard · Bomb +1" : "+1", GRN(), 12, 1.1); ring(P.x, P.y, 0.4, 10, 40, GRN()); }
      else if (k === "e") { pop(P.x, P.y - 38, "Charge +" + Math.round((d.amount || 0) * 100) + "%", GRN(), 13, 1.1); ring(P.x, P.y, 0.45, 12, 70, GRN()); }
    });
    // Charge: say it once when it falls a tier, and again when a cell is on its way.
    G.on("chargeLow", (d) => pop(P.x, P.y - 44, d.tier === 1 ? "Charge almost gone" : "Low charge · fewer shots", G.pal.red, 12, 1.2));
    G.on("chargeEmpty", () => pop(P.x, P.y - 44, "Out of charge · catch a cell", G.pal.red, 13, 1.5));
    G.on("chargeCell", (d) => ring(d.x, d.y, 0.5, 8, 46, GRN()));
    G.on("powerUp", (d) => { pop(d.x, d.y - 38, "POWER UP", GRN(), 13, 1.1); ring(d.x, d.y, 0.4, 14, 90, GRN()); stop(0.04, true); sparkles(d.x, d.y, 5, 30, 26, 13, 0.45, 0.05); });
    G.on("multUp", (d) => { pop(P.x, P.y - 42, "×" + d.mult, GRN(), 14 + Math.min(6, d.mult), 0.9); ring(P.x, P.y, 0.35, 16, 34 + d.mult * 6, GRN()); });
    // a lost streak is told gently: the multiplier drops off and falls away, no red
    G.on("chainLost", (d) => { if (d.mult > 1) part("char", P.x, P.y - 40, rnd(-30, 30), -60, 1.2, 13, G.pal.faint, { ch: "×" + d.mult, vr: rnd(-2, 2) }); });
    // a wrong gate costs nothing and looks like nothing went wrong: the answer, in plain ink
    G.on("gateResolve", (d) => {
      if (d.ok) { pop(d.x, P.y - 40, "Correct  +" + d.pts, GRN(), 14, 1.2); shock(d.x, d.y, 0.9); fx.flash = Math.max(fx.flash, G.calm ? 0 : 0.35); sparkles(d.x, d.y, 8, 70, 14, 14, 0.5, 0.03); }
      else pop(d.x, P.y - 40, "It was " + d.right, G.pal.ink, 13, 1.6);
    });
    // a cancel turns bullets to green sparkles in a wave spreading out from the bot
    G.on("cancel", (d) => {
      let n = 0;
      for (const b of d.bullets) {
        if (d.toSparks && n++ < 70) { if (n % 2 || !G.calm) flip("sparkle", b.x, b.y, rnd(8, 12), 0.3, { wait: Math.hypot(b.x - P.x, b.y - P.y) / 1400 }); }
        else part("puff", b.x, b.y, 0, 0, 0.3, 4, G.pal.faint);
      }
    });
    // knocked words leave eraser crumbs where they were
    G.on("wordsKnocked", (d) => dust(Math.min(5, d.n), d.x, d.y, 30, 10, 0, -35, 40, 25, 1.5));
    // words flying home leave a faint ink trail and click into place
    G.on("wordsHome", () => { homing.length = 0; for (const w of G.words) if (w.st === 2) homing.push(w); trailT = 2; });
    G.on("finish", (d) => {
      pend = -1;
      for (const e of d.left) ring(e.x, e.y, 0.3, e.r, e.r * 2);
      if (d.won && !d.quit) confetti(36, [G.pal.green, G.pal.deep, G.pal.soft, G.pal.phos]);
    });

    // ── jets: flames follow how hard he is thrusting ──
    function jets() {
      if (G.state === "idle" || P.thrust <= 0) return;
      const n = G.calm ? 1 : P.thrust > 0.9 ? 3 : P.thrust > 0.7 ? 2 : 1, cs = Math.cos(P.tilt), sn = Math.sin(P.tilt), sc = P.scale;
      for (let s = -1; s <= 1; s += 2) {
        const nx = P.x + (s * 15 * cs - 20 * sn) * sc, ny = P.y + (s * 15 * sn + 20 * cs) * sc;
        for (let i = 0; i < n; i++) part("flame", nx + rnd(-2, 2), ny, -P.vx * 0.22 + rnd(-24, 24) - sn * 120, 150 + rnd(0, 130) - Math.min(0, P.vy) * 0.3, rnd(0.16, 0.34), rnd(3.6, 6.6) * sc, "");
        if (!G.calm && Math.random() < 0.16) part("puff", nx, ny + 8, rnd(-20, 20), 90, rnd(0.5, 0.9), rnd(3, 6), G.pal.faint);
      }
    }

    // real time: shake drains even in hit-stop, so a held frame still trembles
    G.hook("frame", (rdt) => {
      trauma = Math.max(0, trauma - rdt * 1.7);
      fx.shake = G.calm ? 0 : 22 * trauma * trauma;
      // kick: damped spring back to rest, applied by core as fx.kx, fx.ky
      kick.vx += (-260 * kick.x - 20 * kick.vx) * rdt; kick.vy += (-260 * kick.y - 20 * kick.vy) * rdt;
      kick.x = clamp(kick.x + kick.vx * rdt, -10, 10); kick.y = clamp(kick.y + kick.vy * rdt, -10, 10);
      fx.kx = G.calm ? 0 : kick.x; fx.ky = G.calm ? 0 : kick.y;
      meterShow = Math.max(0, meterShow - rdt * 0.9); collect = Math.max(0, collect - rdt * 0.8);
      // the tremble fades slowly while the frame is held, quickly once it runs again
      let n = 0; for (const e of jits) { e.jit = Math.max(0, e.jit - rdt * (fx.stop > 0 ? 5 : 22)); if (e.jit > 0) jits[n++] = e; } jits.length = n;
    });

    // ── the boss's body, watched each frame: thesis and conclusion have no event of their own ──
    function watch() {
      const e = G.boss, m = e ? e.mode : "";
      if (m !== bm) { const was = bm; bm = m; if (e) enter(e, m, was); }
      if (!e) return;
      // the charge: speed lines behind it, words knocked off the lesson in its lane; it crashes into the edge
      if (m === "charge" && e.vx) {
        rush = Math.sign(e.vx); const back = e.x - rush * e.w / 2;
        if (!G.calm || Math.random() < 0.3) part("spark", back, e.y + rnd(-e.h, e.h) * 0.45, -rush * rnd(80, 200), 0, rnd(0.2, 0.35), rnd(16, 30), DEB(), { L: 1 });
        if (Math.random() < 0.3) G.knock(e.x + rush * e.w / 2, e.y, e.h * 0.45, 300);
      } else if (rush) {
        const x = e.x + rush * e.w / 2; thud(x, e.y, 0.9, 9, rush, 0, 0.05);
        dust(10, x, e.y, 2, e.h * 0.4, -rush * 85, 0, 55, 40);
        rush = 0;
      }
      // the inhale: wind lines run in to it, each loose word streams in with a trail; every gulp shows
      if (m === "inhale") {
        if (Math.random() < (G.calm ? 0.15 : 0.6)) { const a = rnd(TAU), r = e.w * rnd(0.8, 1.4); part("spark", e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, -Math.cos(a) * 320, -Math.sin(a) * 320, 0.25, 14, DEB(), { L: 1 }); }
        for (const w of G.words) if (w.st === 1 && !w.taken && !w.rest && Math.random() < 0.3) part("ink", w.x, w.y, 0, 0, 0.3, 1.4, w.col);
        if (e.eat.length > eat) { ring(e.x, e.y + e.h * 0.2, 0.25, 8, 22, DEB()); if (!G.calm) { if (!(e.jit > 0)) jits.push(e); e.jit = 1.5; } }
        eat = e.eat.length;
      }
    }
    function enter(e, m, was) {
      if (m === "thesis") {
        // the thesis opens: his colour, because it is his chance; the highlighted line sparkles end to end
        const y = G.aimPoint(e).y; stop(0.05); shock(e.x, y, 0.7); tPop = null;
        arcs(e.x, y, e.w * 0.6, GRN());
        sparkles(e.x, y, 7, e.w / 2, 3, 13, 0.45, 0.03);
        // "*cough*": the words it swallowed come back out in a cloud
        if (was === "inhale" && e.dmgIn >= 34) { shake(7, 0, 1); dust(14, e.x, e.y + 5, 30, 15, 0, -70, 160, 90, 4); }
        eat = 0;
      } else if (m === "conclusion") {
        // "In conclusion…": it plays the boss death, half-heartedly. The frame holds, it topples, and a
        // little of the victory confetti starts to fall, for a moment. "However," (MOVE) drops it dead.
        stop(0.12, false, 0.2); slow(0.5, 0.6); thud(e.x, e.y, 1.1, 10, e.dir || 1, 0);
        chars(e.x, e.y, e.lines[0] || "…", 6);
        confetti(16, [G.pal.green, G.pal.deep, G.pal.soft]);
      }
    }
    // bullets that the feedback answers as they move: the floor ripple, words thrown, torn rules passed
    function bullets() {
      for (const b of G.bul) {
        if (b.k === 10) { G.jolt(b.x, 230, 18); if (Math.random() < (G.calm ? 0.1 : 0.4)) part("puff", b.x, G.floorY - 3, -Math.sign(b.vx) * rnd(20, 60), rnd(-40, -10), rnd(0.3, 0.5), rnd(2, 4), G.pal.faint); }
        else if (b.k === 8 && !b.safe && !b.fl) { b.fl = 1; fly.push(b); ring(b.x, b.y, 0.2, 6, b.ww * 0.5, DEB()); }
        else if (b.k === 9 && !b.pz && b.y >= P.y && G.state === "play") {
          // threading the gap of a torn rule: a tick each side of him, in his green
          b.pz = 1; if (Math.abs(P.x - b.gx) < b.gw / 2 && P.inv <= 0) arcs(P.x, P.y, 20, GRN());
        }
      }
      // a thrown word: speed lines behind it while it flies; if it misses, it hits the edge of the page with a puff
      for (let i = fly.length - 1; i >= 0; i--) {
        const b = fly[i], l = Math.hypot(b.vx, b.vy) || 1;
        if (!b.dead && G.bul.includes(b)) { if (Math.random() < 0.5) part("spark", b.x - (b.vx / l) * b.ww * 0.5, b.y + rnd(-4, 4), -b.vx * 0.2, -b.vy * 0.2, 0.18, 14, DEB(), { L: 1 }); continue; }
        fly.splice(i, 1);
        if (b.dead && Math.hypot(b.x - P.x, b.y - P.y) > 40) { const x = clamp(b.x, 12, G.W - 12), y = clamp(b.y, 12, G.H - 12); ring(x, y, 0.3, 4, 26, DEB()); dust(5, x, y, 2, 2, -b.vx * 0.2, -b.vy * 0.2, 30, 30, 2); }
      }
    }

    G.hook("update", (dt) => {
      jets(); watch(); bullets();
      // "(Not Responding)": while the boss has the page hung, the debris hangs too, mid-air
      const hung = G.boss && G.boss.frz;
      const floor = G.floorY - 5;
      // magnetic sparks streak toward him
      if (!G.calm) for (const p of G.picks) if (p.k === "s" && (p.mag || Math.abs(p.vx) + Math.abs(p.vy) > 260) && Math.random() < 0.4) part("trail", p.x, p.y, 0, 0, 0.16, 2, G.pal.green);
      if (trailT > 0) {
        trailT -= dt;
        for (let i = homing.length - 1; i >= 0; i--) {
          const w = homing[i];
          if (w.st !== 2) { homing.splice(i, 1); if (w.st === 0) ring(w.hx, w.hy, 0.22, w.w * 0.3, 6, GRN()); continue; }
          if (w.t > w.delay && Math.random() < (G.calm ? 0.1 : 0.45)) part("ink", w.x + rnd(-w.w / 3, w.w / 3), w.y, 0, 0, 0.3, 1.3, w.col);
        }
      }
      let j = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.wait > 0 || (hung && p.L === 1 && p.k !== "flame")) { p.wait -= dt; parts[j++] = p; continue; }
        p.life -= dt;
        if (p.life <= 0) { free.push(p); continue; }
        parts[j++] = p;
        const k = p.k;
        if (k === "ink" || k === "char" || k === "chunk") {
          if (p.rest) continue;
          p.vy += (p.flut !== undefined ? 160 : 560) * dt; p.vx *= Math.exp(-dt * 1.2); p.rot += p.vr * dt;
          if (p.flut !== undefined) { p.flut += dt * 5; p.vx += Math.cos(p.flut) * 90 * dt; p.vy = Math.min(p.vy, 110); }
          // letters and chunks land on the composer: one bounce, then they lie still
          if (k !== "ink" && p.y > floor && p.vy > 0) { if (p.vy > 140) { p.vy *= -0.32; p.vx *= 0.55; p.vr *= 0.4; } else { p.rest = true; p.y = floor; p.life = Math.min(p.life, k === "char" ? 1.4 : 0.5); } }
        } else if (k === "spark") { p.vx *= Math.exp(-dt * 5); p.vy *= Math.exp(-dt * 5); }
        else if (k === "flame") p.vx *= Math.exp(-dt * 3);
        else if (k === "puff") { p.vy *= Math.exp(-dt * 2.5); p.vx *= Math.exp(-dt * 2.5); p.size += dt * 12; }
        else if (k === "tele" && p.e) { p.x = p.e.x; p.y = p.e.y; if (p.e.dead) p.life = 0; }
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      parts.length = j;
      let n = 0; for (const p of pops) { p.t += dt; p.bump = Math.max(0, p.bump - dt * 6); if (p.t <= p.life) pops[n++] = p; } pops.length = n;
    });

    // ── drawing ──
    function drawFlip(c, p, q) {
      const f = G.o.flip, r = f.rows[p.row], img = sheet(f), fr = Math.min(7, Math.floor((1 - q) * 8)), s = p.size;
      c.globalAlpha = p.row === "smoke" ? 0.7 : 1;
      c.save(); c.translate(p.x, p.y); if (p.rot) c.rotate(p.rot); c.drawImage(img, fr * f.cell, r * f.cell, f.cell, f.cell, -s / 2, -s / 2, s, s); c.restore();
    }
    function drawPart(c, p, pal) {
      const q = clamp(p.life / p.max, 0, 1), k = p.k;
      c.globalAlpha = q; c.strokeStyle = c.fillStyle = p.col;
      if (k === "ink" || k === "trail") { c.globalAlpha = Math.min(1, q * 2) * (k === "trail" ? 0.7 : 1); c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + q * 0.6), 0, TAU); c.fill(); }
      else if (k === "spark") { const l = Math.hypot(p.vx, p.vy) || 1; c.lineWidth = 2; c.lineCap = "round"; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - (p.vx / l) * p.size, p.y - (p.vy / l) * p.size); c.stroke(); }
      else if (k === "ring") { c.globalAlpha = q * 0.8; c.lineWidth = 2.2 * q + 0.4; c.beginPath(); c.arc(p.x, p.y, p.size + p.grow * (1 - q * q), 0, TAU); c.stroke(); }
      else if (k === "char") { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.min(1, q * 2.5) * 0.85; c.font = "600 " + p.size + "px " + SERIF; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(p.ch, 0, 0); c.restore(); }
      else if (k === "chunk") { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.min(1, q * 3); const s = p.size; c.fillRect(-s, -s * 0.6, s * 2, s * 1.2); if (!G.dark) { c.strokeStyle = pal.ink; c.lineWidth = 1; c.strokeRect(-s, -s * 0.6, s * 2, s * 1.2); } c.restore(); }
      else if (k === "puff") { c.globalAlpha = q * 0.45; c.lineWidth = 1.3; c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.stroke(); }
      else if (k === "flash") { c.globalAlpha = 1; c.beginPath(); c.arc(p.x, p.y, p.size * (1.2 - q * 0.2), 0, TAU); c.fill(); if (!G.dark && !p.ring) { c.strokeStyle = pal.ink; c.lineWidth = 1.6; c.stroke(); } }
      else if (k === "arc") { c.globalAlpha = q * 0.85; c.lineWidth = 2; c.lineCap = "round"; c.beginPath(); c.arc(p.x, p.y, p.size + (1 - q) * 6, p.a - 0.5, p.a + 0.5); c.stroke(); }
      else if (k === "tele") { c.globalAlpha = (1 - q) * 0.55; c.lineWidth = 1.4; c.setLineDash([3, 4]); c.beginPath(); c.arc(p.x, p.y, p.size * (0.45 + q * 0.55), 0, TAU); c.stroke(); c.setLineDash([]); }
      else if (k === "stain") { c.globalAlpha = (G.dark ? 0.1 : 0.13) * Math.min(1, q * 2.5); c.beginPath(); for (let i = 0; i < 15; i += 3) { c.moveTo(p.x + p.pts[i] + p.pts[i + 2], p.y + p.pts[i + 1]); c.arc(p.x + p.pts[i], p.y + p.pts[i + 1], p.pts[i + 2], 0, TAU); } c.fill(); }
      else if (k === "fb" || k === "sparkle" || k === "eureka") drawFlip(c, p, q);
    }
    function layer(c, L, pal) { for (const p of parts) if (p.L === L && p.k !== "flame" && p.wait <= 0) drawPart(c, p, pal); c.globalAlpha = 1; }

    G.hook("draw.back", (env) => layer(G.c, 0, env.pal));

    // flames (glowing, his green in both themes, a pale core on paper), debris and score pops: under the bot and every bullet
    G.hook("draw.flames", (env) => {
      const dark = env.dark, pal = env.pal;
      for (const c of [G.c, G.em]) {
        if (dark) c.globalCompositeOperation = "lighter";
        for (const p of parts) {
          if (p.k !== "flame") continue; const q = p.life / p.max; if (q <= 0) continue;
          c.beginPath(); c.arc(p.x, p.y, p.size * (0.35 + q * 0.65), 0, TAU);
          c.fillStyle = dark ? (q > 0.6 ? "rgba(220,255,232,.9)" : q > 0.3 ? "rgba(75,227,136,.7)" : "rgba(47,184,102,.35)") : q > 0.62 ? "#eefbe8" : q > 0.32 ? pal.green : pal.deep; c.globalAlpha = dark ? 1 : 0.35 + q * 0.6; c.fill();
        }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
      }
      layer(G.c, 1, pal);
      drawPops(G.c, pal, false);
    });

    function drawPops(c, pal, big) {
      c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
      for (const p of pops) {
        if (p.big !== big) continue;
        const q = p.t / p.life, a = q < 0.12 ? q / 0.12 : q > 0.75 ? (1 - q) / 0.25 : 1, y = p.y - (p.big ? 0 : 26 * (1 - Math.pow(1 - q, 2)));
        // pops overshoot as they appear, and bump when they absorb another score
        const s = (q < 0.09 ? 0.5 + q / 0.09 * 0.75 : q < 0.2 ? 1.25 - (q - 0.09) / 0.11 * 0.25 : 1) + p.bump * 0.25;
        c.save(); c.translate(p.x, y); c.scale(s, s);
        c.globalAlpha = clamp(a, 0, 1); c.font = "700 " + p.size + "px " + MONO;
        c.lineWidth = p.big ? 6 : 3.5; c.strokeStyle = pal.paper; c.strokeText(p.text, 0, 0); c.fillStyle = p.col; c.fillText(p.text, 0, 0);
        if (p.big) { const tw = c.measureText(p.text).width; c.fillStyle = pal.green; c.fillRect(-tw / 2, p.size * 0.78, tw * clamp(q * 3, 0, 1), 3); }
        c.restore();
      }
      c.globalAlpha = 1;
    }

    G.hook("draw.over", (env) => {
      const c = G.c, pal = env.pal;
      layer(c, 2, pal);
      if (env.dark) { const e = G.em; for (const p of parts) if ((p.k === "sparkle" || p.k === "eureka") && p.wait <= 0) drawFlip(e, p, clamp(p.life / p.max, 0, 1)); e.globalAlpha = 1; }
      // down: a slow heartbeat ring around him (real time: game time has stopped); still when calm
      if (G.state === "down" && downT >= 0) {
        const t = G.RT - downT, q = G.calm ? 0.5 : (t * 1.1) % 1; c.lineWidth = 2; c.strokeStyle = pal.ink; c.setLineDash([4, 5]);
        c.globalAlpha = 0.55 * (1 - q); c.beginPath(); c.arc(P.x, P.y, 28 + q * 26, 0, TAU); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      }
      // hung: the busy spinner by the boss, eight dots chasing round
      const B = G.boss;
      if (B && B.frz) { const x = B.x + B.w / 2 + 4, y = B.y - B.h / 2 - 4, r0 = G.calm ? 0 : Math.floor(G.RT * 12); c.fillStyle = pal.ink; for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; c.globalAlpha = 0.15 + 0.8 * (((i - r0) % 8 + 8) % 8) / 7; c.beginPath(); c.arc(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 2.2, 0, TAU); c.fill(); } c.globalAlpha = 1; }
      if (G.state === "play") {
        c.lineCap = "round"; c.lineWidth = 2;
        // the graze ring (survey item 6): faint at 26 px, it lights up while a bullet is inside it
        let near = 0; for (const b of G.bul) { const dx = b.x - P.x, dy = b.y - P.y, d2 = dx * dx + dy * dy; if (d2 < 1156) near = Math.max(near, 1 - Math.sqrt(d2) / 34); }
        if (near > 0 && P.inv <= 0) { c.globalAlpha = Math.min(0.8, 0.3 + near); c.strokeStyle = pal.green; c.lineWidth = 1 + near; c.beginPath(); c.arc(P.x, P.y, 26, 0, TAU); c.stroke(); c.lineWidth = 2; }
        // around the bot, thin and faint: graze charge toward the next Eureka, and the collect glow
        if (meterShow > 0) { c.globalAlpha = Math.min(1, meterShow * 2) * 0.6; c.strokeStyle = GRN(); c.beginPath(); c.arc(P.x, P.y, 31, -Math.PI / 2, -Math.PI / 2 + TAU * (G.meter / 36)); c.stroke(); }
        if (collect > 0) { c.globalAlpha = Math.min(0.5, collect * 0.5); c.strokeStyle = GRN(); c.lineWidth = 1 + collect; c.beginPath(); c.arc(P.x, P.y, 36 + collect * 4, 0, TAU); c.stroke(); }
        // the last chance: a ring closes on him over the window, with the one word that saves him
        const q = pend >= 0 ? (G.T - pend) / 0.1 : 2;
        if (q < 1.05) {
          c.globalAlpha = 0.9; c.strokeStyle = pal.ink; c.lineWidth = 2.5; c.setLineDash([6, 5]); c.beginPath(); c.arc(P.x, P.y, 12 + 50 * (1 - Math.min(1, q)), 0, TAU); c.stroke(); c.setLineDash([]);
          const cue = G.bombKind === "eureka" ? "EUREKA!" : "BOMB!";
          c.font = "700 12px " + MONO; c.textAlign = "center"; c.lineWidth = 4; c.strokeStyle = pal.paper; c.fillStyle = pal.ink; c.strokeText(cue, P.x, P.y - 72); c.fillText(cue, P.x, P.y - 72);
        }
        c.globalAlpha = 1;
      }
      // the one line the wall leaves behind
      const tl = G.tldr;
      if (tl) {
        const k = clamp(tl.t / 0.5, 0, 1), maxW = Math.min(G.W - 70, 420); c.globalAlpha = k; c.textAlign = "center"; c.textBaseline = "middle";
        c.font = "700 10px " + MONO; c.fillStyle = pal.deep; c.fillText("TL;DR", tl.x, tl.y - 26 - (1 - k) * 8);
        c.font = "600 17px " + SERIF;
        // Wrap once per width, not on every frame of the outro.
        if (!tl.lines || tl.linesW !== maxW) {
          const ls = []; let cur = "";
          for (const w of G.pack.tldr.split(" ")) { const t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { ls.push(cur); cur = w; } else cur = t; } ls.push(cur);
          tl.lines = ls; tl.linesW = maxW;
        }
        const ls = tl.lines;
        c.lineWidth = 5; c.strokeStyle = pal.paper; c.lineJoin = "round"; c.fillStyle = pal.ink;
        ls.forEach((l, i) => { const y = tl.y - 4 + i * 23; c.strokeText(l, tl.x, y); c.fillText(l, tl.x, y); }); c.globalAlpha = 1;
      }
      // wave titles stay on top
      drawPops(c, pal, true);
    });
}
