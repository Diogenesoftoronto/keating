import { RecessArt } from "./foes.js";
// Recess patterns: what each enemy does, what it fires, and the order they arrive in.
// Owner: the patterns lane. Bullet kinds (how a bullet moves and looks) live in bullets.js.
//
// An enemy kind is G.kinds[name] = {
//   drops,                       sparks dropped on death
//   update(G, e, dt),            every frame once it has finished emerging
//   hit(G, e, x, y, pad),        optional hit test; return e, or a part of e, or null
//   hitPart(G, e, part, d),      optional: damage to a part returned by hit()
//   aimAt(G, e, px, py),         optional: the point the bot's auto-aim should use
//   bombed(G, e),                optional: what a Eureka does to it (default: 26 damage)
//   threat(G, e, x, y),          optional: extra danger at (x, y), for the demo pilot
//   death(G, e),                 optional: after core has scored the kill
//   body                         contact padding against the bot (default -3)
// }
// Set e.act ("idle" | "windup" | "attack") and e.actT = 0 when an enemy changes what it is
// doing: the characters lane picks animation frames from it, and it is the telegraph.
export function install(G) {
    const { rnd, clamp, lerp, TAU } = G, fire = G.fire, aim = G.aim, SERIF = RecessArt.SERIF;
    // big = an attack worth a warning sound: popcorn windups only set e.act, so "warn" does not chatter
    const act = (e, a, big) => { if (e.act !== a) { e.act = a; e.actT = 0; if (big && a === "windup") G.emit("telegraph", { e }); } };
    const attack = (e, kind) => { act(e, "attack"); G.emit("attack", { e, kind }); };

    // ── rank: the run quietly bends to the player (Battle Garegga's idea, turned kind) ──
    // rk runs from -1 (easier) to 1 (harder). It creeps up while he is untouched and falls on a hit,
    // further early in the run and further when he is low. Nothing on screen ever says so.
    let rk = 0;
    G.on("start", () => { rk = 0; });
    G.on("playerHit", (d) => { rk = Math.max(-1, rk - (G.T < 50 ? 0.5 : 0.3) - (d.hearts <= 1 ? 0.25 : 0)); });
    G.hook("update", (dt) => { if (G.state === "play" && G.T > 22 && !G.mercy) rk = Math.min(1, rk + dt * 0.011); });
    // Core's hidden mercy already slows bullets (up to 15%) and softens enemies; so that the two do not stack
    // into a trivial game, rank's easing is halved while mercy is up, and rank does not climb until mercy is gone.
    const R = () => { const r = G.T < 22 ? Math.min(rk, -0.3) : rk; return r < 0 ? r * (1 - 0.5 * G.mercy) : r; }; // the first twenty seconds are always gentle
    const S = (v) => v * (1 + 0.14 * R()), CD = (v) => v * (1 - 0.2 * R());

    // Fair-play rules every emitter goes through: nothing fires from off screen or point-blank,
    // and nothing appears on top of the bot.
    const live = (x, y) => x > 6 && x < G.W - 6 && y > 6 && y < G.H - 6;
    const near = (x, y, d) => (x - G.P.x) * (x - G.P.x) + (y - G.P.y) * (y - G.P.y) < d * d;
    const shoot = (x, y, a, v, k, ex) => (live(x, y) ? fire(x, y, a, S(v), k, ex) : null);
    const ok = (e) => G.state === "play" && live(e.x, e.y) && !near(e.x, e.y, 90);
    const out = (e, m) => e.x < -m || e.x > G.W + m || e.y < -m - 20 || e.y > G.H + m;
    const away = (x, y) => (near(x, y, 130) ? [x, G.P.y > G.H * 0.4 ? G.P.y - 130 : G.P.y + 130] : [x, y]);
    const subj = () => (G.pack.label || "").toLowerCase();

    // ── entries: it is an arena, so waves come in from every edge ──
    // "far" picks an edge away from the bot and never the same one twice running (Toaplan's
    // alternating sides), so the player is drawn across the whole space.
    let lastSide = "";
    function side(from) {
      if (from !== "far") return from;
      const P = G.P, o = ["T"]; if (P.x > G.W * 0.4) o.push("L"); if (P.x < G.W * 0.6) o.push("R"); if (P.y < G.H * 0.42) o.push("B");
      let s = o[(rnd(o.length)) | 0]; if (s === lastSide && o.length > 1) s = o[(o.indexOf(s) + 1) % o.length]; return (lastSide = s);
    }
    function entry(s, i, n) {
      const W = G.W, H = G.H, f = (i + 0.5) / n;
      if (s === "L") return { x: -20, y: H * (0.1 + 0.34 * f), a: 0.12 };
      if (s === "R") return { x: W + 20, y: H * (0.1 + 0.34 * f), a: Math.PI - 0.12 };
      if (s === "B") return { x: W * (0.12 + 0.76 * f), y: H + 20, a: -Math.PI / 2 };
      return { x: W * (0.12 + 0.76 * f), y: -20, a: Math.PI / 2 };
    }

    // ── emitters ──
    const ring = (x, y, n, spd, kind, phase) => { const p = phase === undefined ? rnd(TAU) : phase; for (let i = 0; i < n; i++) fire(x, y, p + (i / n) * TAU, spd, kind); };
    const fan = (x, y, n, spread, spd, kind, dir) => { const a = dir === undefined ? aim(x, y) : dir; for (let i = 0; i < n; i++) fire(x, y, a + (i - (n - 1) / 2) * spread, spd, kind); };
    G.emitters = { ring, fan };

    // ── kinds ──
    G.kinds.drift = {
      drops: 3,
      // asks: can you keep moving while he does the aiming? One slow aimed dot, wound up first.
      update(G, e, dt) {
        e.bx += e.vx * dt; e.by += e.vy * dt; const o = Math.sin(e.t * e.w) * e.amp; e.x = e.bx - (e.vy / e.sp) * o; e.y = e.by + (e.vx / e.sp) * o; e.cd -= dt;
        if (e.cd <= 0.35 && e.cd > 0) act(e, "windup");
        if (e.cd <= 0) { e.cd = CD(rnd(1.7, 2.7)); if (ok(e)) { shoot(e.x, e.y, aim(e.x, e.y), G.T < 22 ? 125 : 150, 0); act(e, "attack"); } else act(e, "idle"); }
        else if (e.act === "attack" && e.actT > 0.3) act(e, "idle");
        if (e.t > 2 && out(e, 40)) e.dead = 2;
      },
    };
    G.kinds.kid = {
      drops: 3,
      update(G, e, dt) {
        e.x += e.vx * dt; e.vy = Math.min(60, e.vy + 180 * dt); e.y += e.vy * dt; if (e.x < e.r || e.x > G.W - e.r) e.vx *= -1; e.cd -= dt;
        if (e.cd <= 0.3 && e.cd > 0) act(e, "windup");
        if (e.cd <= 0) { e.cd = CD(rnd(1.4, 2)); if (ok(e)) shoot(e.x, e.y, aim(e.x, e.y), 165, 0); act(e, "attack"); } else if (e.act === "attack" && e.actT > 0.3) act(e, "idle");
        if (e.y > G.H + 30) e.dead = 2;
      },
    };
    G.kinds.dart = {
      drops: 4,
      update(G, e, dt) {
        // asks: can you read a line and step off it? It glides in from its edge, draws its line, then goes.
        if (e.ph === 0) { const k = 1 - Math.exp(-dt * 4); e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; if (Math.abs(e.tx - e.x) + Math.abs(e.ty - e.y) < 8) { e.ph = 1; e.pt = 0; e.ang = aim(e.x, e.y); act(e, "windup", true); } }
        else if (e.ph === 1) { e.pt += dt; if (e.pt < 0.45) e.ang = aim(e.x, e.y); if (e.pt > 0.8 - 0.15 * R()) { e.ph = 2; e.pt = 0; attack(e, "charge"); } }
        else { e.x += Math.cos(e.ang) * 760 * dt; e.y += Math.sin(e.ang) * 760 * dt; e.pt -= dt; if (e.pt <= 0) { e.pt = 0.075; shoot(e.x, e.y, rnd(TAU), rnd(14, 34), 0); } if (out(e, 40)) e.dead = 2; }
      },
      threat(G, e, x, y) { if (e.ph < 1) return 0; const ux = Math.cos(e.ang), uy = Math.sin(e.ang), qx = x - e.x, qy = y - e.y; return qx * ux + qy * uy > 0 && Math.abs(qx * uy - qy * ux) < 38 ? 160 : 0; },
    };
    G.kinds.spin = {
      drops: 10,
      update(G, e, dt) {
        e.life += dt;
        if (e.ph === 0) { e.y += (e.ty - e.y) * (1 - Math.exp(-dt * 2.4)); e.x += (e.tx - e.x) * (1 - Math.exp(-dt * 2.4)); if (Math.abs(e.y - e.ty) < 4) { e.ph = 1; e.pt = 0; act(e, "attack"); } }
        else if (e.ph === 1) {
          e.firing = true; e.pt += dt; e.rot += e.dir * 2.6 * dt; e.cd -= dt;
          while (e.cd <= 0) { e.cd += CD(0.09); e.a += e.dir * 0.36; shoot(e.x, e.y, e.a, 118, 0); shoot(e.x, e.y, e.a + Math.PI, 118, 0); }
          if (e.pt > 3.4) { e.ph = 2; e.pt = 0; e.firing = false; act(e, "idle"); }
        } else if (e.ph === 2) { e.pt += dt; e.rot += e.dir * 0.5 * dt; if (e.pt > 0.75) act(e, "windup", true); if (e.pt > 1.1) { e.ph = e.life > 11 ? 3 : 1; e.pt = 0; e.dir *= -1; e.cd = 0; act(e, e.ph === 1 ? "attack" : "idle"); } }
        else { e.y -= 150 * dt; if (e.y < -40) e.dead = 2; }
      },
      death(G, e) { if (G.P.hearts < 4 && Math.random() < 0.6) G.addPick("h", e.x, e.y); },
    };
    G.kinds.split = {
      drops: 6,
      update(G, e, dt) {
        e.x += e.vx * dt; e.y += e.vy * dt; if (e.x < e.r || e.x > G.W - e.r) e.vx *= -1; if (e.y > G.H * 0.42 && e.vy > 0) e.vy *= -1; if (e.y < e.r + 10 && e.vy < 0) e.vy *= -1; e.cd -= dt;
        if (e.cd <= 0.4 && e.cd > 0) act(e, "windup", true);
        if (e.cd <= 0) { e.cd = CD(2.6); ring(e.x, e.y, R() > 0.5 ? 12 : 10, S(108), 1); attack(e, "ring"); } else if (e.act === "attack" && e.actT > 0.3) act(e, "idle");
      },
      death(G, e) { for (const s of [-1, 1]) G.spawn(G.mk("kid", e.x + s * 12, e.y, { sym: e.kids[s < 0 ? 0 : 1], half: s < 0 ? 0 : 1, vx: s * 130, vy: -70, r: 15, hp: 5, pts: 150, cd: rnd(0.8, 1.6) })); },
    };
    G.kinds.worm = {
      drops: 8,
      update(G, e, dt) {
        const tt = e.t, W = G.W; let hx = W / 2 + Math.sin(tt * 0.85 + e.ph) * W * 0.36, hy = e.y0 + Math.sin(tt * 1.9) * 40 + tt * 4;
        if (tt > 15) hy -= (tt - 15) * (tt - 15) * 70;
        const k = clamp(tt / 1.3, 0, 1), s = k * k * (3 - 2 * k); e.x = lerp(e.x0, hx, s); e.y = lerp(e.ys, hy, s);
        e.acc += dt; while (e.acc >= 1 / 60) { e.acc -= 1 / 60; e.hist.unshift([e.x, e.y]); e.hist.pop(); }
        let alive = 0; e.segs.forEach((sg, i) => { const h = e.hist[(i + 1) * 8]; sg.x = h[0]; sg.y = h[1]; sg.flash = Math.max(0, sg.flash - dt * 7); if (sg.alive) alive++; });
        e.cd -= dt; if (e.cd <= 0 && alive) { e.cd = 0.8; const live = e.segs.filter((q) => q.alive), sg = live[(rnd(live.length)) | 0]; if (sg.y > 10) fire(sg.x, sg.y, Math.PI / 2, 150, 0); }
        e.cd2 -= dt; if (e.cd2 <= 0.4 && e.cd2 > 0) act(e, "windup");
        if (e.cd2 <= 0) { e.cd2 = 2.3; if (ok(e)) fan(e.x, e.y, 3, 0.18, 170, 1); act(e, "attack"); } else if (e.act === "attack" && e.actT > 0.3) act(e, "idle");
        if (tt > 17.5 && e.y < -60) e.dead = 2;
      },
      hit(G, e, x, y, pad) {
        for (const s of e.segs) if (s.alive && (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y) < (10 + pad) * (10 + pad)) return s;
        return (x - e.x) * (x - e.x) + (y - e.y) * (y - e.y) < (e.r + pad) * (e.r + pad) ? e : null;
      },
      hitPart(G, e, s, d) {
        s.hp -= d; s.flash = 1; G.emit("foeHit", { e, part: s, d, x: s.x, y: s.y });
        if (s.hp <= 0) { s.alive = false; G.addScore(60 * G.mult); G.addChain(); G.addPick("s", s.x, s.y); G.knock(s.x, s.y, 40, 200); G.emit("segPop", { e, x: s.x, y: s.y, ch: s.ch, i: Math.min(G.chain, 10) }); }
      },
      aimAt(G, e, px, py) { let best = e, bd = (e.x - px) * (e.x - px) + (e.y - py) * (e.y - py); for (const s of e.segs) { if (!s.alive) continue; const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py); if (d < bd) { bd = d; best = s; } } return best; },
      bombed(G, e) { for (const s of e.segs) if (s.alive) G.kinds.worm.hitPart(G, e, s, 5); G.hurtFoe(e, 26); },
      // pop the head and the rest goes off in order
      death(G, e) { e.segs.forEach((s, i) => { if (!s.alive) return; const x = s.x, y = s.y; G.later(0.05 + i * 0.055, () => { G.addScore(60 * G.mult); G.addPick("s", x, y); G.knock(x, y, 40, 200); G.emit("segPop", { e, x, y, ch: s.ch, i: Math.min(i + 2, 10), chained: true }); }); }); },
    };
    const rect = (G, e, x, y, pad) => (Math.abs(x - e.x) < e.w / 2 + pad && Math.abs(y - e.y) < e.h / 2 + pad ? e : null);
    G.kinds.myth = {
      drops: 14, body: 2, hit: rect,
      // Its own two actions: every other round it puffs itself up while it winds up and breathes out slow
      // fat orbs instead of a ring ("puff", its first round too); badly hurt, and every third round after, it ducks
      // across to the other side ("dodge").
      update(G, e, dt) {
        e.dT -= dt; if (e.dT < 0 && e.move === "dodge") e.move = ""; e.off *= Math.exp(-dt * 0.25);
        const tx = G.W / 2 + Math.sin(e.t * 0.5) * G.W * 0.2 + e.off; e.x += (tx - e.x) * (1 - Math.exp(-dt * (e.dT > 0 ? 5 : 1.4))); e.y += (e.ty - e.y) * (1 - Math.exp(-dt * 1.6));
        e.ct += dt; const seq = [0, 1.5, 1.75, 2.0, 3.0];
        if (e.ct > 4.0 || (e.ct > 1.15 && e.ct < 1.5) || (e.ct > 2.65 && e.ct < 3)) act(e, "windup");
        if ((e.ct > 4.0 && e.cyc % 2) || (e.ct < 0 && !e.cyc)) { e.sx = e.sy = 1 + (e.ct < 0 ? e.ct + 0.6 : e.ct - 4) * 0.4; e.move = "puff"; }
        while (e.ci < seq.length && e.ct >= seq[e.ci]) {
          if (e.ci === 0 && e.cyc % 2 === 0) { ring(e.x, e.y, 9, S(80), 5); e.sx = e.sy = 1; e.move = ""; attack(e, "puff"); }
          else if (e.ci === 0 || e.ci === 4) ring(e.x, e.y, 14, 104, 1); else if (!near(e.x, e.y, 60)) fan(e.x, e.y + 10, 3, 0.22, 172, 0);
          act(e, "attack"); e.ci++;
        }
        if (e.act === "attack" && e.actT > 0.35) act(e, "idle");
        let hop = false;
        if (e.ct >= 4.4) { e.ct -= 4.4; e.ci = 0; hop = ++e.cyc % 3 === 2; }
        if (!e.hurt && e.hp < e.max * 0.6) hop = e.hurt = true;
        if (hop) { e.off = (e.x < G.W / 2 ? 1 : -1) * G.W * 0.26; e.dT = 0.8; e.move = "dodge"; attack(e, "dodge"); }
      },
      death(G, e) { G.res.myths.push(e.myth); G.addPick("c", e.x, e.y); G.emit("mythStruck", { e, myth: e.myth }); },
    };
    // The loop: a ring of drifters orbiting one hub, firing in turn like a loop body run once per
    // member. He shoots whatever is nearest, so the question is positional: one member is the weak
    // link (ringed, and labelled break / QED / rest / end); fly close enough that he aims at it, and
    // the whole loop breaks in order. The others are tough and only pop alone. The subject sets its beat:
    // maths fires along sine curves, music on the backing track's 124 bpm with a rest every fourth
    // beat, coding speeds up each lap like a runaway while True until you break it.
    G.kinds.loop = {
      drops: 2,
      update(G, e, dt) {
        const h = e.hub;
        if (h.T !== G.T) {
          h.T = G.T; h.t += dt; h.a += h.spin * dt; const k = 1 - Math.exp(-dt * 1.2);
          if (h.t > h.life) h.ty = -h.R - 90; h.x += (h.tx + Math.sin(h.t * 0.4) * 40 - h.x) * k; h.y += (h.ty - h.y) * k;
          h.cd -= dt;
          if (h.cd <= 0) {
            const f = h.m[h.next], beat = ++h.beat;
            if (h.sub === "music") h.cd += 60 / 124; else h.cd += CD(h.sub === "coding" ? Math.max(0.2, 0.5 - h.lap * 0.06) : 0.42);
            if (f && !f.dead && f.born <= 0 && ok(f) && !(h.sub === "music" && beat % 4 === 0)) {
              const a0 = aim(f.x, f.y);
              if (h.sub === "maths") shoot(f.x, f.y, a0, 135, 4, { amp: 22, w: 6.5 });
              else if (h.sub === "music" && beat % 4 === 1) fan(f.x, f.y, 2, 0.32, S(140), 0); // an even pair walls him in without touching him
              else shoot(f.x, f.y, a0, 150, 0);
              act(f, "attack");
            }
            let j = h.next; for (let i = 0; i < h.n; i++) { j = (j + 1) % h.n; if (!h.m[j].dead) break; } if (j <= h.next) h.lap++; h.next = j;
          }
        }
        e.x = h.x + Math.cos(h.a + (e.i * TAU) / h.n) * h.R; e.y = h.y + Math.sin(h.a + (e.i * TAU) / h.n) * h.R * 0.8;
        if (h.next === e.i && h.cd < 0.28) act(e, "windup"); else if (e.act === "attack" && e.actT > 0.25) act(e, "idle");
        if (h.t > h.life && e.y < -40) e.dead = 2;
      },
      death(G, e) {
        const h = e.hub; if (h.broken || !e.weak) return; h.broken = true; G.emit("attack", { e, kind: "break" });
        for (let k = 1; k < h.n; k++) { const o = h.m[(e.i + k) % h.n]; G.later(0.07 * k, () => G.kill(o)); }
      },
    };
    // The Wall of Text. A fight is a short story: each phase is one writing vice (a bullet pattern),
    // then a body move, then a punish window, and a clock that ends the phase if the player cannot.
    // Vices (patterns):
    //  Bullet points: aimed five-way fans, then a bulleted list falling as rows with an indented gap.
    //  Run-on sentence: one wavering stream whose commas are the gaps; it ends in full stops (fat orbs).
    //    In maths the stream follows y = sin(kx), k read from the lesson's own formula.
    //  Footnotes*: two spiral arms of asterisks, footnote markers that burst, and one torn rule falling
    //    with a sliding gap. It opens by summoning three numbered footnotes that orbit it as a shield.
    //  Fine print: the page is ruled. Dashed lines warn, then bite: find the space between the lines.
    // Moves (verbs, e.move names; each is telegraphed for at least 0.6 s):
    //  slam     rises over a column it marks, drops onto the composer; a wave runs both ways along the floor
    //  charge   goes to one edge, marks a lane across the arena at his height, and charges along it
    //  throw    picks real words off the lesson, holds them up, and throws them one at a time
    //  summon   footnotes ¹ ² ³ orbit it; while any is alive it takes 40% damage
    //  ibid     "Ibid.": repeats its previous move, 30% faster
    //  thesis   after every move it is winded and one line, highlighted, takes triple damage
    //  conclusion  "In conclusion…": it topples over, then "However," and it gets up (once; no damage lost)
    //  inhale   last stand, "Padding!": it sucks the loose words back in to restore its line, and grows,
    //           unless you keep it busy; then it chokes and coughs them out
    // Subject signatures (G.pack.id): coding hangs (everything stops, him too, for a heartbeat),
    // literature has a plot twist (every bullet in flight reverses), finance itemises (a receipt unrolls
    // into three torn rules, each with one sliding gap).
    const STAGES = ["Bullet points", "Run-on sentence", "Footnotes*", "Fine print"], CYCLE = [3.5, 5, 4.1, 4.4], CLOCK = 15;
    const SIG = { coding: "hang", literature: "twist", finance: "receipt" };
    const PLAN = [["throw", "slam"], ["charge", "ibid"], ["sig", "throw"], ["slam", "charge"]];
    const stageOf = (n, left) => (left <= 1 ? 3 : Math.min(2, Math.floor(((n - left) * 3) / n)));
    const beam = (x, y, ang, len) => fire(x, y, ang, 0, 6, { len, warn: 0.95 - 0.12 * R(), live: 0.42, keep: true, pierce: true, safe: true });
    const rule = (y, ph) => fire(G.W / 2, y, Math.PI / 2, S(62), 9, { keep: true, gw: 118, ph, gf: 1, amp: G.W * 0.3, gx: G.W / 2 });
    const say = (e, s) => G.J && G.J.pop(e.x, e.y - e.h / 2 - 16, s, G.pal.ink, 13, 1.4);
    const still = (e) => { e.rot = 0; e.sx = e.sy = e.alpha = 1; e.move = ""; e.vx = 0; };
    const ease = (e, x, y, k, dt) => { const q = 1 - Math.exp(-dt * k); e.x += (x - e.x) * q; e.y += (y - e.y) * q; };
    const home = (e, dt, k) => ease(e, G.W / 2 + Math.sin(e.t * 0.45) * Math.min(70, G.W * 0.12), e.ty, k || 3, dt);
    const xs = (e) => [e.w / 2 + 8, G.W - e.w / 2 - 8];
    const notes = (e) => e.notes.some((f) => !f.dead);
    // the line being struck out (bottom up), where the thesis highlight sits
    const band = (e) => { if (G.toy) return e.y; const n = e.lines.length, i = clamp(n - 1 - Math.floor((e.max - Math.max(0, e.hp)) / e.per), 0, n - 1); return e.y - e.h / 2 + 7 + e.lh * (i + 0.5); };
    const thaw = (e) => { if (e.frz) for (const b of e.frz) if (b.fz) { b.vx = b.fz[0]; b.vy = b.fz[1]; b.spd = b.fz[2]; b.fz = null; } e.frz = null; };
    const cough = (e) => { for (const w of e.eat) G.dropWord(w, e.x + rnd(-40, 40), e.y, rnd(-260, 260), rnd(-320, -80)); e.eat.length = 0; };
    function begin(e, m) {
      if (m === "sig") m = SIG[G.pack.id] || "slam";
      e.ms = 1; if (m === "ibid") { m = e.last || "slam"; e.ms = 1.3; say(e, "Ibid."); }
      if (m === "slam" || m === "charge" || m === "throw") e.last = m;
      e.mode = m; e.move = m; e.mt = 0; e.hit = 0; e.vy = 0; e.ly = null;
      if (m === "slam") e.tx = clamp(G.P.x, ...xs(e));
      if (m === "charge") e.side = G.P.x > G.W / 2 ? 0 : 1;
      if (m === "thesis") { e.hold = false; act(e, "idle"); G.emit("thesis", { e }); return; }
      if (m === "throw") {
        e.held = []; const n = 4 + (R() > 0.4 ? 1 : 0), sp = Math.min(72, G.W / (n + 1));
        for (let i = 0; i < n; i++) {
          const w = G.takeWord(e.x, e.y + e.h / 2, 560); if (!w) break;
          const b = fire(w.x, w.y, 0, 0, 8, { safe: true, keep: true, ref: w.ref, text: w.text, font: w.font.replace(/^(\S+) \S+/, "$1 700"), ww: w.w, wh: w.h, hx: e.x + (i - (n - 1) / 2) * sp, hy: e.y + e.h / 2 + 26 + (i % 2) * 14 });
          if (b) e.held.push(b); else G.dropWord(w.ref, w.x, w.y, 0, 0);
        }
      }
      if (m === "inhale") { e.eat = e.eat || []; e.dmgIn = 0; e.hold = true; e.floor = 6; say(e, "Padding!"); }
      if (m === "conclusion") { say(e, "In conclusion…"); e.dir = G.P.x < e.x ? -1 : 1; G.emit("conclusion", { e }); }
      act(e, "windup", m !== "conclusion");
    }
    function abort(e) { thaw(e); if (e.eat) cough(e); still(e); e.mode = "pat"; e.ct = -0.6; e.rounds = 0; }
    function phase(e, stage, first) {
      const n = e.lines.length; let l = Math.ceil(e.hp / e.per);
      e.stage = stage; e.ct = -1.1; e.ci = 0; e.sw = 0; e.rounds = 0; e.ml = 0; e.mode = "pat"; e.clk = CLOCK; still(e); act(e, "windup", true);
      // he will not be cut off mid-vice: each one holds its last line until its first thesis window
      while (l > 0 && stageOf(n, l) === stage) l--; e.end = l * e.per; e.floor = e.end + 30; e.hold = true;
      const oy = e.y + e.h / 2 + 4; G.cancelBullets(true); G.knock(e.x, oy, first ? 120 : 190, 300);
      G.emit("bossPhase", { e, stage, first, name: STAGES[stage], line: e.lines[Math.ceil(e.hp / e.per)] || "", x: e.x, y: oy });
      if (stage === 2) begin(e, "summon");
    }
    // one round of a vice; returns true when the round is over
    function vice(e, stage, t, at, dt) {
      const ox = e.x, oy = e.y + e.h / 2 + 4, W = G.W, H = G.H;
      if (t > 0 && e.act === "windup") act(e, "attack");
      if (stage === 0) {
        if (at(0.15) || at(0.4) || at(0.65)) { fan(ox, oy, 5, 0.21, S(168), 1); if (at(0.15)) attack(e, "fan"); }
        if (at(1.3)) { e.gx = clamp(G.P.x + rnd(-80, 80), 70, W - 70); act(e, "windup", true); }
        for (const r of [1.5, 1.9, 2.3]) if (at(r)) { // each row of the list, indented a little further
          if (r === 1.5) attack(e, "list"); else e.gx = clamp(e.gx + (Math.random() < 0.5 ? -46 : 46), 70, W - 70);
          for (let x = 12; x < W; x += 28) if (Math.abs(x - e.gx) > 56) fire(x, oy, Math.PI / 2, S(108), 0);
        }
        return t >= 3.5;
      }
      if (stage === 1) {
        if (t >= 0 && t < 3.6 && t % 1.2 < 0.92) { // the commas are the gaps
          if (at(0.01)) attack(e, "stream");
          e.sw -= dt;
          while (e.sw <= 0) {
            e.sw += CD(0.06);
            if (e.kf) { const b = fire(ox, oy, Math.PI / 2, S(170), 4, { amp: 30 }); if (b) b.w = (e.kf * b.spd) / 60; } // x = sin(k·y/60): the formula drawn in bullets
            else fire(ox, oy, Math.PI / 2 + Math.sin(t * 1.6) * 1.1, S(190), 4, { amp: 12, w: 9 });
          }
        }
        if (at(3.4)) act(e, "windup", true);
        if (at(3.8)) { fan(ox, oy, 3, 0.5, S(92), 5); attack(e, "stop"); }
        return t >= 5;
      }
      if (stage === 2) {
        if (t >= 0 && t < 2.6) { e.sw -= dt; while (e.sw <= 0) { e.sw += CD(0.078); e.a += 0.29; fire(ox, oy, e.a, S(122), 3); fire(ox, oy, e.a + Math.PI, S(122), 3); } }
        for (const r of [0.6, 1.4, 2.2]) if (at(r)) { fire(ox, oy, aim(ox, oy) + rnd(-0.3, 0.3), 190, 7, { fuse: 1, n: 8, bs: S(88) }); attack(e, "shell"); }
        if (at(2.8)) { ring(ox, oy, 14, S(80), 1); rule(oy + 10, rnd(TAU)); attack(e, "rule"); }
        return t >= 4.1;
      }
      if (at(0)) { const sp = 72, y0 = H * 0.36 + rnd(sp); for (let y = y0; y < H - 20; y += sp) beam(0, y, 0, W); attack(e, "beam"); }
      if (at(1.55)) { const sp = 92, x0 = rnd(20, sp); for (let x = x0; x < W - 10; x += sp) beam(x, oy + 8, Math.PI / 2, H); attack(e, "beam"); }
      if (at(3.0)) { fan(ox, oy, 3, 0.42, S(96), 5); attack(e, "stop"); }
      return t >= 4.4;
    }
    // Moves return "thesis" (a punish window follows), "pat" (back to the vice) or nothing (still going).
    const MOVES = {
      slam(G, e, t, dt) {
        const fl = G.floorY - e.h / 2 + 6;
        if (t < 0.9) { ease(e, e.tx, e.ty - 30, 5, dt); e.sy = 1 + 0.1 * t; return; }
        if (!e.hit) {
          act(e, "attack"); e.vy += (G.calm ? 1300 : 3200) * dt; e.y += e.vy * dt; e.x = e.tx;
          if (e.y >= fl) { e.y = fl; e.hit = t; e.sy = 0.86; attack(e, "slam"); for (const s of [-1, 1]) fire(e.x + s * (e.w / 2 - 10), G.floorY, s > 0 ? 0 : Math.PI, S(G.calm ? 150 : 215), 10); }
          return;
        }
        e.sy += (1 - e.sy) * (1 - Math.exp(-dt * 6));
        if (t > e.hit + 0.8) home(e, dt, 4);
        if (t > e.hit + 1.7) return "thesis";
      },
      charge(G, e, t, dt) {
        const [l, r] = xs(e), x0 = e.side ? r : l, x1 = e.side ? l : r, D = G.calm ? 1.2 : 0.7;
        if (t < 0.35) { ease(e, x0, e.ty, 6, dt); return; }
        if (e.ly === null) e.ly = clamp(G.P.y, G.H * 0.34, G.floorY - e.h / 2 - 8);
        if (t < 1.25) { ease(e, x0, e.ly, 6, dt); return; }
        if (t < 1.25 + D) {
          if (!e.hit) { e.hit = 1; e.ang = x1 > x0 ? 0 : Math.PI; attack(e, "charge"); }
          const k = (t - 1.25) / D; e.x = lerp(x0, x1, k * k * (3 - 2 * k)); e.y = e.ly; e.vx = (x1 - x0) / D; return;
        }
        e.vx = 0; if (t > 1.65 + D) home(e, dt, 4);
        if (t > 2.5 + D) return "thesis";
      },
      throw(G, e, t, dt, at) {
        home(e, dt, 2);
        if (!e.held.length) { if (at(0.9)) { fan(e.x, e.y + e.h / 2, 3, 0.4, S(96), 5); attack(e, "stop"); } return t > 1.8 ? "thesis" : undefined; }
        for (let i = 0; i < e.held.length; i++) if (at(0.9 + i * 0.3)) {
          const b = e.held[i]; if (!i) attack(e, "throw");
          if (near(b.x, b.y, 70)) { b.dead = true; G.dropWord(b.ref, b.x, b.y, 0, 0); continue; } // never point-blank
          const a = aim(b.x, b.y), v = S(235) * (1 - 0.15 * G.mercy); b.safe = false; b.vx = Math.cos(a) * v; b.vy = Math.sin(a) * v;
        }
        if (t > 1.5 + e.held.length * 0.3) return "thesis";
      },
      summon(G, e, t, dt, at) {
        home(e, dt);
        if (at(0.7)) {
          e.notes = []; attack(e, "summon");
          for (let i = 0; i < 3; i++) e.notes.push(G.spawn(G.mk("note", e.x, e.y, { look: "drift", boss: e, a: (i * TAU) / 3, sym: "¹²³"[i], r: 12, hp: 7, pts: 150, cd: 1.4 + i * 0.7, born: 0.45 })));
        }
        if (t > 1.2) return "pat";
      },
      thesis(G, e, t, dt) { home(e, dt); e.sy = 0.95 + 0.03 * Math.sin(t * 5); if (t > 2.4) return "pat"; },
      // coding: the mainframe hangs. Two rings, "(Not Responding)", then every bullet stops, and so
      // does he for a heartbeat; it takes double damage while it is hung.
      hang(G, e, t, dt, at) {
        home(e, dt);
        if (at(0.05)) { ring(e.x, e.y, 14, S(115), 0); ring(e.x, e.y, 14, S(78), 0); attack(e, "ring"); }
        if (at(0.6)) { act(e, "windup", true); say(e, "(Not Responding)"); }
        if (t > 0.6) e.alpha = 0.7;
        if (at(1.6)) { e.frz = G.bul.slice(); for (const b of e.frz) { b.fz = [b.vx, b.vy, b.spd]; b.vx = b.vy = b.spd = 0; } attack(e, "hang"); }
        if (e.frz) { for (const b of e.frz) b.t -= dt; if (t < 1.95) G.P.mire = G.calm ? 0.3 : 0.6; }
        if (at(3.3)) { thaw(e); e.alpha = 1; attack(e, "resume"); }
        if (t > 3.5) return "thesis";
      },
      // literature: a ring goes out, "Plot twist!", and everything in flight turns round
      twist(G, e, t, dt, at) {
        home(e, dt);
        if (at(0.05)) { ring(e.x, e.y, 20, S(165), 1); attack(e, "ring"); }
        if (at(0.4)) { act(e, "windup", true); say(e, "Plot twist!"); }
        if (at(1.6)) { for (const b of G.bul) if (b.k < 6 && !b.safe) { b.vx = -b.vx; b.vy = -b.vy; if (b.ux !== undefined) { b.ux = -b.ux; b.uy = -b.uy; } } e.sx = -1; attack(e, "twist"); }
        if (t > 2.6) e.sx = 1;
        if (t > 2.8) return "thesis";
      },
      // finance: the receipt unrolls; three torn rules fall, each with one gap that slides
      receipt(G, e, t, dt, at) {
        home(e, dt); e.sy = t < 3.6 ? 1 + 0.2 * Math.min(1, t / 0.8) : 1;
        if (at(0.05)) say(e, "Itemised");
        for (const r of [0.8, 2.0, 3.2]) if (at(r)) { rule(e.y + e.h / 2 + 10, r * 2.1); attack(e, "receipt"); }
        if (t > 4.2) return "thesis";
      },
      conclusion(G, e, t, dt, at) {
        if (t < 1.5) { const k = Math.min(1, t / 0.45); e.rot = 0.5 * k * e.dir; e.sy = 1 - 0.12 * k; ease(e, e.x, e.ty + 40, 3, dt); return; }
        if (at(1.5)) { say(e, "However,"); attack(e, "however"); }
        e.rot *= Math.exp(-dt * 14); e.sy = 1 + 0.14 * Math.exp(-(t - 1.5) * 6); home(e, dt, 5);
        if (t > 1.95) { still(e); phase(e, 3, false); }
      },
      inhale(G, e, t, dt) {
        home(e, dt);
        if (t < 0.6) return;
        if (e.act === "windup") attack(e, "inhale");
        for (const w of G.words) if (w.st === 1 && !w.taken && e.eat.length < 14) {
          const dx = e.x - w.x, dy = e.y - w.y, d = Math.hypot(dx, dy) || 1;
          if (d < 36) { w.taken = true; e.eat.push(w); e.hp = Math.min(e.hp + 3, e.per * 0.75); G.emit("eat", { e, x: w.x, y: w.y }); } else { w.rest = false; w.vx = (dx / d) * 430; w.vy = (dy / d) * 430; }
        }
        e.sx = e.sy = 1 + Math.min(0.24, e.eat.length * 0.02);
        if (e.dmgIn >= 34) { cough(e); say(e, "*cough*"); e.hold = false; return "thesis"; }
        if (t > 3) { e.hold = false; e.eat.length = 0; return "pat"; }
      },
    };
    const AIM = { x: 0, y: 0 };
    // while a phase holds its last line, no blow (not even a Eureka) can carry it past the hold
    const cap = (e, d) => (e.hold ? Math.max(0, Math.min(d, e.hp - e.floor)) : d);
    G.kinds.wall = {
      drops: 40, body: 2,
      hit: (G, e, x, y, pad) => (rect(G, e, x, y, pad) ? AIM : null),
      hitPart(G, e, part, d, x, y, ang) {
        const m = e.mode === "thesis" && Math.abs(y - band(e)) < 14 ? 3 : e.frz ? 2 : notes(e) ? 0.4 : 1;
        if (e.mode === "inhale") e.dmgIn += d * m;
        G.hurtFoe(e, cap(e, d * m), x, y, ang);
      },
      // his aim goes to the highlighted thesis while it is open
      aimAt(G, e) { if (e.mode !== "thesis") return e; AIM.x = e.x; AIM.y = band(e); return AIM; },
      // the demo pilot reads ruled lines, marked columns and lanes, its body, and torn rules ahead of him
      threat(G, e, x, y) {
        let s = 0;
        for (const b of G.bul) {
          if (b.k === 6) { const ux = Math.cos(b.ang), uy = Math.sin(b.ang), qx = x - b.x, qy = y - b.y, al = qx * ux + qy * uy; if (al > -12 && al < b.len + 12 && Math.abs(qx * uy - qy * ux) < 24) s += 240; }
          else if (b.k === 10 && y > G.floorY - 34 && (x - b.x) * b.vx > -30 && Math.abs(x - b.x) < 170) s += 60 + (y - G.floorY + 34) * 3; // a floor wave coming his way: worse the lower he is
          else if (b.k === 9 && y > b.y - 8 && y < b.y + 70 && Math.abs(x - b.gx) > b.gw / 2 - 14) s += 110 + Math.min(300, Math.abs(x - b.gx)) * 0.45;
        }
        // scores stay under the pilot's bomb threshold and slope towards the way out
        const cx = e.w / 2 + 26 - Math.abs(x - e.tx), ly = e.h / 2 + 30 - Math.abs(y - e.ly);
        if (e.mode === "slam" && !e.hit && cx > 0) s += 110 + cx * 0.5;
        if (e.mode === "charge" && e.ly !== null && (!e.hit || e.vx) && ly > 0) s += 110 + ly * 0.8;
        if ((e.mode === "slam" || e.mode === "charge") && Math.abs(x - e.x) < e.w / 2 + 30 && Math.abs(y - e.y) < e.h / 2 + 30) s += 150;
        return s;
      },
      update(G, e, dt) {
        if (e.stage < 0) { home(e, dt, 1.8); if (e.y < e.ty - 26) return; }
        const n = e.lines.length, stage = stageOf(n, Math.ceil(e.hp / e.per));
        if (stage !== e.stage && e.mode !== "conclusion") {
          abort(e);
          if (stage === 3 && !e.faked && e.stage >= 0) { e.faked = 1; e.stage = 3; e.hold = true; e.floor = e.per * 0.6; G.cancelBullets(true); begin(e, "conclusion"); }
          else phase(e, stage, e.stage < 0);
          return;
        }
        if (e.hold && e.hp < e.floor) e.hp = e.floor;
        if (stage === 3 && e.faked && !e.stood && e.hp < e.per * 0.5 && e.clk < CLOCK - 5 && e.mode !== "conclusion") { e.stood = 1; abort(e); begin(e, "inhale"); }
        // the clock: a phase the player cannot end ends by itself, so a weak run still finishes
        if (e.mode !== "conclusion" && (e.clk -= dt) <= 0) {
          e.clk = CLOCK; e.hold = false;
          if (stage < 3) { say(e, "[cut for length]"); e.hp = Math.min(e.hp, e.end); } else { say(e, "Word limit."); G.hurtFoe(e, e.hp + 1); }
          return;
        }
        if (e.mode === "pat") {
          home(e, dt); const ct0 = e.ct; e.ct += dt;
          if (vice(e, stage, e.ct, (s) => ct0 < s && e.ct >= s, dt)) { e.ct = -0.01; if (++e.rounds >= 1) { const p = PLAN[stage]; begin(e, p[e.ml++ % p.length]); } }
          return;
        }
        const t0 = e.mt; e.mt += dt * e.ms; const t = e.mt, nx = MOVES[e.mode](G, e, t, dt, (s) => t0 < s && t >= s);
        if (nx) { still(e); if (nx === "thesis") begin(e, "thesis"); else { e.mode = "pat"; e.ct = -0.5; e.rounds = 0; act(e, "windup"); } }
      },
      bombed(G, e) { G.hurtFoe(e, cap(e, 40)); },
      death(G, e) { thaw(e); if (e.eat) cough(e); for (const f of e.notes) f.dead = 2; G.boss = null; G.cancelBullets(true); G.knock(e.x, e.y, 330, 420); G.tldr = { x: G.W / 2, y: e.y, t: 0 }; G.fx.speed = 0.3; G.emit("bossDeath", { e }); },
    };
    // a footnote: orbits the boss as a shield and fires a slow dot now and then
    G.kinds.note = {
      drops: 2,
      update(G, e, dt) {
        const b = e.boss; if (!b || b.dead) { e.dead = 2; return; }
        e.a += dt * 1.1; e.x = b.x + Math.cos(e.a) * (b.w / 2 + 22); e.y = b.y + Math.sin(e.a) * (b.h / 2 + 20); e.cd -= dt;
        if (e.cd <= 0.35 && e.cd > 0) act(e, "windup");
        if (e.cd <= 0) { e.cd = CD(2.4); if (ok(e)) shoot(e.x, e.y, aim(e.x, e.y), 130, 0); act(e, "attack"); } else if (e.act === "attack" && e.actT > 0.3) act(e, "idle");
      },
    };
    // what the fight draws over everything: the clock, the slam column, the charge lane, the thesis
    G.hook("draw.over", (env) => {
      const e = G.boss, c = G.c, p = env.pal; if (!e || e.dead || e.stage < 0) return;
      c.save(); c.lineWidth = 2; c.strokeStyle = p.faint; c.globalAlpha = 0.55;
      c.beginPath(); c.ellipse(e.x, e.y, e.w / 2 + 14, e.h / 2 + 14, 0, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(e.clk / CLOCK, 0, 1)); c.stroke();
      c.globalAlpha = 1; c.setLineDash([8, 6]); c.lineDashOffset = -env.T * 30; c.strokeStyle = p.red; c.lineWidth = 1.6; c.beginPath();
      if (e.mode === "slam" && !e.hit) for (const s of [-1, 1]) { c.moveTo(e.tx + (s * e.w) / 2, e.y + e.h / 2); c.lineTo(e.tx + (s * e.w) / 2, G.floorY); }
      if (e.mode === "charge" && e.ly !== null && !e.hit) for (const s of [-1, 1]) { c.moveTo(0, e.ly + (s * e.h) / 2); c.lineTo(G.W, e.ly + (s * e.h) / 2); }
      c.stroke(); c.setLineDash([]);
      if (e.mode === "thesis") {
        const y = band(e); c.globalAlpha = 0.3; c.fillStyle = p.green; c.fillRect(e.x - e.w / 2 + 4, y - 9, e.w - 8, 18);
        c.globalAlpha = 1; c.font = "600 10px " + RecessArt.MONO; c.textAlign = "right"; c.textBaseline = "bottom"; c.fillStyle = p.green; c.fillText("thesis ×3", e.x + e.w / 2 - 4, y - 10);
      }
      c.restore();
    });

    // ── makers ──
    function mkWorm(x, y, born) {
      const txt = G.pack.worm, n = Math.min(11, txt.length);
      const e = G.mk("worm", x, y, { r: 13, hp: 16, pts: 500, segs: [], hist: [], ph: rnd(TAU), y0: 84, cd: 1.2, cd2: 2.2, born: born ? 0.5 : 0, x0: x, ys: y, acc: 0 });
      for (let i = 0; i < n; i++) e.segs.push({ ch: txt[i], hp: 4, alive: true, x, y, flash: 0 });
      for (let i = 0; i < n * 8 + 12; i++) e.hist.push([x, y]);
      return e;
    }
    function mkMyth(i, x, y, born) {
      const m = G.pack.myths[i % G.pack.myths.length]; G.c.font = "italic 600 13px " + SERIF; const tw = G.c.measureText(m.wrong).width;
      return G.mk("myth", x, y, { w: tw + 50, h: 38, r: 24, hp: 125, pts: 1500, myth: m, tw, ty: G.H * 0.2, ct: -0.6, ci: 0, cyc: 0, off: 0, dT: 0, born: born ? 0.6 : 0 });
    }
    function spawnBoss() {
      const lines = G.pack.wall, w = Math.min(G.W - 60, 360);
      let kf = 0; for (const m of G.pack.thread || []) { const r = /sin\((\d*)x\)/.exec(m.code || ""); if (r) { kf = +(r[1] || 1); break; } } // the lesson's own sin(kx)
      const e = G.mk("wall", G.W / 2, -100, { w, lh: 17, lines, h: lines.length * 17 + 14, r: 60, hp: lines.length * 120, per: 120, pts: 5000, ty: Math.max(92, G.H * 0.2), ct: 0, ci: 0, a: Math.PI / 2, sw: 0, stage: -1, mode: "pat", clk: CLOCK, notes: [], eat: [], kf });
      if (G.toy) { e.w = 150; e.h = 150; e.ty = Math.max(104, G.H * 0.21); }
      G.boss = G.spawn(e); G.fx.speed = 0.62; G.emit("bossSpawn", { e });
    }

    const WEAK = { coding: "break", maths: "QED", music: "rest" };
    // the weak link's ring: a slow dashed circle, in the bullets' red so it reads as "this one"
    G.hook("draw.back", (env) => {
      for (const e of G.foes) if (e.weak && e.born <= 0 && !e.dead) for (const c of env.dark ? [G.c, G.em] : [G.c]) {
        c.save(); c.setLineDash([5, 5]); c.lineDashOffset = env.T * 18; c.strokeStyle = env.pal.red; c.lineWidth = 2; c.beginPath(); c.arc(e.x, e.y, e.r + 8, 0, TAU); c.stroke(); c.restore();
      }
    });
    function mkLoop() {
      const W = G.W, H = G.H, n = R() > 0.5 ? 7 : 6, R0 = Math.min(78, W * 0.14), cx = G.P.x < W / 2 ? W * 0.7 : W * 0.3;
      const h = { x: cx, y: H * 0.27, tx: cx, ty: H * 0.27, R: R0, n, a: -Math.PI / 2, spin: 0.7, t: 0, life: 13, cd: 0.9, next: 0, beat: 0, lap: 0, m: [], T: -1, sub: subj() };
      for (let i = 0; i < n; i++) {
        const a = h.a + (i * TAU) / n;
        h.m.push(G.spawn(G.mk("loop", h.x + Math.cos(a) * R0, h.y + Math.sin(a) * R0 * 0.8, { look: "drift", hub: h, i, r: 13, hp: i ? 16 : 6, pts: 120, weak: !i, sym: i ? G.pack.drift[i % G.pack.drift.length] : WEAK[h.sub] || "end", born: 0.35 + i * 0.07 })));
      }
    }

    // ── the wave script ──
    function script(scene) {
      let si = 0, wait = null; const W = () => G.W, H = () => G.H;
      const OPS = {
        say(t) { G.label = t; G.emit("say", { text: t }); },
        wait(s) { let r = s; wait = (dt) => (r -= dt) <= 0; },
        clear(s) { let r = s; wait = (dt) => { r -= dt; return r <= 0 || (G.foes.length === 0 && G.timers.length === 0); }; },
        // a line of drifters coming in from one edge (L, R, T, B or far) and crossing the arena
        drift(a) {
          const s = side(a.from), n = a.n + (R() > 0.5 ? 1 : 0);
          for (let i = 0; i < n; i++) G.later(i * 0.28, () => { const p = entry(s, i, n), sp = rnd(62, 80); G.spawn(G.mk("drift", p.x, p.y, { bx: p.x, by: p.y, sp, vx: Math.cos(p.a) * sp, vy: Math.sin(p.a) * sp, w: rnd(1.3, 1.9), amp: rnd(26, 46), sym: G.pack.drift[i % G.pack.drift.length], cd: rnd(0.9, 1.9), hp: 3, pts: 100 })); });
        },
        // chargers, each from its own edge away from the bot; they stop just inside it to aim
        dart(n) { for (let i = 0; i < n; i++) G.later(i * 0.45, () => { const s = side("far"), p = entry(s, (rnd(3)) | 0, 3), d = rnd(70, 120); G.spawn(G.mk("dart", p.x, p.y, { tx: p.x + Math.cos(p.a) * d, ty: clamp(p.y + Math.sin(p.a) * d, 40, G.H * 0.55), ph: 0, pt: 0, sym: G.pack.dart, hp: 4, pts: 200, r: 16, ang: p.a })); }); },
        loop() { mkLoop(); },
        mark() {},
        spin() { G.fromTerm("spin", (x0, y0, born) => { const [x, y] = away(x0, y0); G.spawn(G.mk("spin", x, y, { ty: Math.max(96, H() * 0.24), tx: clamp(x, 90, W() - 90), r: 22, hp: 44, pts: 500, sym: G.pack.spin, rot: 0, dir: 1, a: rnd(TAU), cd: 0, ph: 0, pt: 0, life: 0, born: born ? 0.5 : 0 })); }); },
        split() { G.spawn(G.mk("split", rnd(100, W() - 100), -36, { vx: Math.random() < 0.5 ? -58 : 58, vy: 56, r: 30, hp: 18, pts: 300, sym: G.pack.split[0], kids: [G.pack.split[1], G.pack.split[2]], cd: 1.5 })); },
        worm() { G.fromTerm("worm", (x, y, born) => G.spawn(mkWorm(...away(x, y), born))); },
        myth(i) { if (G.pack.myths.length) G.fromTerm("myth", (x, y, born) => G.spawn(mkMyth(i, ...away(x, y), born))); },
        gates(i) { G.startGates(i); wait = () => !G.gates; },
        explain() { if (G.startExplain && G.startExplain()) wait = () => G.state !== "pause"; },
        boss() { spawnBoss(); wait = () => !G.boss; },
        end() { G.finish(true); },
      };
      // Tension, then rest: the gates are the rest. The first twenty seconds teach moving (gentle
      // drifters from the left, the right, then above) and that he aims by himself.
      const all = [["say", "Recess · " + G.pack.label], ["wait", 0.6], ["drift", { n: 4, from: "L" }], ["wait", 3], ["drift", { n: 4, from: "R" }], ["wait", 2.8], ["drift", { n: 5, from: "T" }], ["wait", 3.4],
        ["dart", 2], ["wait", 1.4], ["spin"], ["wait", 3.6], ["drift", { n: 4, from: "far" }], ["drift", { n: 3, from: "T" }], ["clear", 11],
        ["mark", "gates"], ["wait", 0.5], ["gates", 0], ["wait", 0.4],
        ["say", "Wave 2"], ["split"], ["wait", 3], ["dart", 3], ["wait", 2.6], ["worm"], ["wait", 4.5], ["loop"], ["wait", 3], ["drift", { n: 4, from: "far" }], ["clear", 14],
        // A pack may carry up to four gate questions; a slot with no question skips itself at once.
        ["wait", 0.5], ["gates", 1], ["wait", 0.4],
        ["mark", "myth"], ["myth", 0], ["wait", 5], ["drift", { n: 4, from: "far" }], ["clear", 18],
        ["wait", 0.5], ["gates", 2], ["wait", 0.4],
        // The one open question, when the pack has one: a breather before the last stretch.
        ["mark", "explain"], ["explain"], ["wait", 0.4], ["drift", { n: 4, from: "T" }], ["clear", 8],
        ["wait", 0.5], ["gates", 3], ["wait", 0.5],
        ["mark", "boss"], ["say", (G.pack.boss && G.pack.boss.name) || "The Wall of Text"], ["wait", 1.1], ["boss"], ["wait", 2.8], ["end"]];
      // scenes let the mockup page jump straight to one part of the run
      const at = all.findIndex((s) => s[0] === "mark" && s[1] === scene), steps = at < 0 ? all : all.slice(at);
      return {
        step(dt) {
          if (wait) { if (wait(dt)) wait = null; else return; }
          while (si < steps.length && !wait && G.state === "play") { const s = steps[si++]; OPS[s[0]](s[1]); }
        },
      };
    }
    G.patterns = { script, mkWorm, mkMyth, mkLoop, spawnBoss, get rank() { return rk; } };
}
export const RecessPatterns = { script: (G, scene) => G.patterns.script(scene) };
