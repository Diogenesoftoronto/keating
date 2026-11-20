// Recess bullets: how each kind of enemy bullet moves and how it is drawn.
// Owner: the patterns lane. Readability comes first: a bullet must stand out from the page,
// the enemies and the bot's own shots at a glance, in both themes.
//
// A bullet kind is G.bullets[key] = {
//   r,                              hit radius in CSS px (the bot's own hit dot is 3 px)
//   draw(c, list, env, glow),       draw every bullet of this kind; called again with glow = true
//                                   for the emissive layer (set glow: false on the kind to skip that)
//   move(G, b, dt),                 optional: replaces straight-line motion
//   hits(G, b, px, py),             optional: replaces the circle test against the bot
// }
// Bullet fields set by G.fire: x, y, vx, vy, r, k, t (age), a (a random angle), spd, ang, gz (grazed).
// Optional flags core respects: safe (cannot hit yet), pierce (survives a hit), keep (not culled off screen).
//
// Kinds: 0 dot (aimed shots), 1 point (rings and fans), 2 dash (streams), 3 asterisk (footnotes),
// 4 tick (curves along a sine: a pointed shape so its heading shows), 5 orb (slow, fat, hollow:
// a full stop), 6 beam (a ruled line: dashed and harmless while it warns, solid when it bites),
// 7 shell (an amber seed with a shrinking ring that bursts into dots when the ring closes),
// 8 word (a real word off the lesson, thrown), 9 rule (a torn line with one sliding gap), 10 ripple (a slam's floor wave).
// Every kind differs in SHAPE as well as colour, so it reads on paper, in phosphor and in grey.
export function install(G) {
    const TAU = G.TAU, spr = {}; let key = "";
    function sprites() {
      const k = G.theme + ":" + G.dpr; if (k === key) return; key = k;
      const pal = G.pal, dark = G.dark, dpr = G.dpr;
      const mk = (r, col, pad) => {
        const s = Math.ceil((r + pad) * 2), cv = document.createElement("canvas"); cv.width = cv.height = s * dpr; const x = cv.getContext("2d"); x.scale(dpr, dpr); const m = s / 2;
        if (dark) { const gr = x.createRadialGradient(m, m, 0, m, m, r + pad); gr.addColorStop(0, "#fff"); gr.addColorStop(0.3, col); gr.addColorStop(0.6, col + "aa"); gr.addColorStop(1, col + "00"); x.fillStyle = gr; x.beginPath(); x.arc(m, m, r + pad, 0, TAU); x.fill(); }
        else { x.beginPath(); x.arc(m, m, r, 0, TAU); x.fillStyle = col; x.fill(); x.lineWidth = 1.4; x.strokeStyle = pal.ink; x.stroke(); x.beginPath(); x.arc(m - r * 0.25, m - r * 0.25, r * 0.34, 0, TAU); x.fillStyle = pal.core; x.fill(); }
        cv._s = s; return cv;
      };
      spr.dot = mk(4, pal.red, dark ? 5 : 2); spr.point = mk(6, pal.amber, dark ? 6 : 2);
      // the orb: a hollow red O with a light middle, twice a dot's size
      const s = 26, cv = document.createElement("canvas"), x = cv.getContext("2d"); cv.width = cv.height = s * dpr; x.scale(dpr, dpr);
      if (dark) { const gr = x.createRadialGradient(13, 13, 5, 13, 13, 13); gr.addColorStop(0, pal.red + "00"); gr.addColorStop(0.55, pal.red + "cc"); gr.addColorStop(1, pal.red + "00"); x.fillStyle = gr; x.fillRect(0, 0, s, s); }
      x.beginPath(); x.arc(13, 13, 8, 0, TAU); x.fillStyle = dark ? pal.paper : pal.core; x.fill(); x.lineWidth = 3.4; x.strokeStyle = pal.red; x.stroke();
      if (!dark) { x.lineWidth = 1.2; x.strokeStyle = pal.ink; x.beginPath(); x.arc(13, 13, 9.9, 0, TAU); x.stroke(); }
      cv._s = s; spr.orb = cv;
    }
    const stamp = (name) => (c, list) => { sprites(); const im = spr[name], s = im._s; for (const b of list) c.drawImage(im, b.x - s / 2, b.y - s / 2, s, s); };
    // many short strokes in one path: len is half the stroke length, star draws three crossing strokes
    const strokes = (c, list, len, wd, col, star) => {
      c.beginPath();
      for (const b of list) {
        if (!star) { const l = Math.hypot(b.vx, b.vy) || 1, ux = (b.vx / l) * len, uy = (b.vy / l) * len; c.moveTo(b.x - ux, b.y - uy); c.lineTo(b.x + ux, b.y + uy); }
        else for (let i = 0; i < 3; i++) { const a = b.a + (i * Math.PI) / 3, ux = Math.cos(a) * len, uy = Math.sin(a) * len; c.moveTo(b.x - ux, b.y - uy); c.lineTo(b.x + ux, b.y + uy); }
      }
      c.lineWidth = wd; c.strokeStyle = col; c.lineCap = "round"; c.stroke();
    };
    G.bullets[0] = { r: 4, name: "dot", draw: stamp("dot") };
    G.bullets[1] = { r: 6, name: "point", draw: stamp("point") };
    G.bullets[2] = { r: 3.5, name: "dash", draw(c, list, env, glow) { const p = env.pal; if (!env.dark && !glow) strokes(c, list, 6, 7, p.ink); strokes(c, list, 6, 4.6, p.red); strokes(c, list, 4.5, 1.6, p.core); } };
    G.bullets[3] = {
      r: 5, name: "asterisk",
      move(G, b, dt) { b.x += b.vx * dt; b.y += b.vy * dt; b.a += dt * 5; },
      draw(c, list, env, glow) { const p = env.pal; if (!env.dark && !glow) strokes(c, list, 6, 4.6, p.ink, true); strokes(c, list, 6, 2.6, p.amber, true); },
    };
    // tick: rides a sine wave across its heading (b.amp px, b.w rad/s). bx, by is the unwaved path.
    G.bullets[4] = {
      r: 4, name: "tick",
      move(G, b, dt) {
        if (b.bx === undefined) { b.bx = b.x; b.by = b.y; b.ux = b.vx / b.spd; b.uy = b.vy / b.spd; }
        b.bx += b.ux * b.spd * dt; b.by += b.uy * b.spd * dt;
        const o = Math.sin(b.t * (b.w || 6)) * (b.amp || 26), d = Math.cos(b.t * (b.w || 6)) * (b.amp || 26) * (b.w || 6);
        b.x = b.bx - b.uy * o; b.y = b.by + b.ux * o; b.vx = b.ux * b.spd - b.uy * d; b.vy = b.uy * b.spd + b.ux * d; // vx, vy stay true for the pilot and for drawing
      },
      draw(c, list, env, glow) {
        const p = env.pal; c.beginPath();
        for (const b of list) { const l = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / l, uy = b.vy / l; c.moveTo(b.x + ux * 7, b.y + uy * 7); c.lineTo(b.x - uy * 4, b.y + ux * 4); c.lineTo(b.x - ux * 4, b.y - uy * 4); c.lineTo(b.x + uy * 4, b.y - ux * 4); c.closePath(); }
        c.fillStyle = p.red; c.fill(); if (!env.dark && !glow) { c.lineWidth = 1.3; c.strokeStyle = p.ink; c.stroke(); }
        if (!glow) { c.fillStyle = p.core; for (const b of list) c.fillRect(b.x - 1.2, b.y - 1.2, 2.4, 2.4); }
      },
    };
    G.bullets[5] = { r: 8, name: "orb", draw: stamp("orb") };
    // beam: x, y is one end, ang its direction, len its length. warn seconds dashed, then live seconds solid.
    const BW = 5; // half the width of a live beam's bite
    G.bullets[6] = {
      r: BW, name: "beam",
      move(G, b, dt) { b.safe = b.t < b.warn; if (b.t > b.warn + b.live) b.dead = true; },
      hits(G, b, px, py) { const ux = Math.cos(b.ang), uy = Math.sin(b.ang), qx = px - b.x, qy = py - b.y, along = qx * ux + qy * uy; return along > 0 && along < b.len && Math.abs(qx * uy - qy * ux) < BW + 1.5; },
      draw(c, list, env, glow) {
        const p = env.pal;
        for (const b of list) {
          const ex = b.x + Math.cos(b.ang) * b.len, ey = b.y + Math.sin(b.ang) * b.len, k = b.t / b.warn;
          c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(ex, ey); c.lineCap = "butt";
          if (k < 1) { // the warning: a dashed pencil line that darkens, plus a tick that sweeps along it
            if (glow) continue; c.setLineDash([7, 6]); c.lineDashOffset = -b.t * 40; c.globalAlpha = 0.25 + 0.6 * k; c.lineWidth = 1 + k * 1.6; c.strokeStyle = p.red; c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
          } else {
            const f = 1 - Math.min(1, (b.t - b.warn) / b.live) * 0.6;
            if (!env.dark && !glow) { c.lineWidth = BW * 2 + 2.4; c.strokeStyle = p.ink; c.stroke(); }
            c.lineWidth = BW * 2 * f; c.strokeStyle = p.red; c.stroke(); c.lineWidth = 2; c.strokeStyle = p.core; c.stroke();
          }
        }
      },
    };
    // shell: slows down, then bursts into b.n dots (aimed if b.aim) when its ring closes after b.fuse seconds
    G.bullets[7] = {
      r: 5, name: "shell",
      move(G, b, dt) {
        const k = Math.exp(-dt * 1.4); b.vx *= k; b.vy *= k; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.t >= b.fuse) { b.dead = true; const n = b.n || 8, a0 = b.aim ? G.aim(b.x, b.y) : b.a; for (let i = 0; i < n; i++) G.fire(b.x, b.y, a0 + (i / n) * TAU, b.bs || 95, 0); }
      },
      draw(c, list, env, glow) {
        stamp("point")(c, list); c.beginPath();
        for (const b of list) { const r = 5 + 16 * Math.max(0, 1 - b.t / b.fuse); c.moveTo(b.x + r, b.y); c.arc(b.x, b.y, r, 0, TAU); }
        c.lineWidth = 1.4; c.strokeStyle = env.pal.amber; c.stroke();
      },
    };
    // word: a real word picked off the lesson (G.takeWord), drawn in its own font in red pen. Held (safe)
    // it eases to its slot by the boss; thrown it flies straight; off the page it drops into the pile.
    const clamp = G.clamp;
    G.bullets[8] = {
      r: 6, name: "word",
      move(G, b, dt) {
        if (b.safe) { const k = 1 - Math.exp(-dt * 7); b.x += (b.hx - b.x) * k; b.y += (b.hy - b.y) * k; return; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < -10 || b.x > G.W + 10 || b.y < -10 || b.y > G.H + 10) { b.dead = true; G.dropWord(b.ref, clamp(b.x, 30, G.W - 30), clamp(b.y, 30, G.floorY - 30), b.vx * 0.2, b.vy * 0.2); }
      },
      hits: (G, b, px, py) => Math.abs(px - b.x) < b.ww * 0.42 + 2 && Math.abs(py - b.y) < b.wh * 0.34 + 2,
      draw(c, list, env, glow) {
        const p = env.pal; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
        for (const b of list) { c.font = b.font; if (!env.dark && !glow) { c.lineWidth = 4; c.strokeStyle = p.ink; c.strokeText(b.text, b.x, b.y); } c.fillStyle = p.red; c.fillText(b.text, b.x, b.y); }
      },
    };
    // a word cancelled in flight (a Eureka, a new phase) is let go as debris rather than lost
    G.on("cancel", (d) => { for (const b of d.bullets) if (b.k === 8) G.dropWord(b.ref, b.x, b.y, 0, -60); });
    // rule: a torn line right across the page with one gap, b.gw wide, that slides as the line falls.
    // Ticks stand at the gap's edges so the way through reads at a glance.
    const zig = (c, a, b, y) => { if (b <= a) return; c.moveTo(a, y); for (let x = a + 6; x < b; x += 6) c.lineTo(x, y + ((x / 6) & 1 ? -3 : 3)); c.lineTo(b, y); };
    G.bullets[9] = {
      r: 5, name: "rule",
      move(G, b, dt) { b.y += b.vy * dt; b.gx = G.W / 2 + Math.sin(b.t * b.gf + b.ph) * b.amp; if (b.y > G.H - 2) b.dead = true; },
      hits: (G, b, px, py) => Math.abs(py - b.y) < 5 && Math.abs(px - b.gx) > b.gw / 2,
      draw(c, list, env, glow) {
        const p = env.pal; c.beginPath();
        for (const b of list) { const g0 = b.gx - b.gw / 2, g1 = b.gx + b.gw / 2; zig(c, 0, g0, b.y); zig(c, g1, G.W, b.y); for (const x of [g0, g1]) { c.moveTo(x, b.y - 8); c.lineTo(x, b.y + 8); } }
        c.lineJoin = "miter"; c.lineCap = "butt"; if (!env.dark && !glow) { c.lineWidth = 5.6; c.strokeStyle = p.ink; c.stroke(); }
        c.lineWidth = 3; c.strokeStyle = p.red; c.stroke();
      },
    };
    // ripple: the wave a slam sends along the composer, a hump standing on the floor down to the bottom
    // edge (he can fly below the floor, so the danger is drawn there too). Rise over it.
    G.bullets[10] = {
      r: 8, name: "ripple",
      hits: (G, b, px, py) => Math.abs(px - b.x) < 12 && py > G.floorY - 22,
      draw(c, list, env, glow) {
        const p = env.pal, y = G.floorY, H = G.H; c.beginPath();
        for (const b of list) { c.moveTo(b.x - 14, H); c.lineTo(b.x - 14, y); c.quadraticCurveTo(b.x, y - 50, b.x + 14, y); c.lineTo(b.x + 14, H); c.closePath(); }
        c.globalAlpha = glow ? 0.6 : 0.85; c.fillStyle = p.red; c.fill(); c.globalAlpha = 1;
        if (!env.dark && !glow) { c.lineWidth = 1.4; c.strokeStyle = p.ink; c.stroke(); }
      },
    };
}
