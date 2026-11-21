import { chooseMiniboss, minibossRoster } from "./miniboss-roster.js";

// Each row is a windup, one committed attack, and a vulnerable recovery in seconds.
const timing = {
  clip: [1.08, .70, 1.15],
  pinwheel: [1.12, .86, .97],
  magnet: [1.16, 1.18, .78],
};
const BODY = -6;
const cycles = 3;
const survivalCharge = .03;

function distanceToTrack(x, y, { x0, y0, x1, y1 }) {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - x0 - dx * t, y - y0 - dy * t);
}

// Outward ray to the last visible point on the page. Magnet tokens travel the same segment in reverse.
function edgeTrack(G, x, y, angle, bottom = G.H, inset = 10) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const tx = Math.abs(dx) < .0001 ? Infinity : ((dx > 0 ? G.W - inset : inset) - x) / dx;
  const ty = Math.abs(dy) < .0001 ? Infinity : ((dy > 0 ? bottom - inset : inset) - y) / dy;
  const length = Math.min(tx, ty);
  return { x0: x, y0: y, x1: x + dx * length, y1: y + dy * length, angle };
}

function dockTop(G) {
  const dock = G.o?.dock?.getBoundingClientRect?.(), arena = G.o?.arena?.getBoundingClientRect?.();
  const top = dock && arena && dock.height > 0 ? dock.top - arena.top : G.floorY - 4;
  return Number.isFinite(top) && top >= 72 ? Math.min(top, G.H) : G.H - Math.min(60, G.H * .15);
}

function washerTrack(G, e, x, y, angle, seated) {
  const inset = 17;
  const track = edgeTrack(G, x, y, angle, e.playBottom, inset);
  const clearSeat = (sx, sy) => Math.hypot(sx - G.P.x, sy - G.P.y) >= 40
    && seated.every(other => Math.hypot(sx - other.x1, sy - other.y1) >= 22);
  // A pilot close to a rail, or two tracks converging in a short arena, can cover a seat.
  // Choose the nearest clear place on the visible perimeter before the tell locks.
  if (!clearSeat(track.x1, track.y1)) {
    const startX = track.x1, startY = track.y1;
    let best = Infinity;
    const consider = (sx, sy) => {
      const distance = Math.hypot(sx - startX, sy - startY);
      if (distance < best && clearSeat(sx, sy)) { best = distance; track.x1 = sx; track.y1 = sy; }
    };
    for (let sx = inset; sx <= G.W - inset; sx += 8) { consider(sx, inset); consider(sx, e.playBottom - inset); }
    for (let sy = inset; sy <= e.playBottom - inset; sy += 8) { consider(inset, sy); consider(G.W - inset, sy); }
    track.angle = Math.atan2(track.y1 - y, track.x1 - x);
  }
  seated.push(track);
  return track;
}

function setPhase(e, phase, pose, duration) {
  e.phase = phase; e.age = 0; e.duration = duration; e.bossPose = pose;
  e.act = phase === "warn" ? "windup" : phase === "strike" ? "attack" : "idle";
  e.actT = 0;
}

function warn(G, e) {
  e.cycle++;
  e.playBottom = dockTop(G);
  setPhase(e, "warn", 1, timing[e.bossId][0] + (e.cycle === 1 ? .7 : 0) + (G.calm ? .22 : 0));
  if (e.bossId === "clip") {
    const margin = e.w * .5 + 3;
    const y = G.clamp(G.P.y, e.h * .45 + 3, e.playBottom - e.h * .45 - 3);
    e.fromY = e.y;
    e.tracks = [{ x0: e.x, y0: y, x1: e.x < G.W / 2 ? G.W - margin : margin, y1: y }];
  } else if (e.bossId === "pinwheel") {
    const spacing = G.calm ? .52 : .44;
    // The second fan turns half a blade: the first volley's centre line becomes a gap.
    const heading = G.aim(e.x, e.y) + (e.cycle === 2 ? spacing / 2 : 0);
    e.tracks = [-2, -1, 0, 1, 2].map(i => edgeTrack(G, e.x, e.y, heading + i * spacing));
  } else {
    const seated = [];
    e.tracks = [-1, 0, 1].map(i => {
      const pole = i || (e.cycle % 2 ? -1 : 1);
      const x = e.x + pole * e.w * .19, y = e.y + e.h * .24;
      const angle = G.aim(x, y) + i * (G.calm ? .62 : .52);
      return washerTrack(G, e, x, y, angle, seated);
    });
  }
  G.emit("telegraph", { e });
}

function strike(G, e) {
  setPhase(e, "strike", 2, timing[e.bossId][1]);
  G.emit("attack", { e, kind: e.bossId });
  if (e.bossId === "pinwheel") {
    for (const track of e.tracks) {
      const x = e.x + Math.cos(track.angle) * e.r, y = e.y + Math.sin(track.angle) * e.r;
      // Closing in on the toy is legal. Never materialize a pellet on the player's dot.
      if (Math.hypot(x - G.P.x, y - G.P.y) > 35) G.fire(x, y, track.angle, G.calm ? 143 : 161, 1, { miniOwner: e });
    }
  } else if (e.bossId === "magnet") {
    for (const track of e.tracks) {
      const distance = Math.hypot(track.x1 - track.x0, track.y1 - track.y0);
      G.fire(track.x1, track.y1, track.angle + Math.PI, distance / e.duration, "miniWasher",
        { miniOwner: e, track, recallTime: e.duration, lastX: track.x1, lastY: track.y1 });
    }
  }
}

function clear(G, e) {
  e.tracks = [];
  G.bul = G.bul.filter(b => b.miniOwner !== e);
  G.miniboss = null;
}

function finish(G, e, defeated) {
  if (G.miniboss !== e) return;
  clear(G, e);
  let charge = 0;
  if (defeated) {
    const defeatedNames = G.res.minibosses ??= [];
    if (!defeatedNames.includes(e.name)) defeatedNames.push(e.name);
    G.addPick("e", e.x, e.y, true);
    G.o?.minibossNotice?.(e.name + " defeated. A charge cell dropped.");
  } else {
    e.dead = 2; // it left the page. Core scores only G.kill().
    const before = G.energy;
    G.refill(survivalCharge);
    charge = G.energy - before;
    const percent = Number((charge * 100).toPrecision(2));
    const reward = percent ? "Charge +" + percent + "%" : "";
    G.J?.pop(G.clamp(G.P.x, 78, G.W - 78), G.P.y - 38, reward ? "Escaped · " + reward : "Escaped", G.pal.deep, 13, 1.2);
    G.o?.minibossNotice?.(e.name + " withdrew." + (reward ? " " + reward + "." : ""));
  }
  G.emit("minibossEnd", { e, name: e.name, defeated, charge });
}

function update(G, e, dt) {
  if (e.dead || G.miniboss !== e || G.state !== "play") return;
  e.age += dt;
  const progress = Math.min(1, e.age / e.duration);
  const wind = !G.calm && e.phase === "warn" ? progress * progress : 0;
  const snap = !G.calm && e.phase === "strike" ? Math.max(0, 1 - progress * 3) : 0;
  if (e.bossId === "clip") {
    e.sx = 1 - .10 * wind + .15 * snap; e.sy = 1 + .08 * wind - .09 * snap;
  } else if (e.bossId === "pinwheel") {
    const turn = e.cycle % 2 ? 1 : -1;
    e.rot = turn * (-.15 * wind + .18 * snap);
  } else {
    e.sy = 1 - .055 * wind + .065 * snap;
  }
  if (e.bossId === "clip" && (e.phase === "warn" || e.phase === "strike")) {
    const track = e.tracks[0];
    if (e.phase === "warn") {
      e.y = G.lerp(e.fromY, track.y0, Math.min(1, progress * 2));
    } else {
      const lastX = e.x;
      e.x = G.lerp(track.x0, track.x1, progress * progress * (3 - 2 * progress));
      if (distanceToTrack(G.P.x, G.P.y, { x0: lastX, y0: e.y, x1: e.x, y1: e.y }) < e.r + BODY) G.hitPlayer();
    }
  }
  if (e.phase === "recover" && e.cycle === cycles && e.duration - e.age < .3) {
    const slip = Math.min(1, 1 - (e.duration - e.age) / .3);
    const edge = e.exitX < G.W / 2 ? -e.w / 2 : G.W + e.w / 2;
    e.bossPose = 0; e.x = G.lerp(e.exitX, edge, slip * slip);
  }
  if (progress < 1) return;
  if (e.phase === "warn") strike(G, e);
  else if (e.phase === "strike") {
    setPhase(e, "recover", 3, timing[e.bossId][2]);
    // Each exertion costs the toy a wind. The last wind is its escape, never a free kill.
    if (e.cycle < cycles) e.hp = Math.min(e.hp, e.max * (cycles - e.cycle) / cycles);
    e.exitX = e.x;
  }
  else if (e.cycle < cycles) warn(G, e);
  else finish(G, e, false);
}

function threat(G, e, x, y) {
  if (e.phase !== "warn" && e.phase !== "strike") return 0;
  const distance = Math.min(...e.tracks.map(track => distanceToTrack(x, y, track)));
  const margin = e.bossId === "clip" ? e.r + 14 : 22;
  return Math.max(0, 1 - distance / margin) * 170;
}

// A washer has a punched hole. The same silhouette parks at its launch point during the whole tell.
function washer(c, x, y, pal) {
  c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.arc(x, y, 2.7, 0, Math.PI * 2, true);
  c.fillStyle = pal.faint; c.fill(); c.strokeStyle = pal.ink; c.lineWidth = 1.2; c.stroke();
}

// Put the arrowheads immediately in front of the metal, both while parked and while moving.
function pullArrows(c, x, y, track, pal, preview) {
  const dx = track.x0 - x, dy = track.y0 - y, distance = Math.hypot(dx, dy);
  if (distance < 14) return;
  const ux = dx / distance, uy = dy / distance;
  c.beginPath();
  for (const step of preview ? [16, 27] : [14]) {
    if (step >= distance) break;
    const tipX = x + ux * step, tipY = y + uy * step;
    c.moveTo(tipX - ux * 6 - uy * 5, tipY - uy * 6 + ux * 5);
    c.lineTo(tipX, tipY);
    c.lineTo(tipX - ux * 6 + uy * 5, tipY - uy * 6 - ux * 5);
  }
  c.lineCap = "round"; c.lineJoin = "round";
  c.strokeStyle = pal.card; c.lineWidth = 4.5; c.stroke();
  c.strokeStyle = pal.red; c.lineWidth = 2.5; c.stroke();
}

function drawTracks(G, e, pal) {
  if (e.phase !== "warn" && e.phase !== "strike") return;
  const c = G.c, warning = e.phase === "warn", isClip = e.bossId === "clip", magnet = e.bossId === "magnet";
  // In flight only the projectiles or the moving jaws hit; the pencil lines stay faint.
  c.save(); c.globalAlpha = warning ? .65 : .25;
  c.strokeStyle = pal.red; c.lineWidth = warning ? 1.8 : 1.1; c.setLineDash(warning ? [6, 5] : [2, 6]);
  c.beginPath();
  for (const t of e.tracks) {
    if (isClip) {
      for (const offset of [-1, 1]) {
        const y = t.y0 + offset * (e.r + BODY);
        c.moveTo(t.x0, y); c.lineTo(t.x1, y);
      }
    } else { c.moveTo(t.x0, t.y0); c.lineTo(t.x1, t.y1); }
  }
  c.stroke(); c.setLineDash([]); c.globalAlpha = warning ? 1 : .5;
  // The magnet seats get their own foreground pass so jets cannot cover a parked washer.
  if (magnet) { c.restore(); return; }
  for (const t of e.tracks) {
    const a = t.angle ?? Math.atan2(t.y1 - t.y0, t.x1 - t.x0);
    const q = isClip ? .55 : .32;
    const x = G.lerp(t.x0, t.x1, q), y = G.lerp(t.y0, t.y1, q);
    c.strokeStyle = pal.red; c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(x - 7 * Math.cos(a - .48), y - 7 * Math.sin(a - .48));
    c.lineTo(x, y); c.lineTo(x - 7 * Math.cos(a + .48), y - 7 * Math.sin(a + .48)); c.stroke();
  }
  c.restore();
}

function drawGauge(G, e, pal) {
  const c = G.c, w = e.w * .63;
  const below = e.y + e.h * .43 + 7, bottom = e.playBottom - 8;
  const showName = e.cycle === 1 && e.phase === "warn";
  const above = below + (showName ? 20 : 4) > bottom;
  const y = above ? G.clamp(e.y - e.h * .45 - 9, 20, bottom - 4) : below;
  c.save();
  c.fillStyle = pal.card; c.fillRect(e.x - w / 2, y, w, 4);
  c.fillStyle = e.phase === "recover" ? pal.deep : pal.red;
  c.fillRect(e.x - w / 2, y, w * Math.max(0, e.hp / e.max), 4);
  c.strokeStyle = pal.ink; c.lineWidth = 1; c.strokeRect(e.x - w / 2, y, w, 4);
  c.beginPath();
  for (const fraction of [1 / 3, 2 / 3]) {
    const x = e.x - w / 2 + w * fraction;
    c.moveTo(x, y); c.lineTo(x, y + 4);
  }
  c.stroke();
  if (showName) {
    c.textAlign = "center"; c.font = "bold 12px " + G.MONO;
    const half = c.measureText(e.name).width / 2 + 4, x = G.clamp(e.x, half, G.W - half);
    const baseline = above ? y - 5 : y + 17;
    c.lineWidth = 3; c.strokeStyle = pal.card; c.strokeText(e.name, x, baseline);
    c.fillStyle = pal.ink; c.fillText(e.name, x, baseline);
  }
  c.restore();
}

export function installMinibosses(G) {
  G.miniboss = null;
  G.bullets ??= {};
  G.bullets.miniWasher = {
    r: 6, glow: false,
    move(G, b) {
      const t = Math.min(1, b.t / b.recallTime);
      b.lastX = b.x; b.lastY = b.y;
      b.x = G.lerp(b.track.x1, b.track.x0, t); b.y = G.lerp(b.track.y1, b.track.y0, t);
      if (t === 1) { b.dead = true; b.safe = true; }
    },
    hits(G, b, x, y) { return distanceToTrack(x, y, { x0: b.lastX, y0: b.lastY, x1: b.x, y1: b.y }) < 6; },
    draw(c, list, { pal }) {
      c.save();
      for (const b of list) { washer(c, b.x, b.y, pal); pullArrows(c, b.x, b.y, b.track, pal, false); }
      c.restore();
    },
  };
  G.kinds.mini = {
    body: BODY, drops: 6, update, threat,
    hit(G, e, x, y, pad) {
      if (e.dead || pad === BODY) return null;
      return Math.hypot((x - e.x) / (e.w * .38 + pad), (y - e.y) / (e.h * .36 + pad)) < 1 ? e.hitPart : null;
    },
    hitPart(G, e, part, d, x, y, ang) {
      const open = e.phase === "recover";
      G.hurtFoe(e, d * (open ? 2 : .5), x, y, ang, open);
    },
    death(G, e) { finish(G, e, true); },
  };
  G.hook("draw.back", ({ pal }) => { if (G.miniboss) drawTracks(G, G.miniboss, pal); });
  G.hook("draw.over", ({ pal }) => {
    const e = G.miniboss;
    if (!e) return;
    if (e.bossId === "magnet" && e.phase === "warn") {
      const c = G.c;
      c.save();
      for (const t of e.tracks) { washer(c, t.x1, t.y1, pal); pullArrows(c, t.x1, t.y1, t, pal, true); }
      c.restore();
    }
    drawGauge(G, e, pal);
  });
  for (const event of ["start", "gateStart", "finish"]) G.on(event, () => {
    const e = G.miniboss;
    if (e) { e.dead = 2; clear(G, e); }
  });
}

export function spawnMiniboss(G, override) {
  if (G.miniboss || G.boss || G.gates || G.state !== "play") return;
  const owner = G.o?.arena?.ownerDocument ?? G.o?.arena ?? G;
  const id = chooseMiniboss(G.pack, owner, override), { name, cue } = minibossRoster[id];
  const size = G.clamp(G.W * .19, 56, 82), left = G.P.x >= G.W / 2;
  const w = size, h = size * (id === "clip" ? .82 : id === "magnet" ? .9 : 1);
  const x = id === "clip" ? (left ? w / 2 + 3 : G.W - w / 2 - 3) : G.W * (left ? .31 : .69);
  const laneY = id === "clip" ? G.P.y : G.H * (G.P.y > G.H * .42 ? .22 : .68);
  // Both magnet poles must sit inside the rails, including a squat flight with a tall composer.
  const clearance = id === "magnet" ? Math.max(h * .45 + 3, h * .24 + 20) : h * .45 + 3;
  const y = G.clamp(laneY, clearance, dockTop(G) - clearance);
  const e = G.mk("mini", x, y, { name, bossId: id, w, h, hp: 114, r: size * .33, pts: 600, cycle: 0, hitPart: {} });
  G.cancelBullets(false);
  G.miniboss = e; G.label = name; G.spawn(e); warn(G, e);
  G.emit("minibossSpawn", { e, name });
  G.o?.minibossNotice?.(name + ". " + cue);
  return e;
}
