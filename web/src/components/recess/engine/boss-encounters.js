import { bossRoster } from "./boss-roster.js";
import { studioBosses } from "./studio-bosses.js";

const TAU = 2 * Math.PI;
const BODY = -8;
const WINDOW = 2.1;
const ROUNDS = 4;
const INK_WIDTH = 10;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
const ease = t => { const v = clamp(t, 0, 1); return v * v * (3 - 2 * v); };
const step = (phase, seconds, beat = 0) => ({ phase, seconds, beat });
const rest = step("recover", WINDOW);
const compassSteps = [step("warn", 1.15), step("strike", .48), step("warn", 1.05, 1), step("strike", .48, 1), rest];
const cellSteps = [step("warn", 1.2), step("strike", 1.5), rest];
const downbeat = [step("warn", 1.1), step("strike", 1.03), step("warn", .95, 1), step("strike", 1.03, 1), rest];
const backbeat = [step("warn", 1.1), step("strike", 1.03), step("rest", .8, 1), step("warn", .95, 1), step("strike", 1.03, 1), rest];
const proofSteps = [step("warn", 2.2), step("strike", .43), step("warn", .9, 1), step("strike", .43, 1), step("warn", .9, 2), step("strike", .43, 2), rest];
const stillLight = [step("warn", 1.65), step("strike", .52), rest];
const crosslight = [step("warn", 1.65), step("strike", .52), step("warn", 1.45, 1), step("strike", .52, 1), rest];

function prepareCompass(G, e, beat) {
  const base = clamp(Math.min(G.W, G.H) * .24, 62, 142);
  if (!beat) {
    e.radius = base;
    e.pivot = { x: clamp(G.P.x, 35, G.W - 35), y: clamp(G.P.y - base, 45, G.H - base * .6) };
  } else if (e.bossVariant === 0) {
    e.radius = base + Math.min(44, base * .48);
  } else {
    const direction = e.pivot.x < G.W / 2 ? 1 : -1;
    e.pivot = { x: e.pivot.x + direction * Math.min(105, G.W * .24), y: e.pivot.y };
  }
}

function ringDistance(e, x, y) {
  return Math.abs(Math.hypot(x - e.pivot.x, y - e.pivot.y) - e.radius);
}

function compassUpdate(G, e, dt) {
  if (e.phase === "warn" || e.phase === "strike") {
    const q = 1 - Math.exp(-dt * 4);
    e.x = mix(e.x, clamp(e.pivot.x, e.w / 2, G.W - e.w / 2), q);
    if (e.phase === "strike" && ringDistance(e, G.P.x, G.P.y) <= INK_WIDTH / 2 + 3) G.hitPlayer();
  }
}

function compassDraw(G, e, c, p) {
  const { x, y } = e.pivot;
  const live = e.phase === "strike";
  c.strokeStyle = p.soft; c.lineWidth = 1;
  c.beginPath(); c.moveTo(e.x, e.y + e.h * .18); c.lineTo(x, y); c.stroke();
  c.strokeStyle = p.ink;
  c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x + 6, y); c.moveTo(x, y - 6); c.lineTo(x, y + 6); c.stroke();
  c.strokeStyle = p.red;
  c.setLineDash(live ? [] : [9, 6]);
  c.lineWidth = live ? INK_WIDTH : 2;
  // The outside pencil marks bound the exact strip the nib will ink.
  const radii = live ? [e.radius] : [e.radius - INK_WIDTH / 2, e.radius + INK_WIDTH / 2];
  for (const r of radii) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); }
  c.setLineDash([]);
  const angle = live ? Math.PI * 1.5 : -Math.PI / 2 + TAU * clamp(e.age / e.duration, 0, 1);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  c.fillStyle = live ? p.core : p.ink; c.beginPath();
  c.arc(x + e.radius * dx, y + e.radius * dy, 4, 0, TAU); c.fill();
}

function prepareCell(G, e) {
  e.targetX = clamp(G.P.x, e.w / 2 + 3, G.W - e.w / 2 - 3);
  e.targetY = clamp(G.P.y, e.ty + 28, Math.min(G.floorY - 18, G.H - e.h * .28));
  e.lobeStart = e.bossLobes.map(p => ({ ...p }));
  const halfSeam = Math.min(63, (G.W - e.w - 12) / 2);
  const halfSpan = halfSeam + e.w * .25;
  const outside = e.w * .25 + halfSpan + 3;
  e.seamX = clamp(e.targetX, outside, G.W - outside);
  e.ends = [e.seamX - halfSpan, e.seamX + halfSpan];
  e.shed = false;
}

function landingX(e, i) {
  // The first bud actually dives onto the bait. In Fission the two pads overlap there before they split.
  const side = i === 0 ? -1 : 1;
  if (e.bossVariant === 0) return e.targetX + (i === e.round % 2 ? 0 : side * e.w * .24);
  return e.targetX + side * e.w * .09;
}

function diveAge(e, i, age) {
  return age - (e.bossVariant === 0 && i !== e.round % 2 ? .28 : 0);
}

function divePosition(e, i, age, point) {
  const t = diveAge(e, i, age), dive = ease(t / .50), split = ease((t - .5) / .48);
  const homeX = e.targetX + (i === 0 ? -1 : 1) * e.w * .25;
  point.x = mix(mix(homeX, landingX(e, i), dive), e.ends[i], split);
  point.y = mix(mix(e.ty, e.targetY, dive), e.targetY - 15, split);
  return point;
}

function cellUpdate(G, e) {
  if (e.phase === "recover") return;
  const warning = e.phase === "warn";
  for (const [i, point] of e.bossLobes.entries()) {
    const homeX = e.targetX + (i === 0 ? -1 : 1) * e.w * .25;
    if (warning) {
      const q = ease(e.age / (e.duration * .7));
      point.x = mix(e.lobeStart[i].x, homeX, q); point.y = mix(e.lobeStart[i].y, e.ty, q);
      continue;
    }
    // Budding sends one lobe first; Fission makes a simultaneous paired dive.
    divePosition(e, i, e.age, point);
  }
  const [left, right] = e.bossLobes;
  e.x = (left.x + right.x) / 2; e.y = (left.y + right.y) / 2;
  if (!warning && !e.shed && e.age >= 1.28) {
    e.shed = true;
    for (const [i, lobe] of e.bossLobes.entries()) {
      for (const slope of [.23, .49, .78]) {
        const angle = Math.PI / 2 + (i === 0 ? 1 : -1) * slope;
        const x = lobe.x + (i === 0 ? -1 : 1) * e.w * .18, y = lobe.y + 10;
        if (Math.hypot(x - G.P.x, y - G.P.y) > 45) G.fire(x, y, angle, G.calm ? 104 : 140, 1);
      }
    }
  }
}

function cellPadActive(e, center) {
  // Hold the mark until every lobe headed for this pad has swept clear of its outline.
  const rx = e.w * .44 + BODY, ry = e.h * (.24 + .27) + BODY;
  return e.bossLobes.some((lobe, i) =>
    (diveAge(e, i, e.age) < .5 && Math.abs(landingX(e, i) - center) <= rx) ||
    ((lobe.x - center) / rx) ** 2 + ((lobe.y - e.targetY) / ry) ** 2 <= 1);
}

function cellDraw(G, e, c, p) {
  const live = e.phase === "strike";
  c.strokeStyle = p.red;
  for (let i = 0; i < 2; i++) {
    const center = landingX(e, i), lobe = e.bossLobes[i], t = diveAge(e, i, e.age);
    if (!live || t < .98) {
      c.lineWidth = live ? 2 : 1.7; c.setLineDash(live ? [] : [7, 6]); c.beginPath();
      c.moveTo(lobe.x, lobe.y);
      if (!live || t < .5) c.lineTo(center, e.targetY);
      c.lineTo(e.ends[i], e.targetY - 15); c.stroke(); c.setLineDash([]);
    }
    if (!live || cellPadActive(e, center)) {
      c.lineWidth = live || e.bossVariant === 1 || i === e.round % 2 ? 2.8 : 1.2;
      c.beginPath(); c.ellipse(center, e.targetY, e.w * .22, e.h * .24, 0, 0, TAU); c.stroke();
    }
    if (live) {
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(lobe.x, lobe.y, e.w * .22 + BODY, e.h * .27 + BODY, 0, 0, TAU); c.stroke();
    }
  }
}

function prepareBeat(G, e, beat) {
  if (!beat) e.firstSide = G.P.x < G.W / 2 ? -1 : 1;
  e.beatSide = beat && e.bossVariant === 0 ? -e.firstSide : e.firstSide;
  const half = G.W / 2, left = e.beatSide < 0 ? 10 : half, right = e.beatSide < 0 ? half : G.W - 10;
  // Lock a note to the pilot on the marked side. The columns stay fixed after the lamp comes on.
  const anchor = clamp(G.P.x, left, right), spacing = 32;
  e.beatXs = [];
  for (let i = Math.ceil((left - anchor) / spacing); i <= Math.floor((right - anchor) / spacing); i++) {
    e.beatXs.push(anchor + i * spacing);
  }
}

function beatVolley(G, e) {
  const y = Math.max(12, e.y + e.h * .29);
  const speed = (G.H - y + 20) / .94;
  for (const x of e.beatXs) if (Math.hypot(x - G.P.x, y - G.P.y) > 45) {
    G.fire(x, y, Math.PI / 2, speed, 2);
  }
}

function beatDraw(G, e, c, p) {
  const held = e.phase === "rest", startY = e.y + e.h * .29;
  if (e.phase === "warn") {
    c.strokeStyle = p.red; c.lineWidth = 1.4; c.setLineDash([4, 10]);
    c.beginPath();
    for (const x of e.beatXs) { c.moveTo(x, startY + 14); c.lineTo(x, Math.min(G.H - 14, G.floorY)); }
    c.stroke(); c.setLineDash([]);
  }
  // A visible arm and two beat lamps give the same information while muted and in Calm.
  const span = Math.min(67, e.w * .52), y = e.y - e.h * .13;
  const x0 = e.x + e.beatSide * e.w * .27, x1 = x0 + e.beatSide * span;
  c.strokeStyle = held ? p.soft : p.red; c.fillStyle = held ? p.paper : p.red; c.lineWidth = 3;
  c.beginPath(); c.moveTo(x0, y + 10); c.lineTo(x1, y); c.lineTo(x1 - e.beatSide * 6, y + 7); c.stroke();
  c.beginPath(); c.arc(x1, y, held ? 6 : 4, 0, TAU); c.fill(); c.stroke();
  for (let i = 0; i < 2; i++) {
    c.beginPath(); c.arc(e.x + (i === 0 ? -6 : 6), e.y + e.h * .44, 3, 0, TAU);
    c.stroke(); if (!held && i === e.beat) c.fill();
  }
}

function sequence(e) {
  if (e.bossId === "compass") return compassSteps;
  if (e.bossId === "cell") return cellSteps;
  if (e.bossId === "carbon") return proofSteps;
  if (e.bossId === "projector") return e.bossVariant === 0 ? stillLight : crosslight;
  return e.bossVariant === 0 ? downbeat : backbeat;
}

function enter(G, e, index) {
  const { phase, seconds, beat } = sequence(e)[index];
  e.index = index; e.phase = phase; e.age = 0; e.beat = beat;
  e.duration = seconds;
  e.actT = 0;
  if (phase === "warn") {
    e.bossPose = 1; e.act = "windup";
    if (e.bossId === "compass") prepareCompass(G, e, beat);
    else if (e.bossId === "cell") prepareCell(G, e);
    else if (e.bossId === "metronome") prepareBeat(G, e, beat);
    else {
      if (!beat) e.cleanRead = true;
      studioBosses[e.bossId].prepare(G, e, beat);
    }
    // The entrance title shares the field with the very first tell. Leave time
    // to read it even when practice has skipped the dialogue.
    if (e.round === 0 && index === 0) e.duration += .7;
    if (G.calm) e.duration += .25;
    G.emit("telegraph", { e });
  } else if (phase === "strike") {
    e.bossPose = 2; e.act = "attack";
    if (e.bossId === "metronome") beatVolley(G, e);
    G.emit("attack", { e, kind: e.bossId });
  } else {
    e.bossPose = phase === "recover" ? 3 : 0; e.act = "idle";
  }
}

function weakPoint(G, e, px) {
  if (e.bossLobes) return e.bossLobes[px < e.x ? 0 : 1];
  if (e.bossId === "metronome" && e.phase === "recover") return { x: e.x + e.w * .27, y: e.y + e.h * .055 };
  if (studioBosses[e.bossId] && e.phase === "recover") return { x: e.x, y: e.y + e.h * studioBosses[e.bossId].jointY };
  return e;
}

function update(G, e, dt) {
  if (G.state !== "play") return;
  if (e.stage < 0) {
    e.y = mix(e.y, e.ty, 1 - Math.exp(-dt * 4));
    if (e.y < e.ty - 3) return;
    e.y = e.ty; e.stage = 0;
    G.cancelBullets(true);
    if (e.bossId === "cell") e.bossLobes = [{ x: e.x - e.w * .25, y: e.y }, { x: e.x + e.w * .25, y: e.y }];
    G.emit("bossPhase", { e, stage: 0, first: true, name: bossRoster[e.bossId].variants[e.bossVariant], x: e.x, y: e.y + e.h / 2 });
    enter(G, e, 0);
    return;
  }
  e.age += dt;
  if (e.bossId === "compass") compassUpdate(G, e, dt);
  else if (e.bossId === "cell") cellUpdate(G, e);
  else if (studioBosses[e.bossId]?.update(G, e)) {
    e.cleanRead = false;
    G.hitPlayer();
  }
  if (e.age < e.duration) return;
  if (e.phase !== "recover") {
    enter(G, e, e.index + 1);
    if (e.phase === "recover" && e.cleanRead) {
      // A missed print run or a fully screened flash strains the mechanism. Its
      // open panel spills real charge sparks before the pilot takes the shot.
      const p = weakPoint(G, e, G.P.x);
      for (const dx of [-12, 0, 12]) G.addPick("s", p.x + dx, p.y, true);
      G.hurtFoe(e, e.max * .12, p.x, p.y);
    }
    return;
  }

  // Each completed exertion tires the opponent. A pilot without firing charge can still outlast four rounds.
  ++e.round;
  const ceiling = e.max * (1 - e.round / ROUNDS);
  if (e.hp > ceiling) G.hurtFoe(e, e.hp - ceiling, e.x, e.y);
  if (!e.dead) enter(G, e, 0);
}

function ellipseHit(x, y, point, rx, ry, pad) {
  return ((x - point.x) / (rx + pad)) ** 2 + ((y - point.y) / (ry + pad)) ** 2 <= 1;
}

function hit(G, e, x, y, pad) {
  // The press and projector reach the pilot through marks and light. Their cases do not lunge.
  if (e.stage < 0 || (pad === BODY && (e.phase !== "strike" || studioBosses[e.bossId]))) return null;
  if (e.bossLobes) return e.bossLobes.find(p => ellipseHit(x, y, p, e.w * .22, e.h * .27, pad)) ?? null;
  if (e.bossId === "metronome" && e.phase === "recover") {
    const key = weakPoint(G, e, x);
    if (Math.hypot(x - key.x, y - key.y) <= e.w * .24 + pad) return e.hitPart;
  }
  return ellipseHit(x, y, e, e.w * .34, e.h * .39, pad) ? e.hitPart : null;
}

function pathDistance(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

function threat(G, e, x, y) {
  if (e.stage < 0 || (e.phase !== "warn" && e.phase !== "strike")) return 0;
  if (studioBosses[e.bossId]) return studioBosses[e.bossId].threat(G, e, x, y);
  if (e.bossId === "compass") return Math.max(0, 37 - ringDistance(e, x, y)) * 6;
  if (e.bossId === "cell") {
    let distance = Infinity;
    for (let i = 0; i < 2; i++) {
      const from = e.bossLobes[i], pad = { x: landingX(e, i), y: e.targetY };
      if (e.phase === "warn") {
        const end = { x: e.ends[i], y: e.targetY - 15 };
        distance = Math.min(distance, pathDistance(x, y, from, pad), pathDistance(x, y, pad, end));
      } else {
        const mid = divePosition(e, i, e.age + .23, {}), next = divePosition(e, i, e.age + .50, {});
        distance = Math.min(distance, pathDistance(x, y, from, mid), pathDistance(x, y, mid, next));
      }
    }
    return Math.max(0, e.w * .30 + 16 - distance) * 6;
  }
  if (y < e.y + e.h * .2) return 0;
  const columns = Math.max(0, 18 - Math.min(...e.beatXs.map(column => Math.abs(column - x)))) * 6;
  // The demo reads the arm during the count-in and makes room across the divider before the notes fall.
  const side = e.phase === "warn" ? Math.max(0, (x - G.W / 2) * e.beatSide + 30) : 0;
  return columns + side;
}

function crossesJoint(e, p, x, y, angle) {
  const dx = p.x - x, dy = p.y - y, radius = e.w * .24;
  if (Math.hypot(dx, dy) <= radius) return true;
  if (!Number.isFinite(angle)) return false;
  // A bolt first meets the shell. Trace its incoming direction through the aperture the sights mark.
  const vx = Math.cos(angle), vy = Math.sin(angle);
  return dx * vx + dy * vy > 0 && Math.abs(dx * vy - dy * vx) <= radius;
}

export function installRivals(G) {
  G.kinds.rival = {
    drops: 30, body: BODY, update, hit, threat, aimAt: weakPoint,
    hitPart(G, e, part, d, x, y, ang) {
      const p = e.bossLobes ? part : weakPoint(G, e, x);
      const open = e.phase === "recover" && crossesJoint(e, p, x, y, ang);
      // The closed shell still takes damage, even during the tell. The open joint rewards a deliberate shot.
      const factor = e.phase === "recover" ? (open ? 3 : 1) : .65;
      G.hurtFoe(e, d * factor, x, y, ang, open);
    },
    bombed(G, e) {
      if (e.stage < 0) return;
      G.hurtFoe(e, 30);
      if (!e.dead && e.phase !== "recover") enter(G, e, sequence(e).length - 1);
    },
    death(G, e) {
      G.boss = null; G.cancelBullets(true); G.knock(e.x, e.y, 240, 340);
      G.tldr = { x: G.W / 2, y: e.y, t: 0 }; G.fx.speed = .3;
      G.emit("bossDeath", { e });
    },
  };
  G.hook("draw.back", ({ pal }) => {
    const e = G.boss;
    if (e?.k !== "rival" || e.dead || e.stage < 0 || e.phase === "recover") return;
    const c = G.c; c.save();
    if (e.bossId === "compass") compassDraw(G, e, c, pal);
    else if (e.bossId === "metronome") beatDraw(G, e, c, pal);
    c.restore();
  });
  G.hook("draw.over", ({ pal }) => {
    const e = G.boss;
    if (e?.k !== "rival" || e.dead || e.stage < 0) return;
    const c = G.c;
    if (studioBosses[e.bossId] && (e.phase === "warn" || e.phase === "strike")) {
      c.save(); studioBosses[e.bossId].draw(G, e, c, pal); c.restore(); return;
    }
    if (e.bossId === "cell" && (e.phase === "warn" || e.phase === "strike")) {
      c.save(); cellDraw(G, e, c, pal); c.restore(); return;
    }
    if (e.phase !== "recover") return;
    const p = weakPoint(G, e, G.P.x), r = e.w * .24;
    c.save(); c.strokeStyle = pal.deep; c.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      c.beginPath(); c.arc(p.x, p.y, r, a - .28, a + .28); c.stroke();
    }
    c.fillStyle = pal.ink; c.font = "bold 13px " + G.MONO; c.textAlign = "center";
    c.fillText("×3", p.x, p.y + r + 16); c.restore();
  });
}

export function makeRival(G, encounter) {
  const size = clamp(Math.min(G.W, G.H) * .33, 100, 142);
  return G.mk("rival", G.W / 2, -size / 2, {
    bossId: encounter.id, bossVariant: encounter.variant, bossPose: 0, w: size, h: size,
    r: size * .34, ty: Math.max(size * .58, G.H * .22), hp: 190, pts: 4200,
    lines: G.pack.wall, stage: -1, round: 0, hitPart: {},
  });
}
