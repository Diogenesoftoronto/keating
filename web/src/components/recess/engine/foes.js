// Recess characters: how every enemy, the bot and the pickups are drawn.
// Owner: the characters lane. Two enemy skins: ink, drawn in code (outlines "boil" at eight
// frames a second, the same stepped cadence as the mascot's sprites), and toys, drawn from
// generated sprite sheets. An enemy tells you what it is doing in e.act ("idle" | "windup" |
// "attack") with e.actT seconds in that state, and e.flash is 1 when it was just hit.
export const RecessArt = (function () {
  "use strict";
  const TAU = Math.PI * 2;
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace', SERIF = '"Literata",Georgia,Cambria,serif';
  const PAL = {
    paper: { paper: "#f1ece0", card: "#f6f2e8", ink: "#1c211b", soft: "#4a5247", faint: "#6c7468", green: "#1e9b50", deep: "#14743c", red: "#b9432e", amber: "#e8a33d", phos: "#4be388", core: "#fff7ea", wash: "#ddebdd", blush: "#f3d9d2", flash: "#ffffff", inkRGB: [0.11, 0.13, 0.105], glowRGB: [0.08, 0.45, 0.24] },
    term: { paper: "#0c1510", card: "#11201a", ink: "#dcefe0", soft: "#9dbfa8", faint: "#7ea58c", green: "#2fb866", deep: "#4be388", red: "#ff6b52", amber: "#ffc15e", phos: "#4be388", core: "#ffffff", wash: "#123a24", blush: "#3a1712", flash: "#4be388", inkRGB: [0.86, 0.94, 0.88], glowRGB: [0.29, 0.89, 0.53] },
  };
  const boil = (seed, i, T) => hash(seed + i * 7.31 + Math.floor(T * 8) * 1.73) - 0.5;

  function smooth(c, pts) {
    const n = pts.length; c.beginPath();
    c.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    c.closePath();
  }
  function blob(c, x, y, rx, ry, seed, T, n, amp) {
    const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU, k = 1 + boil(seed, i, T) * 2 * amp; pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]); }
    smooth(c, pts);
  }
  function box(c, x, y, w, h, r, seed, T, amp) {
    const j = (i) => (seed === undefined ? 0 : boil(seed, i, T) * (amp || 1.6));
    c.beginPath(); c.moveTo(x + r + j(0), y + j(1)); c.lineTo(x + w - r + j(2), y + j(3)); c.quadraticCurveTo(x + w, y, x + w + j(4), y + r);
    c.lineTo(x + w + j(5), y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h + j(6)); c.lineTo(x + r, y + h + j(7));
    c.quadraticCurveTo(x, y + h, x + j(8), y + h - r); c.lineTo(x + j(9), y + r); c.quadraticCurveTo(x, y, x + r + j(0), y + j(1)); c.closePath();
  }
  function ink(c, env, e, fill) {
    c.lineWidth = 2; c.lineJoin = "round"; c.lineCap = "round";
    const hit = e.flash > .02;
    c.fillStyle = hit ? (env.dark ? env.pal.wash : env.pal.flash) : fill || env.pal.card;
    c.strokeStyle = hit && env.dark ? env.pal.phos : env.pal.ink; c.fill(); c.stroke();
  }
  // mood: 0 plain, 1 cross, 2 smug. They watch the player; fx/fy override that with a fixed look.
  function eyes(c, env, x, y, gap, seed, mood, fx, fy) {
    let ox = fx, oy = fy;
    if (ox === undefined) { const dx = env.lx - x, dy = env.ly - y, l = Math.hypot(dx, dy) || 1; ox = (dx / l) * 1.2; oy = (dy / l) * 1.2; }
    const ph = env.T * 0.9 + hash(seed) * 5, blink = ph % 3.1 < 0.14;
    c.fillStyle = env.pal.ink; c.strokeStyle = env.pal.ink; c.lineWidth = 1.6; c.lineCap = "round";
    for (const s of [-1, 1]) {
      const ex = x + s * gap;
      if (blink) { c.beginPath(); c.moveTo(ex - 2.4, y); c.lineTo(ex + 2.4, y); c.stroke(); }
      else { c.beginPath(); c.arc(ex + ox, y + oy, 2, 0, TAU); c.fill(); }
      if (mood === 1) { c.beginPath(); c.moveTo(ex - s * 3.8, y - 5.4); c.lineTo(ex + s * 2.8, y - 2.8); c.stroke(); }
      if (mood === 2) { c.beginPath(); c.moveTo(ex - 3.2, y - 2.6); c.lineTo(ex + 3.2, y - 2.6); c.stroke(); }
    }
  }
  function label(c, env, text, x, y, size, col, weight) {
    c.font = (weight || 700) + " " + size + "px " + MONO; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = col || env.pal.red; c.fillText(text, x, y);
  }


  // ── toy skin: generated sprites from the same toy box as the mascot ──
  // toy = { img, cell, box: [[x, y, w, h] per cell], axis }. Cells: drift, spin, split, dart, worm, myth, wall, pickups.
  function cellAt(c, toy, i, cx, cy, size, sub) {
    let bx = toy.box[i][0], by = toy.box[i][1], bw = toy.box[i][2], bh = toy.box[i][3];
    if (sub) { bx += bw * sub[0]; by += bh * sub[1]; bw *= sub[2]; bh *= sub[3]; }
    const s = size / Math.max(bw, bh), w = bw * s, h = bh * s;
    c.drawImage(toy.img, (i % 4) * toy.cell + bx, ((i / 4) | 0) * toy.cell + by, bw, bh, cx - w / 2, cy - h / 2, w, h);
    return { w, h };
  }
  const TOY = { cream: "#f6efe0", red: "#b9432e", dark: "#7c2a1c", ink: "#1c211b" };
  const moods = new WeakMap();
  const clip = (toy, role) => toy.poses[role] || null;
  function frame(c, img, i, x, y, size) {
    const cell = img.naturalWidth / 4;
    c.drawImage(img, (i % 4) * cell, (i >> 2) * cell, cell, cell, x - size / 2, y - size / 2, size, size);
  }
  function poseIndex(e, role, env) {
    const idle = env.G?.calm ? 0 : Math.floor(env.T * 10 + (e.seed || 0)) & 3;
    const beat = Math.floor((e.actT || 0) * 10) & 1;
    if (role === "kid") return (e.half ? 4 : 0) + idle;
    if (role === "wall" && e.move) {
      if (e.frz) return 0;
      if (e.move === "conclusion") return e.mt < 1.5 ? 6 : 5;
      if (e.move === "thesis") return 0;
      return e.act === "windup" ? 4 : 5;
    }
    if (e.flash > 0.35) return 6;
    if (role === "dart") return (e.act === "windup" || e.ph === 1 ? 2 + beat : e.act === "attack" || e.ph === 2 ? 4 + beat : idle & 1);
    if (e.act === "windup") return 4;
    if (e.act === "attack") return 5;
    return idle;
  }
  let firstFlight = true;
  const halvesX = [[0,0,.5,1],[.5,0,.5,1]], halvesY = [[0,0,1,.48],[0,.52,1,.48]];
  const chemistryKids = [[0,.39,.30,.61],[.70,.39,.30,.61]];
  const musicKids = [[.11,0,.89,.375],[0,.634,.75,.366]];
  function spinMarks(c, e, pal) {
    c.strokeStyle = pal.soft; c.lineWidth = 1.4;
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI - .8;
      c.beginPath(); c.arc(e.x, e.y, e.r + 6, a, a + .75); c.stroke();
    }
  }
  function drawToy(c, e, env) {
    const toy = env.toy, T = env.T, seed = e.seed || 0, p = env.pal;
    const role = e.look || e.k, img = clip(toy, role);
    function pose(slot, x, y, size, sub) {
      if (!img?.naturalWidth) return cellAt(c, toy, slot, x, y, size, sub);
      frame(c, img, poseIndex(e, role, env), x, y, size * 1.13);
      if (role === "wall") return { w: size, h: size };
    }
    const lit = (fn) => { fn(); if (!img?.naturalWidth && e.flash > 0.02) { c.save(); c.globalCompositeOperation = "lighter"; c.globalAlpha *= Math.min(1, e.flash) * 0.8; fn(); c.restore(); } };
    switch (e.look || e.k) {
      case "drift": {
        const y = e.y + Math.sin(T * 6 + seed) * 1.5, tilt = Math.sin(T * 3 + seed) * 0.09;
        c.save(); c.translate(e.x, y); c.rotate(tilt); lit(() => pose(0, 0, 0, e.r * 2.9)); c.restore();
        label(c, env, e.sym, e.x, y - e.r - 10, e.sym.length > 2 ? 8 : 10);
        return true;
      }
      case "kid": {
        const { cast, axis } = toy;
        const sub = (cast === "chemistry" ? chemistryKids : cast === "music" ? musicKids : axis === "y" ? halvesY : halvesX)[e.half ? 1 : 0];
        c.save(); c.translate(e.x, e.y); c.rotate(Math.sin(T * 5 + seed) * 0.14); lit(() => pose(2, 0, 0, e.r * 2.5, sub)); c.restore();
        return true;
      }
      case "dart": {
        const a = e.ang === undefined ? Math.PI / 2 : e.ang, tele = e.ph === 1;
        if (tele) { c.save(); c.setLineDash([4, 6]); c.strokeStyle = p.red; c.globalAlpha *= 0.6; c.lineWidth = 1.5; c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(e.x + Math.cos(a) * 700, e.y + Math.sin(a) * 700); c.stroke(); c.restore(); }
        c.save(); c.translate(e.x + (tele && !env.G?.calm ? (hash(T * 61) - 0.5) * 3 : 0), e.y + (tele && !env.G?.calm ? (hash(T * 43) - 0.5) * 3 : 0)); c.rotate(a - Math.PI * 0.75); if (tele) c.scale(1.08, .90); lit(() => pose(3, 0, 0, 46)); c.restore();
        return true;
      }
      case "spin": {
        c.save(); c.translate(e.x, e.y); c.rotate(Math.sin(T * 4 + seed) * (e.firing ? 0.16 : 0.07)); lit(() => pose(1, 0, 0, e.r * 2.7)); c.restore();
        spinMarks(c, e, p);
        return true;
      }
      case "split": {
        const sq = 1 + Math.sin(T * 3 + seed) * 0.05;
        c.save(); c.translate(e.x, e.y); c.scale(sq, 1 / sq); lit(() => pose(2, 0, 0, e.r * 2.35)); c.restore();
        return true;
      }
      case "worm": {
        const segs = e.segs, segment = clip(toy, "wormseg"), smallBead = toy.cast === "spanish"; // was an undefined `subjects` lookup that threw on every worm frame
        for (let i = segs.length - 1; i >= 0; i--) {
          const s = segs[i]; if (!s.alive) continue;
          if (segment?.naturalWidth) {
            frame(c, segment, s.flash > .25 ? 4 : (env.G?.calm ? 0 : Math.floor(T * 10 + i) & 3), s.x - (smallBead ? 2 : 0), s.y, smallBead ? 30 : 24);
            label(c, env, s.ch, s.x, s.y, 10, TOY.cream);
            continue;
          }
          const g = c.createRadialGradient(s.x - 3, s.y - 4, 1, s.x, s.y, 11); g.addColorStop(0, s.flash > 0.02 ? "#fff" : i % 2 ? "#5a5f58" : "#d8674f"); g.addColorStop(1, i % 2 ? "#23282a" : TOY.dark);
          c.beginPath(); c.arc(s.x, s.y + Math.sin(T * 6 + i) * 0.8, 10.5, 0, TAU); c.fillStyle = g; c.fill();
          label(c, env, s.ch, s.x, s.y + 0.5, 10.5, TOY.cream);
        }
        c.save(); c.translate(e.x, e.y - 4); lit(() => pose(4, 0, 0, 40, [0, 0, 0.34, 1])); c.restore();
        return true;
      }
      case "myth": {
        const w = e.w, h = e.h, x = e.x - w / 2, y = e.y - h / 2 + Math.sin(T * 2 + seed) * 2, done = 1 - Math.max(0, e.hp) / e.max;
        const tx = x + 52, ty = y + h / 2 + 0.5;
        box(c, x + 38, y + 4, w - 38, h - 8, 8); c.fillStyle = e.flash > 0.02 ? "#fff" : TOY.cream; c.fill(); c.strokeStyle = TOY.red; c.lineWidth = 2; c.stroke();
        c.font = "italic 600 13px " + SERIF; c.textAlign = "left"; c.textBaseline = "middle"; c.fillStyle = TOY.ink; c.save(); c.globalAlpha *= 1 - done * 0.5; c.fillText(e.myth.wrong, tx, ty, w - 62); c.restore();
        if (done > 0.01) { c.beginPath(); c.moveTo(tx - 2, ty); c.lineTo(tx - 2 + Math.min(e.tw + 4, w - 58) * done, ty + boil(seed, 32, T)); c.strokeStyle = TOY.red; c.lineWidth = 2.4; c.lineCap = "round"; c.stroke(); }
        c.save(); c.translate(x + 22, y + h / 2 - 3); c.rotate(Math.sin(T * 2.4 + seed) * 0.06); lit(() => pose(5, 0, 0, 58)); c.restore();
        return true;
      }
      case "wall": {
        const hurt = e.flash > 0.02; let d;
        c.save(); c.translate(e.x + (hurt && !env.G?.calm ? (hash(T * 77) - 0.5) * 3 : 0), e.y); lit(() => { d = pose(6, 0, 0, e.h * 1.12); });
        const gone = (e.max - Math.max(0, e.hp)) / e.per, n = e.lines.length, x0 = -d.w * 0.2, x1 = d.w * 0.2, y0 = -d.h * 0.2, y1 = d.h * 0.28;
        c.strokeStyle = TOY.red; c.lineWidth = 2.6; c.lineCap = "round";
        for (let i = 0; i < n; i++) { const frac = Math.min(1, Math.max(0, gone - i)); if (frac <= 0.01) break; const yy = y1 - ((i + 0.5) / n) * (y1 - y0); c.beginPath(); c.moveTo(x0, yy + boil(seed, 40 + i, T)); c.lineTo(x0 + (x1 - x0) * frac, yy + boil(seed, 60 + i, T)); c.stroke(); }
        c.restore();
        return true;
      }
    }
    return false;
  }

  function drawFoe(c, e, env) {
    const p = env.pal, T = e.frz ? 0 : env.T, seed = e.seed || 0;
    c.save();
    if (e.born > 0) { const k = 1 - Math.min(1, e.born / (e.born0 || 0.5)), s = 0.25 + 0.75 * k * (2 - k); c.translate(e.x, e.y); c.scale(s, s); c.translate(-e.x, -e.y); c.globalAlpha *= 0.4 + 0.6 * k; }
    // Anticipation compresses about the collision centre. Release briefly overshoots.
    const role = e.look || e.k, t = e.actT || 0;
    const press = e.flash > .25 ? .16 * e.flash : e.act === "windup" ? .14 * Math.min(1, .45 + t * 5)
      : e.act === "attack" ? -.13 * Math.exp(-t * 8) * Math.cos(t * 14) : 0;
    let squash = press && role !== "dart" && role !== "worm" ? press * (env.G?.calm || role === "wall" || role === "myth" ? .4 : 1) : 0;
    let angle = e.rot || 0, jitter = env.G?.calm ? 0 : e.jit || 0;
    if (role === "wall") {
      const dir = e.move === "charge" ? (e.side ? -1 : 1) : Math.sign(env.lx - e.x);
      const cast = env.G?.pack?.id, flexible = cast === "law" || cast === "finance";
      if (e.move === "charge") angle += dir * (e.vx ? .19 : e.hit ? 0 : -.10);
      if (e.move === "slam") squash = e.hit ? .23 * Math.exp(-(e.mt - e.hit) * 6) : -.07;
      if (e.move === "throw" || e.move === "summon") angle += dir * (flexible ? -.09 : -.045);
      if (e.frz) { squash = 0; jitter = 0; }
      if (!e.move && e.hp < e.max / 4 && !env.G?.calm) angle += .013 * Math.sin(Math.floor(T * 10) * 2);
    }
    const breath = e.move === "inhale" && e.mt > .6 ? 1 + .06 * Math.min(1, (e.mt - .6) * 3) : 1;
    const q = 1 + squash;
    c.translate(e.x + jitter * Math.cos(seed + (env.G?.RT || T) * 137), e.y + jitter * Math.sin(seed + (env.G?.RT || T) * 137));
    c.rotate(angle); c.scale((e.sx ?? 1) * q * breath, (e.sy ?? 1) / q * breath); c.translate(-e.x, -e.y);
    c.globalAlpha *= e.alpha ?? 1;
    // The reversed literature boss shows its binding and bookmark, with no mirrored type.
    if (role === "wall" && e.move === "twist" && e.sx < 0) {
      const img = env.toy && clip(env.toy, "wall"), size = e.h * 1.12 * 1.13;
      let w = e.w, h = e.h, x = e.x - w / 2, y = e.y - h / 2;
      if (img?.naturalWidth) {
        // Keep the generated book's spine, gloves and boots around the turned cover.
        frame(c, img, 0, e.x, e.y, size);
        w = size * .426; h = size * .662;
        x = e.x - size * .155; y = e.y - size * .342;
      }
      box(c, x, y, w, h, 6); c.fillStyle = env.toy ? TOY.dark : p.card; c.fill(); c.strokeStyle = p.ink; c.lineWidth = 2; c.stroke();
      c.strokeStyle = env.toy ? TOY.cream : p.soft; c.strokeRect(x + 12, y + 7, w - 20, h - 14);
      c.fillStyle = p.ink; c.fillRect(x + 5, y + 2, 3, h - 4);
      c.beginPath(); c.moveTo(x + w * .72, y); c.lineTo(x + w * .72, y + 24);
      c.lineTo(x + w * .72 + 5, y + 19); c.lineTo(x + w * .72 + 10, y + 24); c.lineTo(x + w * .72 + 10, y); c.fill();
      c.restore(); return;
    }
    if (!(env.toy && drawToy(c, e, env))) switch (e.look || e.k) {
      case "drift": case "kid": {
        const r = e.r, y = e.y + Math.sin(T * 6 + seed) * 1.3;
        c.strokeStyle = p.ink; c.lineWidth = 2; c.lineCap = "round"; c.beginPath();
        for (const s of [-1, 1]) { const sw = Math.sin(T * 9 + seed + s) * 2.2; c.moveTo(e.x + s * r * 0.42, y + r * 0.8); c.lineTo(e.x + s * r * 0.5 + sw, y + r + 5); }
        c.stroke();
        // The margin marks have little pen-nib hands that brace before a volley.
        c.beginPath();
        for (const side of [-1, 1]) {
          const reach = e.act === "attack" ? 8 : 4, lift = e.act === "windup" ? -6 : 2;
          c.moveTo(e.x + side * r * .8, y);
          c.quadraticCurveTo(e.x + side * (r + 2), y + 4, e.x + side * (r + reach), y + lift);
          c.lineTo(e.x + side * (r + reach - 1), y + lift - 3);
        }
        c.stroke();
        blob(c, e.x, y, r, r * 0.93, seed, T, 9, 0.07); ink(c, env, e);
        eyes(c, env, e.x, y - r * 0.3, r * 0.34, seed, e.act === "windup" ? 1 : 0);
        label(c, env, e.sym, e.x, y + r * 0.38, e.sym.length > 2 ? 8 : e.sym.length > 1 ? 9.5 : 12);
        break;
      }
      case "dart": {
        const a = e.ang === undefined ? Math.PI / 2 : e.ang, tele = e.ph === 1;
        if (tele) { c.save(); c.setLineDash([4, 6]); c.strokeStyle = p.red; c.globalAlpha *= 0.55; c.lineWidth = 1.5; c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(e.x + Math.cos(a) * 700, e.y + Math.sin(a) * 700); c.stroke(); c.restore(); }
        c.save(); c.translate(e.x + (tele && !env.G?.calm ? (hash(T * 61) - 0.5) * 3 : 0), e.y); c.rotate(a - Math.PI / 2); if (tele) c.scale(1.13, .84);
        const j = (i) => boil(seed, i, T) * 1.8;
        c.beginPath(); c.moveTo(j(0), 21 + j(1)); c.lineTo(16 + j(2), -12 + j(3)); c.lineTo(j(4), -5 + j(5)); c.lineTo(-16 + j(6), -12 + j(7)); c.closePath();
        ink(c, env, e, tele ? p.blush : p.card);
        eyes(c, env, 0, 0, 4.6, seed, 1, 0, 1.3);
        c.restore();
        label(c, env, e.sym, e.x - Math.cos(a) * 24, e.y - Math.sin(a) * 24, e.sym.length > 3 ? 8 : 9.5);
        break;
      }
      case "spin": {
        const r = e.r, n = 8; c.save(); c.translate(e.x, e.y); c.beginPath();
        for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU, rr = (i % 2 ? r : r * 0.76) + boil(seed, i, T) * 1.5, x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.closePath(); ink(c, env, e); c.restore();
        c.beginPath(); c.arc(e.x, e.y, r * 0.56, 0, TAU); c.fillStyle = e.flash > 0.02 ? p.flash : p.paper; c.fill(); c.strokeStyle = p.ink; c.lineWidth = 1.6; c.stroke();
        eyes(c, env, e.x, e.y - 4, 4.4, seed, e.firing || e.act === "windup" ? 1 : 0);
        label(c, env, e.sym, e.x, e.y + 6, e.sym.length > 4 ? 6.5 : e.sym.length > 3 ? 7.5 : 9);
        spinMarks(c, e, p);
        break;
      }
      case "split": {
        const r = e.r, sq = 1 + Math.sin(T * 3 + seed) * 0.05;
        blob(c, e.x, e.y, r * sq, r / sq, seed, T, 12, 0.055); ink(c, env, e);
        c.save(); c.setLineDash([3, 4]); c.strokeStyle = p.red; c.lineWidth = 1.5; c.beginPath(); c.moveTo(e.x, e.y - r * 0.82); c.lineTo(e.x, e.y + r * 0.82); c.stroke(); c.restore();
        eyes(c, env, e.x - r * 0.46, e.y - r * 0.2, 3.6, seed, 0); eyes(c, env, e.x + r * 0.46, e.y - r * 0.2, 3.6, seed + 9, 0);
        label(c, env, e.sym, e.x, e.y + r * 0.44, e.sym.length > 3 ? 9.5 : 11);
        break;
      }
      case "worm": {
        const segs = e.segs; c.strokeStyle = p.ink; c.lineWidth = 2; c.lineCap = "round";
        c.beginPath(); let px = e.x, py = e.y;
        for (const s of segs) { if (!s.alive) { px = s.x; py = s.y; continue; } c.moveTo(px, py); c.lineTo(s.x, s.y); px = s.x; py = s.y; }
        c.stroke();
        for (let i = segs.length - 1; i >= 0; i--) {
          const s = segs[i]; if (!s.alive) continue;
          blob(c, s.x, s.y, 10, 10, seed + i * 3.1, T, 7, 0.06); ink(c, env, s);
          label(c, env, s.ch, s.x, s.y + 0.5, 10.5);
        }
        c.beginPath(); for (const s of [-1, 1]) { c.moveTo(e.x + s * 5, e.y - 10); c.lineTo(e.x + s * 9 + Math.sin(T * 7 + s) * 1.5, e.y - 19); } c.strokeStyle = p.ink; c.lineWidth = 2; c.stroke();
        blob(c, e.x, e.y, 13, 12.5, seed, T, 9, 0.06); ink(c, env, e);
        eyes(c, env, e.x, e.y - 2, 4.6, seed, 1);
        c.beginPath(); c.moveTo(e.x - 3.5, e.y + 5.5); c.lineTo(e.x + 3.5, e.y + 5.5); c.strokeStyle = p.ink; c.lineWidth = 1.6; c.stroke();
        break;
      }
      case "myth": {
        const w = e.w, h = e.h, x = e.x - w / 2, y = e.y - h / 2 + Math.sin(T * 2 + seed) * 2;
        c.beginPath(); c.moveTo(x + 22, y + h - 2); c.lineTo(x + 14, y + h + 11 + boil(seed, 20, T) * 2); c.lineTo(x + 36, y + h - 2); c.closePath(); ink(c, env, e);
        box(c, x, y, w, h, 11, seed, T, 1.5); ink(c, env, e);
        c.beginPath(); c.moveTo(x + 23, y + h - 1); c.lineTo(x + 35, y + h - 1); c.strokeStyle = e.flash > 0.02 ? (env.dark ? p.wash : p.flash) : p.card; c.lineWidth = 3; c.stroke();
        eyes(c, env, x + 20, y + h / 2 - 3, 4.4, seed, 2);
        c.beginPath(); c.arc(x + 21, y + h / 2 + 4, 3.6, 0.15, Math.PI * 0.8); c.strokeStyle = p.ink; c.lineWidth = 1.6; c.stroke();
        const tx = x + 36, ty = y + h / 2 + 0.5, done = 1 - Math.max(0, e.hp) / e.max;
        c.font = "italic 600 13px " + SERIF; c.textAlign = "left"; c.textBaseline = "middle"; c.fillStyle = p.ink; c.save(); c.globalAlpha *= 1 - done * 0.5; c.fillText(e.myth.wrong, tx, ty); c.restore();
        if (done > 0.01) { c.beginPath(); c.moveTo(tx - 2, ty + boil(seed, 31, T)); c.lineTo(tx - 2 + (e.tw + 4) * done, ty + boil(seed, 32, T) * 1.5); c.strokeStyle = p.red; c.lineWidth = 2.4; c.stroke(); }
        break;
      }
      case "wall": {
        const w = e.w, lh = e.lh, n = e.lines.length, h = e.h, x = e.x - w / 2, y = e.y - h / 2;
        const gone = (e.max - Math.max(0, e.hp)) / e.per, struck = Math.floor(gone), part = gone - struck, hurt = e.flash > 0.02;
        // he peers over the top of his own paragraph
        for (const s of [-1, 1]) {
          const ex = e.x + s * 26, ey = y - 5 + (hurt ? 3 : 0);
          c.beginPath(); c.arc(ex, ey, 10, Math.PI, 0); c.closePath(); c.fillStyle = p.card; c.fill(); c.strokeStyle = p.ink; c.lineWidth = 2; c.stroke();
          const dx = e.move === "charge" && e.vx ? e.vx : env.lx - ex, dy = e.move === "charge" ? 0 : env.ly - ey, l = Math.hypot(dx, dy) || 1;
          c.beginPath(); c.arc(ex + (dx / l) * 3.6, ey - 3.4 + (dy / l) * 1.6, 2.8, 0, TAU); c.fillStyle = p.ink; c.fill();
          c.beginPath(); c.moveTo(ex - s * 11, ey - 15 + (hurt ? 4 : 0)); c.lineTo(ex + s * 7, ey - 9); c.strokeStyle = p.ink; c.lineWidth = 2.4; c.stroke();
        }
        box(c, x, y, w, h, 6, seed, T, 1.3); ink(c, env, e);
        c.font = "500 10.5px " + MONO; c.textAlign = "left"; c.textBaseline = "middle";
        for (let i = 0; i < n; i++) {
          const ly = y + 7 + lh * (i + 0.5), fromEnd = n - 1 - i, dead = fromEnd < struck, cur = fromEnd === struck;
          c.fillStyle = p.ink; c.save(); c.globalAlpha *= dead ? 0.28 : 0.92; c.fillText(e.lines[i], x + 10, ly, w - 20); c.restore();
          const frac = dead ? 1 : cur ? part : 0;
          if (frac > 0.01) { c.beginPath(); c.moveTo(x + 8, ly + boil(seed, 40 + i, T)); c.lineTo(x + 8 + (w - 16) * frac, ly + boil(seed, 60 + i, T) * 1.4); c.strokeStyle = p.red; c.lineWidth = 2.2; c.lineCap = "round"; c.stroke(); }
        }
        break;
      }
    }
    if (e.frz) {
      // A stopped cursor on the case also reads in monochrome.
      const x = e.x + e.w * .22, y = e.y - e.h * .38;
      box(c, x - 8, y - 8, 16, 16, 3); c.fillStyle = p.card; c.fill(); c.strokeStyle = p.ink; c.lineWidth = 1.4; c.stroke();
      c.fillStyle = p.ink; c.fillRect(x - 4, y - 4, 3, 8); c.fillRect(x + 1, y - 4, 3, 8);
    }
    c.restore();
  }

  // Standing portraits for the bestiary board: the same drawing code as the game.
  function sample(kind, pack, w, h, T) {
    const cx = w / 2, cy = h / 2;
    if (kind === "drift") return pack.drift.slice(0, 3).map((sym, i) => ({ k: "drift", x: cx + (i - 1) * 34, y: cy + Math.sin(T * 1.6 + i) * 4, r: 13, sym, seed: 11 + i * 5 }));
    if (kind === "dart") { const tele = T % 3 > 2.1; return [{ k: "dart", x: cx, y: cy - 6, sym: pack.dart, seed: 23, ang: Math.PI / 2, ph: tele ? 1 : 0 }]; }
    if (kind === "spin") return [{ k: "spin", x: cx, y: cy, r: 22, sym: pack.spin, seed: 31, rot: T * 1.3, firing: T % 4 > 2 }];
    if (kind === "split") return [{ k: "split", x: cx, y: cy, r: 28, sym: pack.split[0], seed: 41 }];
    if (kind === "worm") {
      const txt = pack.worm, n = Math.min(7, txt.length), segs = [];
      for (let i = 0; i < n; i++) segs.push({ ch: txt[i], alive: true, x: cx - 38 + (i + 1) * 15, y: cy + Math.sin(T * 2.2 - (i + 1) * 0.7) * 9 });
      return [{ k: "worm", x: cx - 38, y: cy + Math.sin(T * 2.2) * 9, seed: 53, segs }];
    }
    if (kind === "myth") { const m = pack.myths[0]; return [{ k: "myth", x: cx, y: cy - 4, w: 0, h: 38, myth: m, hp: 1 - ((T * 0.25) % 1), max: 1, seed: 61, measure: true }]; }
    return [{ k: "wall", x: cx, y: cy + 8, w: 300, lh: 17, lines: pack.wall, h: pack.wall.length * 17 + 14, hp: pack.wall.length * 70 * (1 - ((T * 0.08) % 1)), max: pack.wall.length * 70, per: 70, seed: 71, fit: true }];
  }
  function portrait(cv, kind, getPack, getTheme, getToy) {
    const c = cv.getContext("2d");
    return function (T, mx, my) {
      const d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 150, h = cv.clientHeight || 90;
      if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
      c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
      const theme = getTheme(), toy = getToy ? getToy() : null, env = { pal: PAL[theme], T, lx: mx === undefined ? w / 2 : mx, ly: my === undefined ? h * 3 : my, dark: theme === "term", toy };
      for (const e of sample(kind, getPack(), w, h, T)) {
        let s = 1;
        if (e.measure) { c.font = "italic 600 13px " + SERIF; e.tw = c.measureText(e.myth.wrong).width; e.w = e.tw + 50; s = Math.min(1, (w - 10) / e.w); }
        if (e.fit && toy) { e.w = 150; e.h = 150; e.y = h / 2; s = Math.min(1, (h - 6) / 168); }
        else if (e.fit) s = Math.min((w - 12) / e.w, (h - 30) / e.h, 1);
        if (toy && e.k === "drift") e.r = 12;
        c.save(); if (s !== 1) { c.translate(e.x, e.y); c.scale(s, s); c.translate(-e.x, -e.y); }
        drawFoe(c, e, env); c.restore();
      }
    };
  }

  // ── the bot ──
  // Sheet rows are named in G.o.rows (hover, hit, cheer, launch, and when generated: aim,
  // aimB, aimFire, eureka, land ...). Each row is eight 128 px frames.
  const BOT = { cream: "#efe7d6", green: "#1e9b50", ink: "#1c211b" }; // the toy keeps his colours in every theme
  const turn = (d) => { while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
  const SCREEN_X = [-2,-2,-4,-1,0,-2,-3,-2], SCREEN_Y = [-21,-21,-19,-21,-20,-21,-19,-21];
  const SCREEN_TILT = [.05,.2,.22,.26,.22,.1,0,-.07];
  // A canvas filter costs a full offscreen pass on every draw. Keating's tint is fixed for a run, so each
  // sprite cell is filtered once into a small canvas and reused.
  const tints = new WeakMap();
  function tinted(img, sx, sy, sw, sh, filter) {
    let byImage = tints.get(img); if (!byImage) { byImage = new Map(); tints.set(img, byImage); }
    const key = filter + "|" + sx + "," + sy + "," + sw + "," + sh; let cv = byImage.get(key);
    if (!cv) {
      cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(sw)); cv.height = Math.max(1, Math.round(sh));
      const x = cv.getContext("2d"); x.filter = filter; x.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
      if (byImage.size > 160) byImage.clear(); byImage.set(key, cv);
    }
    return cv;
  }
  function blit(c, img, sx, sy, sw, sh, dx, dy, dw, dh, filter) {
    if (filter) c.drawImage(tinted(img, sx, sy, sw, sh, filter), dx, dy, dw, dh);
    else c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  function drawEquipment(c, item, x, y, size, filter) {
    if (!item) return;
    const unit = item.image.naturalWidth / 4;
    blit(c, item.image, (item.cell % 4) * unit, Math.floor(item.cell / 4) * unit,
      unit, unit, x - size / 2, y - size / 2, size, size, filter);
  }
  function drawPlayer(c, env) {
    const G = env.G, p = G.P, o = G.o, pal = env.pal, rows = o.rows, playing = G.state === "play"; if (G.state === "idle") return;
    const charge = G.care?.charge ?? .75, low = charge < .4, down = G.state === "down";
    const revived = playing && (moods.get(G)?.revive || 0) > G.T;
    const sheet = o.sheet, cell = sheet.naturalWidth / 8, S = 86, up = -Math.PI / 2;
    let row = rows[p.anim] === undefined ? 0 : rows[p.anim], f = p.anim === "launch" || p.anim === "land" || p.anim === "eureka" ? Math.min(7, Math.floor(p.animT * (p.anim === "land" ? 13 : 9))) : Math.floor(p.animT * 10) % 8, lean = 0;
    if (down) { row = rows.hit; f = 1; lean = .17 - p.tilt; }
    else if (revived) { row = rows.cheer; f = G.calm ? 1 : Math.max(0, Math.min(7, Math.floor((1.05 + G.T - moods.get(G).revive) * 8))); lean = -p.tilt; }
    else if (playing && p.anim === "hover") {
      const d = turn(p.aim - up);
      const mood = moods.get(G), resting = !p.lock && !p.manual;
      if (p.focus && rows.focus !== undefined) {
        row = rows.focus;
      } else if (rows.blank !== undefined && mood && mood.until > G.T && !p.focus) {
        row = rows.blank;
      } else if ((resting || Math.abs(d) < .4) && Math.abs(p.vx) > 105 && rows.bank !== undefined) {
        row = rows.bank; f = (p.vx > 0 ? 4 : 0) + (f & 3); lean = -p.tilt * .65;
      } else if (resting && rows.blank !== undefined) {
        row = rows.blank;
      } else if (rows.aim !== undefined) { // eight poses, one per compass direction, clockwise from up
        const i = ((Math.round(d / (Math.PI / 4)) % 8) + 8) % 8; f = i; lean = turn(d - i * (Math.PI / 4)) * 0.6;
        row = p.fireT < 0.05 && rows.aimFire !== undefined ? rows.aimFire : Math.floor(G.T * 2.5) % 2 && rows.aimB !== undefined ? rows.aimB : rows.aim;
      } else lean = Math.max(-0.75, Math.min(0.75, d * 0.42)); // until those sheets exist he leans toward his aim
    }
    c.save();
    if (!G.calm && p.inv > 0 && playing && !revived && p.anim !== "hit" && Math.floor(G.RT * 14) % 2 === 0) c.globalAlpha = 0.45;
    c.translate(p.x, p.y); c.rotate(p.tilt + lean + (low && playing && !revived ? .12 : 0)); c.scale(p.scale, p.scale);
    if (!o.hasJetpack) for (const s of [-1, 1]) { // a drawn pack when the sprite sheet has none
      box(c, s * 15 - 5.5, -8, 11, 21, 4); c.fillStyle = BOT.cream; c.fill(); c.strokeStyle = BOT.ink; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = BOT.green; c.fillRect(s * 15 - 5.5, -1, 11, 3.5); c.fillStyle = BOT.ink; c.beginPath(); c.moveTo(s * 15 - 3.5, 13); c.lineTo(s * 15 + 3.5, 13); c.lineTo(s * 15 + 5, 17.5); c.lineTo(s * 15 - 5, 17.5); c.closePath(); c.fill();
    }
    c.save();
    const tint = down ? "saturate(.3) brightness(.78)" : low ? "brightness(.78)" : charge > .9 ? "brightness(1.09)" : "";
    drawEquipment(c, o.equipment.pack, -19, -1, 37, tint);
    blit(c, sheet, f * cell, row * cell, cell, cell, -S / 2, -S / 2 - 5, S, S, tint);
    drawEquipment(c, o.equipment.topper, -10, -35, 25, tint);
    if (o.equipment.blaster) {
      c.save();
      c.rotate(p.aim - p.tilt - lean - (low && !revived ? .12 : 0));
      drawEquipment(c, o.equipment.blaster, 24, 0, 26, tint);
      c.restore();
    }
    if (o.keycapBoots && playing) for (const x of [-11, 3]) {
      box(c, x, 19, 11, 6, 1.5); c.fillStyle = BOT.cream; c.strokeStyle = BOT.ink; c.lineWidth = 1;
      c.fill(); c.stroke(); c.fillStyle = BOT.green; c.fillRect(x + 3, 21, 4, 2);
    }
    c.restore();
    // Bank and expression poses carry the gun upright. A short sight keeps the shot direction legible.
    if (playing && (row === rows.bank || row === rows.focus || row === rows.blank) && (p.lock || p.manual)) {
      c.save(); c.rotate(p.aim - p.tilt - lean - (low && !revived ? .12 : 0)); c.strokeStyle = pal.deep; c.lineWidth = 2;
      c.beginPath(); c.moveTo(26, 0); c.lineTo(32, 0); c.stroke(); c.restore();
    }
    if (playing && row === rows.blank) {
      // Project onto the glass: these eight centres follow the generated head tilt.
      c.save(); c.translate(SCREEN_X[f], SCREEN_Y[f]); c.rotate(SCREEN_TILT[f]);
      const mood = moods.get(G), active = mood && mood.until > G.T;
      c.fillStyle = "#113e2d";
      if (active && mood.glyph) label(c, env, mood.glyph, 0, 0, 10, "#113e2d");
      else {
        const blink = active || G.T % 3.2 < .12, look = Math.cos(p.aim) * 1.3;
        for (const side of [-1,1]) c.fillRect(side * 4 + look - 1, -3, 2.4, blink || low ? 1.4 : 3.5);
        c.fillRect(-2, 2, 4, 1.2);
      }
      c.restore();
    }
    c.restore();
    if (playing || G.state === "intro") {
      const hint = (moods.get(G)?.hint || 0) > G.T;
      const pulse = hint && !G.calm ? .5 + .5 * Math.sin(G.T * 5) : 0;
      c.save();
      c.strokeStyle = pal.deep; c.fillStyle = pal.core; c.lineWidth = 1.5;
      if (G.calm && p.inv > 0) {
        c.beginPath(); c.ellipse(p.x, p.y - 5, 26, 35, 0, 0, TAU); c.stroke();
      }
      c.globalAlpha *= p.focus ? 1 : .70 + .25 * pulse;
      c.beginPath(); c.arc(p.x, p.y, p.focus ? 4 : 3 + .6 * pulse, 0, TAU); c.fill(); c.stroke();
      if (hint) {
        const x = Math.max(48, Math.min(G.W - 48, p.x + (p.x + 106 < G.W ? 59 : -59)));
        c.globalAlpha = 1; c.font = "600 10px " + MONO; c.textAlign = "center"; c.textBaseline = "middle";
        c.lineWidth = 3; c.strokeStyle = pal.paper; c.strokeText("This dot is you", x, p.y + 5);
        c.fillStyle = pal.ink; c.fillText("This dot is you", x, p.y + 5);
      }
      c.restore();
    }
    if (!playing) return;
    // where he is aiming: a crosshair under the pointer, or brackets on the enemy he chose
    c.strokeStyle = env.dark ? pal.phos : pal.deep; c.lineWidth = 1.8; c.lineCap = "butt";
    if (p.manual) {
      const x = G.inp.ax, y = G.inp.ay; c.beginPath();
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(x + ux * 4, y + uy * 4); c.lineTo(x + ux * 10, y + uy * 10); }
      c.stroke(); c.fillStyle = c.strokeStyle; c.fillRect(x - 1, y - 1, 2, 2);
    } else if (p.lock && !p.lock.dead) {
      const q = G.aimPoint(p.lock), r = (q === p.lock ? p.lock.r : 10) + 8 + Math.sin(G.T * 6) * 1.5, k = r * 0.45; c.globalAlpha = 0.85; c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(q.x + sx * r, q.y + sy * (r - k)); c.lineTo(q.x + sx * r, q.y + sy * r); c.lineTo(q.x + sx * (r - k), q.y + sy * r); }
      c.stroke(); c.globalAlpha = 1;
    }
  }
  // pickups: "s" spark, "c" flashcard, "h" heart
  function drawPickup(c, p, env) {
    const pal = env.pal, T = env.G?.calm ? 0 : env.T;
    c.save(); c.translate(p.x, p.y + (env.G?.calm ? 0 : Math.sin(T * 4 + p.x * .09) * 1.1));
    if (p.k === "e") {
      // Emergency charge cell: a chunky battery with a bolt, ringed so it reads at a glance.
      const pulse = env.G?.calm ? 0 : Math.sin(T * 5) * 1.5;
      c.beginPath(); c.arc(0, 0, 18 + pulse, 0, TAU); c.strokeStyle = pal.deep; c.lineWidth = 1.2; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
      box(c, -8, -11, 16, 22, 2.5); c.fillStyle = pal.card; c.fill(); c.strokeStyle = pal.ink; c.lineWidth = 1.8; c.stroke();
      c.fillStyle = pal.ink; c.fillRect(-3.5, -14, 7, 3);
      c.beginPath(); c.moveTo(1.5, -8); c.lineTo(-4, 1); c.lineTo(0, 1); c.lineTo(-1.5, 8); c.lineTo(4, -1); c.lineTo(0, -1); c.closePath(); c.fillStyle = pal.deep; c.fill();
      c.restore(); return;
    }
    if (p.k === "w") {
      // Weapon Pod pickup: ringed emerald diamond carrying a temporary weapon swap.
      const pulse = env.G?.calm ? 0 : Math.sin(T * 6) * 1.8;
      c.beginPath(); c.arc(0, 0, 17 + pulse, 0, TAU); c.strokeStyle = pal.deep; c.lineWidth = 1.3; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.moveTo(0, -12); c.lineTo(11, 0); c.lineTo(0, 12); c.lineTo(-11, 0); c.closePath();
      c.fillStyle = pal.wash; c.fill(); c.strokeStyle = pal.ink; c.lineWidth = 1.8; c.stroke();
      c.beginPath(); c.moveTo(-4, 2); c.lineTo(0, -5); c.lineTo(4, 2); c.moveTo(0, -4); c.lineTo(0, 5);
      c.strokeStyle = pal.deep; c.lineWidth = 2; c.lineCap = "round"; c.lineJoin = "round"; c.stroke();
      c.restore(); return;
    }
    c.beginPath(); c.arc(0, 0, p.k === "s" ? 8 : 13, 0, TAU);
    c.fillStyle = pal.card; c.fill(); c.strokeStyle = pal.deep; c.lineWidth = 1.4; c.stroke();
    if (p.k === "s") {
      c.beginPath(); c.moveTo(0,-6); c.lineTo(1.6,-1.6); c.lineTo(5.5,0); c.lineTo(1.6,1.6);
      c.lineTo(0,6); c.lineTo(-1.6,1.6); c.lineTo(-5.5,0); c.lineTo(-1.6,-1.6); c.closePath(); c.fillStyle = pal.deep; c.fill();
    }
    else if (p.k === "c") { c.rotate(Math.sin(T * 4) * 0.25); box(c, -9, -6.5, 18, 13, 2.5); c.fillStyle = pal.wash; c.fill(); c.strokeStyle = pal.deep; c.lineWidth = 1.8; c.stroke(); c.beginPath(); c.moveTo(-5, -1.5); c.lineTo(5, -1.5); c.moveTo(-5, 2.5); c.lineTo(2, 2.5); c.stroke(); }
    else { const s = 1 + Math.sin(T * 8) * 0.12; c.scale(s, s); c.beginPath(); c.moveTo(0, 6.5); c.lineTo(-7, -0.5); c.lineTo(-7, -4.5); c.lineTo(-3.5, -7); c.lineTo(0, -4); c.lineTo(3.5, -7); c.lineTo(7, -4.5); c.lineTo(7, -0.5); c.closePath(); c.fillStyle = pal.red; c.fill(); c.strokeStyle = pal.ink; c.lineWidth = 1.4; c.stroke(); }
    c.restore();
  }
  function install(G) {
    const ghosts = [], mood = { glyph: "", until: 0 }; moods.set(G, mood);
    const show = (glyph, time) => { mood.glyph = glyph; mood.until = G.T + time; };
    G.on("start", () => { ghosts.length = 0; mood.until = mood.revive = 0; mood.hint = firstFlight ? Infinity : 0; firstFlight = false; });
    G.on("play", () => { if (mood.hint) mood.hint = G.T + 2; });
    G.on("revive", () => { mood.revive = G.T + 1.05; });
    G.on("graze", () => { if (G.T >= mood.until) show("", .32); });
    G.on("multUp", ({mult}) => show("×" + mult, .65));
    G.on("gateResolve", ({ok}) => show(ok ? "✓" : "?", .7));
    function ghost(e, role, x, y, ch) {
      const boss = role === "wall", seg = role === "wormseg", toy = G.toy;
      const size = boss ? e.h * 1.2 : seg ? 25 : role === "myth" ? 58 : (e.r || 15) * 2.7;
      const img = toy && clip(toy, boss ? "wall-fall" : role);
      if (ghosts.length >= 32) ghosts.shift();
      ghosts.push({ e, role, x, y, size, img, toy, ch, half: e.half, start: G.T, life: boss ? .84 : seg ? .32 : .25 });
    }
    G.on("kill", ({e}) => {
      const role = e.look || e.k;
      ghost(e, role, G.toy && role === "myth" ? e.x - e.w / 2 + 22 : e.x, e.y, e.sym || (role === "wall" ? "¶" : "·"));
    });
    G.on("segPop", ({e,x,y,ch}) => ghost(e, "wormseg", x, y, ch));
    G.hook("draw.back", env => {
      const c = G.c;
      c.save(); c.strokeStyle = env.pal.soft; c.globalAlpha *= .48; c.lineWidth = 1.5; c.beginPath();
      for (const e of G.foes) {
        const h = e.hub;
        if (!h || h.broken || e.dead) continue;
        const next = h.m[(e.i + 1) % h.n];
        if (!next || next.dead) continue;
        c.moveTo(e.x, e.y); c.lineTo(next.x, next.y);
      }
      c.stroke(); c.restore();
      const boss = G.boss;
      if (boss && !boss.dead) {
        c.save(); c.strokeStyle = env.pal.soft; c.lineWidth = 1.6; c.lineCap = "round";
        if (boss.move === "throw") {
          c.beginPath();
          for (const b of boss.held || []) {
            if (b.dead || !b.safe || Math.hypot(b.x - b.hx, b.y - b.hy) > 35) continue;
            const grip = boss.x + Math.sign(b.hx - boss.x) * boss.w * .29;
            c.moveTo(grip, boss.y + boss.h * .18);
            c.quadraticCurveTo(grip, b.y - 18, b.x, b.y - b.wh * .55);
          }
          c.stroke();
        }
        c.setLineDash([1, 5]); c.beginPath();
        for (const note of boss.notes || []) if (note.boss === boss && !note.dead) {
          c.moveTo(boss.x, boss.y); c.lineTo(note.x, note.y);
        }
        c.stroke(); c.restore();
      }
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i], age = G.T - g.start, u = age / g.life;
        if (u >= 1) { ghosts.splice(i,1); continue; }
        const boss = g.role === "wall", seg = g.role === "wormseg";
        c.save(); c.translate(g.x, g.y + (G.calm ? 0 : u * u * 8));
        c.globalAlpha *= Math.min(.85, (1 - u) * 3);
        if (g.img?.naturalWidth) frame(c, g.img, boss ? Math.min(7, Math.floor(age * 10)) : seg ? 5 + Math.min(2, Math.floor(age * 10)) : g.role === "kid" ? (g.half ? 7 : 3) : 7, 0, 0, g.size);
        else {
          c.rotate(G.calm ? 0 : u * .18); c.scale(1 + u * .12, 1 - u * .55);
          const slot = ["drift","spin","split","dart","worm","myth","wall"].indexOf(g.role);
          if (g.toy && slot >= 0) cellAt(c, g.toy, slot, 0, 0, g.size, g.role === "worm" ? [0,0,.34,1] : null);
          else if (!seg) {
            c.translate(-g.e.x, -g.e.y);
            drawFoe(c, g.e, env);
          }
        }
        if (seg) label(c, env, g.ch, 0, -u * 8, 11, env.pal.ink);
        c.restore();
      }
    });
  }
  return { install, PAL, MONO, SERIF, TAU, hash, boil, smooth, blob, box, drawFoe, drawPlayer, drawPickup, portrait, cellAt };
})();
